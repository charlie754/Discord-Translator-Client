/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/state.ts
import { updateMessage } from "@api/MessageUpdater";
import { ChannelStore, MessageStore } from "@webpack/common";

import { TranslationCache } from "./core/cache";
import { aggregate, shouldTranslate, splitJoined } from "./core/detect";
import { hashContent } from "./core/hash";
import { ToggleState, translationEnabled } from "./core/modes";
import { protect, restore } from "./core/protect";
// checkDeploymentUrl comes straight from the provider module that defines it,
// which is how every existing caller reaches it — createAppsScriptProvider() in
// that same file, and test/appsScriptProvider.test.ts. It is a pure string check
// with no transport, no settings and no I/O, which is what makes it safe to call
// before anything else here.
import { checkDeploymentUrl } from "./core/providers/appsScript";
import type { HttpRequestInit, HttpTransport, ProviderResolution } from "./core/providers/types";
import { PermanentFailureRegistry } from "./core/requestBookkeeping";
import { isPermanent, Scheduler } from "./core/scheduler";
import { appsScriptProviderFor, currentProvider, warnProviderUnavailable } from "./provider";
import { settings } from "./settings";

type TranslationNative = {
    fetchTranslation(
        url: string,
        init?: HttpRequestInit
    ): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};

/**
 * The message thrown when there is no transport at all. Named rather than
 * inlined so validateAppsScriptUrl() can recognise it and say something a user
 * can act on instead of showing them this sentence, which is written for us.
 * The text itself is unchanged.
 */
const NATIVE_BRIDGE_MISSING = "ChannelTranslator: native bridge unavailable";

/**
 * The object the transports install, or undefined when this build has none.
 *
 * WHERE IT IS ACTUALLY ABSENT, since the answer decides whether the branch below
 * is dead code. On the browser/extension/userscript build it is NOT normally
 * absent: browser/VencordNativeStub.ts assigns `window.VencordNative` with
 * `pluginHelpers: { ChannelTranslator: ChannelTranslatorHelper }` (stub line 197,
 * helper defined at browser/translationBridge.ts:889), and browser/Vencord.ts
 * imports that stub as its first statement, so the bridge exists before any
 * plugin runs. On the DESKTOP build pluginHelpers is not written by this repo's
 * source at all: src/VencordNative.ts:24 builds it from the main process's
 * GET_PLUGIN_IPC_METHOD_MAP reply, so the key is present only if the main
 * process registered this plugin's native.ts. A partial install, a host that
 * ships its own preload, or a renderer bundle newer than the main bundle all
 * produce a VencordNative with no ChannelTranslator under it.
 *
 * So: rare, not impossible, and not something the user can diagnose from
 * "native bridge unavailable".
 */
function translationNative(): TranslationNative | undefined {
    return (VencordNative as any)?.pluginHelpers?.ChannelTranslator as TranslationNative | undefined;
}

// init is passed straight through and is undefined for every GET, so the two
// existing providers reach the transport exactly as they did before POST existed.
const http: HttpTransport = (url, init) => {
    const native = translationNative();
    if (!native) throw new Error(NATIVE_BRIDGE_MISSING);
    return native.fetchTranslation(url, init);
};

export const cache = new TranslationCache(5000);
export const toggle = new ToggleState();
export const scheduler = new Scheduler({
    concurrency: 3,
    maxRetries: 3,
    baseDelayMs: 500,
    breakerThreshold: 5
});

/**
 * THE ONLY WAY THIS PLUGIN OBTAINS A PROVIDER. Nothing outside this file may
 * call currentProvider(), and test/providerChokepoint.test.ts fails if anything
 * starts to. (That test was renamed from meteredProviderChokepoint when the
 * meter went; the guard it applies here is unchanged.)
 *
 * WHY THE CHOKEPOINT SURVIVED THE THING IT WAS BUILT FOR. It was built to hold a
 * spend meter. requestTranslation() was metered and capped and selection.ts —
 * double-click and triple-click translation — was not: selection.ts called
 * currentProvider(http) itself and then translated through the RAW provider, so
 * a user who had set a monthly character cap kept paying past it. The fix was
 * structural rather than a second wrapping call site, because a second call site
 * is a third one waiting to happen, so obtaining a provider AT ALL came through
 * here.
 *
 * The meter and the cap are gone — every remaining provider is free, so there is
 * nothing left to meter. The chokepoint is NOT a leftover of them. What it
 * actually enforces is that one function decides what this plugin talks to and
 * with which credential, and that decision is read fresh from settings on every
 * call. That is what makes switching provider take effect on the next message
 * rather than the next Discord restart, and it is what keeps "where does message
 * text go?" a question with a single answer in a single place — which matters
 * more, not less, now that one of the two providers is an endpoint the user
 * deployed themselves.
 *
 * A second call site would put that decision in two places again. Do not add one.
 */
export function translationProvider(): ProviderResolution {
    return currentProvider(http);
}

/**
 * Whether an endpoint can actually be used, or the sentence that says why not.
 *
 * Deliberately NOT ProviderResolution: nothing is handed back on success. The
 * caller asked a question, not for a provider, and returning one would invite a
 * second, unmetered translation path — the exact shape translationProvider()
 * exists to prevent.
 */
export type EndpointCheck = { ok: true; } | { ok: false; reason: string; };

/**
 * What to say when there is no transport at all — written for the person
 * reading it, not for us.
 *
 * "native bridge unavailable" is a true sentence about our internals and a
 * useless one to a user staring at a URL field: it reads as though the URL were
 * wrong, and the one thing they can act on is the one thing that is fine. See
 * translationNative() above for when this is actually reachable.
 */
const NATIVE_BRIDGE_REASON =
    "This copy of the plugin cannot reach the helper that sends network requests, so the " +
    "deployment cannot be checked from here. Nothing is wrong with the URL you pasted. " +
    "Restart Discord, and if it keeps happening reinstall the plugin.";

/** No message on the thrown value, or something thrown that was not an Error at all. */
const UNEXPLAINED_FAILURE =
    "The check failed and gave no reason, which is itself unexpected — please report it.";

/**
 * The sentence to show for a failed probe.
 *
 * The message is taken as-is because core/providers/appsScript.ts and the three
 * transports already write better user-facing prose than anything that could be
 * composed here: they name the sign-in page, the daily quota, the deleted
 * deployment and the /exec-vs-/dev mistake, each with the exact menu path to fix
 * it. Rewording them here would produce two vocabularies for one failure.
 *
 * THE CANDIDATE URL IS NEVER ADDED. Nothing below interpolates it, and nothing
 * upstream does either: appsScript.ts's messages name statuses and menus, and the
 * only transport refusal that echoes any part of a URL is the not-an-allowed-host
 * one, which quotes `protocol//host` and never the path — and which a candidate
 * that got this far cannot trigger, because checkDeploymentUrl() has already
 * pinned the host to script.google.com. The deployment id, which is the part that
 * IS the credential, appears nowhere.
 */
function endpointFailureReason(err: unknown): string {
    const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const message = raw.trim();
    if (!message) return UNEXPLAINED_FAILURE;
    // Second line of defence for the bridge: validateAppsScriptUrl() checks for
    // it up front, but the bridge can also go away between that check and the
    // request, and this is the one internal string that must never be shown raw.
    if (message === NATIVE_BRIDGE_MISSING) return NATIVE_BRIDGE_REASON;
    return message;
}

/**
 * Is this candidate Apps Script deployment URL one that actually works?
 *
 * WHAT IT COSTS THE USER. Nothing in money, and this is not a hedge: Apps Script
 * has no billing at all, so there is no card and no invoice. It costs ONE call
 * out of the deployment's daily allowance — about 5,000 on a consumer Google
 * account — which is worth saying out loud and is not a hazard.
 *
 * THE ORDER BELOW IS THE DESIGN, not an implementation detail:
 *
 *   1. empty        — answered here, no call
 *   2. LOCAL SHAPE  — checkDeploymentUrl(), no call
 *   3. transport    — answered here, no call
 *   4. resolve      — through provider.ts, so the registry stays behind it
 *   5. probe        — the one and only request
 *
 * Steps 1-3 are free and instant. The user who pasted the /dev URL, the editor
 * URL out of the address bar, or a URL truncated by their clipboard is told
 * immediately and in Google's own vocabulary, instead of waiting out a round
 * trip to be told the same thing. checkDeploymentUrl()'s refusals are reused
 * verbatim for that reason — they already name Deploy → Manage deployments, and
 * a second wording of the same advice would be a worse one.
 *
 * THE URL IS NEVER LOGGED, NOTICED, OR PUT IN A REASON. It is the credential —
 * anyone holding it can spend the deployment's daily quota — which is why
 * core/providers/appsScript.ts says so in capitals and why this function returns
 * a bare { ok: true } rather than anything derived from the string.
 *
 * MUST NOT be called at module scope: it writes settings.store on success, and
 * appsScriptProviderFor() runs through the same adapter every settings read
 * goes through.
 */
export async function validateAppsScriptUrl(candidateUrl: string): Promise<EndpointCheck> {
    const trimmed = (candidateUrl ?? "").trim();
    if (!trimmed) {
        return {
            ok: false,
            reason:
                "There is nothing to check yet — paste the Web App URL from Deploy → Manage " +
                "deployments first. It ends with /exec."
        };
    }

    // LOCAL, INSTANT, FREE, AND FIRST. Every refusal this returns is one the
    // network could not have improved on, so making the request first would spend
    // a call out of the daily allowance to learn something already known.
    const shape = checkDeploymentUrl(trimmed);
    if (!shape.ok) return { ok: false, reason: shape.reason };

    // Asked before anything is constructed so the failure names the real cause.
    // Without it the probe throws NATIVE_BRIDGE_MISSING from inside the provider
    // and the user reads an internal sentence about a bridge.
    if (!translationNative()) return { ok: false, reason: NATIVE_BRIDGE_REASON };

    // Through provider.ts, never through the registry directly — see
    // appsScriptProviderFor() there for why that function cannot live in this
    // file. It resolves against the CANDIDATE, so the stored URL is neither read
    // nor disturbed by a check of a URL the user has not committed to.
    const resolved = appsScriptProviderFor(trimmed, http);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };

    // Resolved and used directly. There used to be a meterIfBilled() wrapper on
    // this line, kept deliberately even though it was a no-op for Apps Script, so
    // that provider construction had exactly ONE shape in this file and whoever
    // added a verify button for a BILLED provider would copy it and be metered by
    // default. There are no billed providers left to guard against and no meter
    // to apply, so the wrapper went with them — and translationProvider() above
    // is now a bare currentProvider() call for the same reason. The two shapes
    // still match; there is simply less of both.
    const { provider } = resolved;

    try {
        // The smallest honest request: a real translate call, because a HEAD or a
        // GET would exercise a different code path from the one that has to work
        // and could pass while translation was broken. One two-letter word is the
        // least it can be while still being the real thing.
        await provider.translate(["ok"], "en", "es");
        // THE ONE PLACE THAT KNOWS A URL ACTUALLY WORKED, which is why the write
        // is here and not in whatever UI calls this. A caller can know the check
        // passed; only this line sits after the request that proves it, so
        // "lastGood" stays literally true rather than degrading into "last
        // typed". Written AFTER the await, never before it.
        //
        // The canonical form from checkDeploymentUrl() is stored, not the raw
        // paste: that is the string the request was actually made against, with
        // any query, fragment or embedded credentials already dropped.
        settings.store.lastGoodAppsScriptUrl = shape.url;
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: endpointFailureReason(err) };
    }
}

/**
 * Messages that will never translate on the current provider and credential, so
 * they are not re-sent on every render pass forever.
 *
 * Keyed exactly like inFlight, `contentHash:targetLanguage`, so an edited
 * message and a re-targeted translation are different messages and get a fresh
 * attempt automatically.
 */
const permanentFailures = new PermanentFailureRegistry();

/**
 * Everything a permanent failure was permanent WITH RESPECT TO.
 *
 * A message the free gtx endpoint refuses is not a message the user's own Apps
 * Script deployment refuses, and a message refused by a dead deployment URL is
 * not refused by the replacement. When either changes, every remembered failure
 * stops being evidence, so the registry is discarded and those messages get a
 * real attempt again.
 *
 * WHAT IS NO LONGER IN HERE, and it is a deletion rather than a change of mind.
 * This used to hash the DeepL and Google Cloud API keys, and there used to be a
 * second identity beside it for the monthly character cap. Both providers and
 * the cap are gone. The one live credential left is the Apps Script deployment
 * URL, so it is the one hashed here.
 *
 * The credential is hashed, not stored: this string is held in a module variable
 * for the life of the session and there is no reason for a credential to live in
 * it. hashContent is FNV-1a and not a security primitive — it is used here only
 * so two different URLs compare unequal, which is all this needs.
 */
function providerIdentity(): string {
    return [
        settings.store.provider,
        hashContent(settings.store.appsScriptUrl ?? "")
    ].join("|");
}

let lastProviderIdentity: string | null = null;

/**
 * MUST run before anything reads permanentFailures, and MUST NOT run at module
 * scope — it reads settings.
 *
 * One comparison now, where there were two. The second existed because the cap
 * needed to invalidate a refusal banner WITHOUT invalidating the registry:
 * collapsing them into a single fingerprint made raising the cap wipe the
 * registry, so every message already proven permanently unsendable was re-sent
 * and re-billed at the exact moment the user had signalled willingness to spend
 * more. There is no cap and no banner any more, so there is one thing left to
 * compare — but the reasoning is recorded because it is the trap anyone folding
 * a new setting in here would fall into next.
 */
function syncTranslationIdentity(): void {
    const provider = providerIdentity();
    if (provider === lastProviderIdentity) return;
    lastProviderIdentity = provider;
    permanentFailures.clear();
}

/**
 * Discord's message objects do not reliably carry guild_id — it lives on the
 * channel. Reading message.guild_id yields undefined, which our per-server
 * toggle treats as a DM and therefore always-off, silently skipping every
 * message. Resolve through the channel, as Equicord's own translator does.
 */
export function guildIdOf(channelId: string | undefined): string | null {
    if (!channelId) return null;
    return ChannelStore.getChannel(channelId)?.guild_id ?? null;
}

/**
 * MUST be called from the plugin's start(), never at module scope.
 * Reading settings.store during module evaluation throws
 * "Cannot access settings before plugin is initialized", and because that
 * happens while ~plugins is being imported it takes down every plugin,
 * not just this one.
 */
export function hydrate(): void {
    cache.loadFrom(settings.store.cacheBlob);
    /*
     * TRANSLATION IS OFF AT EVERY START, AND THAT IS THE POINT.
     *
     * `toggle.loadFrom(settings.store.serverState)` used to sit on this line. It
     * carried the previous session's switched-on servers across a restart, so a
     * user who left one server on in April was still translating it — and still
     * sending its messages to a provider — the next time Discord opened, without
     * having asked for anything this session. Operator ruling 2026-08-29:
     * "Default off shall persist across restart." Being ON is now a deliberate,
     * per-session act: the user opens the panel and flips the switch.
     *
     * `toggle` therefore starts empty on every start() and stays purely in
     * memory. Nothing else has to change for that to hold — ToggleState's own
     * default is empty, so removing the load IS the whole mechanism. persist()
     * below no longer writes the counterpart, and settings.ts no longer declares
     * `serverState` at all.
     *
     * THE CACHE IS DELIBERATELY NOT AFFECTED. cache.loadFrom() above still runs:
     * a translation already paid for is still worth keeping across a restart, and
     * it reveals nothing and sends nothing on its own. Only the on/off decision
     * stopped persisting.
     */
    // Establish the provider baseline HERE rather than letting the first
    // translation of the session do it, so that the first sync is a baseline and
    // not a spurious "the provider changed" that clears an empty registry for no
    // reason. It costs one settings read at start().
    syncTranslationIdentity();
}

/** messageId -> contentHash, so the render layer can find a cache entry cheaply. */
const messageHashes = new Map<string, string>();
let pending = 0;

/** hash:lang currently being translated — stops render-loop duplicate requests. */
const inFlight = new Set<string>();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to translation-progress changes. Returns an unsubscribe function. */
export function subscribeProgress(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function emitProgress(): void {
    for (const fn of listeners) fn();
}

export function pendingCount(): number {
    return pending;
}

export function breakerOpen(): boolean {
    return scheduler.state === "open";
}

export function entryForMessage(messageId: string) {
    const hash = messageHashes.get(messageId);
    if (!hash) return undefined;
    return cache.get(hash, settings.store.targetLanguage);
}

/*
 * The translation cache, and nothing else.
 *
 * `settings.store.serverState = toggle.serialise();` used to be the second line
 * here. It is gone with the load in hydrate() above — a write nothing reads is
 * not "harmless persistence", it is a stored value that the next reader will
 * reasonably assume is honoured, and the next reader is how "off at start"
 * quietly stops being true.
 *
 * THE PANEL USED TO REPAINT AS A SIDE EFFECT OF THAT WRITE, and this is the part
 * that is easy to miss. Panel.tsx subscribes with
 * `settings.use([... "serverState"])`, so writing the setting was what forced the
 * switch to re-render after a click. With the write gone the panel forces its own
 * re-render instead — see flip() in panel/Panel.tsx. Deleting the write without
 * that would have left the switch visually frozen until something else happened
 * to repaint the panel.
 */
export function persist(): void {
    settings.store.cacheBlob = cache.serialise();
}

export function requestTranslation(message: any): void {
    const target = settings.store.targetLanguage;
    const hash = hashContent(message.content);
    messageHashes.set(message.id, hash);

    if (cache.get(hash, target)) return;

    const flightKey = `${hash}:${target}`;
    if (inFlight.has(flightKey)) return;

    // Before the guard below is trusted: a changed provider or deployment URL
    // invalidates every remembered failure.
    syncTranslationIdentity();

    // A message that already failed permanently is not sent again. Without this
    // it is re-enqueued on every render pass, forever — burning the free
    // endpoint's rate budget or the Apps Script deployment's daily allowance on
    // a message that will never render, and holding scheduler slots away from
    // messages that could. Nothing else stops it: the cache is written only on
    // success, and the breaker needs five CONSECUTIVE failures, which one poison
    // message among healthy traffic never produces.
    if (permanentFailures.has(flightKey)) return;

    const raw = {
        id: message.id,
        authorId: message.author?.id ?? "",
        channelId: message.channel_id,
        guildId: guildIdOf(message.channel_id),
        content: message.content,
        contentHash: hash
    };
    if (!shouldTranslate(raw, target)) return;

    // A provider that cannot run says why. Returning quietly here is what would
    // turn "Apps Script selected, deployment URL not pasted" into a channel that
    // simply never translates and never explains itself.
    const resolved = translationProvider();
    if (!resolved.ok) {
        warnProviderUnavailable(resolved.reason);
        return;
    }
    const { provider } = resolved;

    inFlight.add(flightKey);
    pending++;
    emitProgress();
    void scheduler
        .run(async () => {
            const lines = raw.content.split("\n");

            // Indices of lines worth translating; blanks pass through untouched
            // so the message keeps its paragraph and list structure.
            const idx: number[] = [];
            const masked: string[] = [];
            const tokenSets: string[][] = [];

            lines.forEach((line, i) => {
                if (line.trim().length === 0) return;
                const p = protect(line);
                idx.push(i);
                masked.push(p.masked);
                tokenSets.push(p.tokens);
            });

            if (masked.length === 0) return null;

            const results = await provider.translate(masked, "auto", target);

            const out = [...lines];
            results.forEach((r, n) => {
                out[idx[n]] = restore(r.text, tokenSets[n]);
            });

            return { text: out.join("\n"), result: results[0] };
        })
        .then(payload => {
            // A null payload means the message had nothing worth translating, so
            // nothing was sent and there is nothing to cache.
            if (!payload) return;
            const { text, result } = payload;
            cache.set(hash, target, {
                text,
                sourceLang: result.sourceLang,
                confidence: result.confidence
            });
            persist();
            repaintMessage(raw.channelId, raw.id);
        })
        .catch(err => {
            // There used to be a branch above this one for the user's own spend
            // cap, which was NOT a permanent failure and had to resume the moment
            // the cap was raised. The cap is gone with the paid providers, so
            // every error reaching here is a real failure of a real request and
            // the only question left is whether it can ever succeed.
            //
            // Permanent means the scheduler already refused to retry it: a 4xx
            // that is not 429, or a 200 whose body will never parse. Asking the
            // same deterministic endpoint the same question again returns the
            // same answer, on every render pass, forever. Remember it and stop
            // asking.
            //
            // A transient failure is still deliberately left unmarked. The
            // inherited plugin had a terminal failure state and a single
            // rate-limit burst permanently blanked a whole screen of messages;
            // that behaviour must not come back, and does not — this marks only
            // what core/scheduler.ts's isPermanent() already treats as final.
            if (isPermanent(err)) permanentFailures.mark(flightKey);
        })
        .finally(() => {
            pending--;
            inFlight.delete(flightKey);
            emitProgress();
        });
}

/**
 * Repaint what is already on screen. Toggling the flag alone changes nothing,
 * because Discord has no reason to re-render messages it already painted.
 * We never fetch history — the user's own scrolling drives Discord's lazy-load.
 */
export function repaintChannel(channelId: string): void {
    const loaded = MessageStore.getMessages(channelId);
    // _array is what the typed interface exposes; toArray() exists at runtime but is undocumented
    const messages: any[] = loaded?._array ?? [];
    // The SAME question the two render entry points ask, in the same words —
    // servers answer to the panel toggle, DMs answer to includeDMs and to
    // nothing else. See core/modes.ts.
    //
    // This used to be toggle.isOn(guildIdOf(channelId)), which cannot see
    // includeDMs at all, so with DMs opted in Replace mode translated a DM and
    // Both-Language mode did not. Same setting, same conversation, two answers,
    // decided by which mode the user happened to be in.
    const on = translationEnabled(toggle, guildIdOf(channelId), settings.store.includeDMs);

    if (on) {
        const batches = aggregate(
            messages.map(m => ({
                id: m.id,
                authorId: m.author?.id ?? "",
                channelId,
                guildId: guildIdOf(channelId),
                content: m.content ?? "",
                contentHash: hashContent(m.content ?? "")
            }))
        );
        for (const batch of batches) {
            for (const m of batch.messages) {
                const original = messages.find(x => x.id === m.id);
                if (original) requestTranslation(original);
            }
        }
    }

    // Always repaint, on or off: switching off must restore the originals.
    for (const m of messages) repaintMessage(channelId, m.id);
    emitProgress();
}

function repaintMessage(channelId: string, messageId: string): void {
    try {
        updateMessage(channelId, messageId);
    } catch {
        // A message not currently mounted cannot be updated. It repaints on the
        // next natural render. Degraded, not broken — and deliberately caught,
        // because upstream's equivalent uses a non-null assertion that throws.
    }
}

export { splitJoined };
