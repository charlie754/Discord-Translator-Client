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
import type { HttpRequestInit, HttpTransport, ProviderResolution } from "./core/providers/types";
import { isPermanent, Scheduler } from "./core/scheduler";
import { CapNoticeGate, isBilledProvider, isCapRefusal, meterIfBilled, PermanentFailureRegistry, UsageMeter } from "./core/usage";
import { currentProvider, warnProviderUnavailable } from "./provider";
import { settings, usageStore } from "./settings";

type TranslationNative = {
    fetchTranslation(
        url: string,
        init?: HttpRequestInit
    ): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};

// init is passed straight through and is undefined for every GET, so the two
// existing providers reach the transport exactly as they did before POST existed.
const http: HttpTransport = (url, init) => {
    const native = (VencordNative as any)?.pluginHelpers?.ChannelTranslator as TranslationNative | undefined;
    if (!native) throw new Error("ChannelTranslator: native bridge unavailable");
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
 * call currentProvider(), and test/meteredProviderChokepoint.test.ts fails if
 * anything starts to.
 *
 * The bug this closes: requestTranslation() was metered and capped, and
 * selection.ts — double-click and triple-click translation — was not. It called
 * currentProvider(http) and then provider.translate() on the RAW provider, so a
 * user who set a monthly character cap still paid past it, and the meter they
 * were reading did not know those characters existed. One metered call site and
 * one unmetered one is not a cap; it is a cap with a door in it.
 *
 * The fix is structural rather than a second meterIfBilled() call site, because
 * a second call site is a third one waiting to happen. Obtaining a provider AT
 * ALL now yields the metered one. A caller cannot forget to meter, because a
 * caller is never handed anything to forget about.
 *
 * The meter and the cap are constructed per call, on purpose: the cap is read
 * fresh so raising it takes effect on the next message rather than on the next
 * Discord restart, and meterIfBilled() hands the free keyless provider straight
 * back BY IDENTITY, so nothing on that path changes.
 */
export function translationProvider(): ProviderResolution {
    const resolved = currentProvider(http);
    if (!resolved.ok) return resolved;
    return {
        ok: true,
        provider: meterIfBilled(
            resolved.provider,
            new UsageMeter(usageStore()),
            { monthlyCharacterCap: settings.store.monthlyCharacterCap }
        )
    };
}

/**
 * Messages that will never translate on the current provider and key, so they
 * are not sent — and not paid for — on every render pass forever.
 *
 * Keyed exactly like inFlight, `contentHash:targetLanguage`, so an edited
 * message and a re-targeted translation are different messages and get a fresh
 * attempt automatically.
 */
const permanentFailures = new PermanentFailureRegistry();

/** At most one cap-refusal banner per cap-trip episode. See CapNoticeGate. */
const capNotice = new CapNoticeGate();

/**
 * Everything a permanent failure was permanent WITH RESPECT TO.
 *
 * A message DeepL refuses is not a message Google Cloud refuses, and a message
 * refused by a revoked key is not refused by the replacement. When either of
 * those changes, every remembered failure stops being evidence, so the registry
 * is discarded and those messages get a real attempt again.
 *
 * THE MONTHLY CAP IS DELIBERATELY NOT IN HERE, and used to be. Folding it in
 * made raising the cap wipe the permanent-failure registry, so every message
 * already proven unpayable-for — a 400 the provider will answer identically
 * forever, a 200 whose body will never parse — was re-sent and re-BILLED, at the
 * exact moment the user had signalled willingness to spend more. A cap is a
 * budget, not evidence about a message: nothing about raising it makes a
 * permanently refused message translatable. See capIdentity() for what a cap
 * change legitimately does invalidate.
 *
 * The keys are hashed, not stored: this string is held in a module variable for
 * the life of the session and there is no reason for a credential to live in it.
 * hashContent is FNV-1a and not a security primitive — it is used here only so
 * two different keys compare unequal, which is all this needs.
 */
function providerIdentity(): string {
    return [
        settings.store.provider,
        hashContent(settings.store.deeplApiKey ?? ""),
        hashContent(settings.store.googleCloudApiKey ?? "")
    ].join("|");
}

/**
 * What a cap-refusal EPISODE was an episode of.
 *
 * The cap gets its own identity because it does invalidate one of the two
 * guards: the refusal banner quotes the cap figure, so once the number changes
 * the last banner is describing a limit that no longer exists and the next
 * refusal has earned the right to speak again. That is the whole of it — the
 * permanent-failure registry is untouched by this, which is the separation this
 * pair of functions exists to make.
 *
 * Cap refusals were never in the registry to begin with: requestTranslation()'s
 * catch returns on isCapRefusal(err) BEFORE the marking branch, so a capped
 * message is never remembered as permanently failed and resumes the moment the
 * cap rises, exactly as before. test/meteredProviderChokepoint.test.ts asserts
 * that ordering, so it cannot quietly stop being true.
 */
function capIdentity(): string {
    return String(settings.store.monthlyCharacterCap ?? 0);
}

let lastProviderIdentity: string | null = null;
let lastCapIdentity: string | null = null;

/**
 * MUST run before anything reads permanentFailures or capNotice, and MUST NOT
 * run at module scope — it reads settings.
 *
 * Two independent comparisons, not one combined fingerprint. A single string
 * cannot express "this change invalidates the registry" separately from "this
 * change only re-arms the banner", and collapsing them is what made a cap change
 * re-bill messages that had already permanently failed.
 */
function syncTranslationIdentity(): void {
    const provider = providerIdentity();
    if (provider !== lastProviderIdentity) {
        // First call of the session establishes the baseline rather than
        // reporting a switch: nothing changed, we simply had not looked yet.
        const isSwitch = lastProviderIdentity !== null;
        lastProviderIdentity = provider;
        permanentFailures.clear();
        capNotice.reset();
        if (isSwitch) announceBilledProvider(settings.store.provider);
    }

    const cap = capIdentity();
    if (cap !== lastCapIdentity) {
        lastCapIdentity = cap;
        // The banner only. The registry is evidence about messages and a budget
        // is not evidence about a message.
        capNotice.reset();
    }
}

/**
 * How the plugin tells the user that the provider they just chose bills them.
 *
 * Registered by index.tsx, which owns every notice this plugin shows. It is
 * injected rather than imported because index.tsx already imports this module,
 * and calling back into it directly would close that into a cycle.
 */
export type BilledProviderNotifier = (providerId: string) => void;

let billedProviderNotifier: BilledProviderNotifier | null = null;

/** Install (or, with null, remove) the notifier. Called from start()/stop(). */
export function setBilledProviderNotifier(fn: BilledProviderNotifier | null): void {
    billedProviderNotifier = fn;
}

/**
 * Provider ids whose cost has already been put in front of the user this
 * session. Without this the notice would fire on every translation, because
 * syncTranslationIdentity() runs per message.
 */
const billedProvidersAnnounced = new Set<string>();

/**
 * THE GAP THIS CLOSES. The only place the plugin ever volunteered what it does
 * with the user's text was the first-run notice, which named Google Translate
 * and said nothing about money — reasonably, because on first run the provider
 * IS the free keyless one. Switching later to DeepL or Google Cloud Translation
 * changes both facts, and nothing said so: consentGiven was already true, so the
 * first-run notice never returned, and the only remaining mention of billing was
 * a settings description the user had to be reading to see.
 *
 * Fired once per provider per session, from the identity sync — i.e. at the
 * moment of the first translation that would actually be billed, not on every
 * message. A switch the user makes and never translates through costs nothing
 * and says nothing, which is the correct amount of noise for it.
 */
function announceBilledProvider(providerId: string): void {
    if (!isBilledProvider(providerId)) return;
    if (billedProvidersAnnounced.has(providerId)) return;
    billedProvidersAnnounced.add(providerId);
    billedProviderNotifier?.(providerId);
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
    toggle.loadFrom(settings.store.serverState);
    // Establish the provider/cap baseline HERE rather than letting the first
    // translation of the session do it. Otherwise a user who opens settings and
    // switches to a billed provider before translating anything gets no cost
    // notice at all: that first sync would be the baseline, and a baseline is
    // silent by design. Starting a session already on a billed provider is
    // likewise silent, which is correct — the notice belongs to the switch, and
    // that switch happened in an earlier session.
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

export function persist(): void {
    settings.store.cacheBlob = cache.serialise();
    settings.store.serverState = toggle.serialise();
}

export function requestTranslation(message: any): void {
    const target = settings.store.targetLanguage;
    const hash = hashContent(message.content);
    messageHashes.set(message.id, hash);

    if (cache.get(hash, target)) return;

    const flightKey = `${hash}:${target}`;
    if (inFlight.has(flightKey)) return;

    // Before either guard below is trusted: a changed provider, key or cap
    // invalidates both of them.
    syncTranslationIdentity();

    // A message that already failed permanently is not sent again. Without this
    // it is re-enqueued on every render pass, forever, and on a billed provider
    // every one of those passes is a new charge for a message that will never
    // render. Nothing else stops it — the cache is written only on success, and
    // the breaker needs five CONSECUTIVE failures, which one poison message
    // among healthy traffic never produces.
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
    // turn "DeepL selected, key not pasted" into a channel that simply never
    // translates and never explains itself.
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
            // nothing was sent and nothing can be concluded about the cap.
            if (!payload) return;
            // A request got through, so whatever was capping spend is not
            // capping it now. The next cap trip is a new episode and is allowed
            // to speak again.
            capNotice.reset();
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
            // The user's own spend cap comes first and is NOT a permanent
            // failure. Everything else here is "not yet"; that one is "not until
            // you change a setting", and it must resume the moment the setting
            // changes — which marking it would prevent. It costs nothing to let
            // it retry: the meter refuses it before a single character is sent.
            //
            // It does have to say so, though. A cap that stops translation
            // silently is indistinguishable from the plugin being broken.
            // warnProviderUnavailable is reused for its behaviour rather than
            // its name, and gated because it CANNOT dedupe this one itself: the
            // message embeds the per-message `requested` count, so its
            // "same reason as last time?" check never matches.
            if (isCapRefusal(err)) {
                if (capNotice.claim()) warnProviderUnavailable(err.message);
                return;
            }

            // Permanent means the scheduler already refused to retry it: a 4xx
            // that is not 429, or a 200 whose body will never parse. Asking the
            // same deterministic endpoint the same question again returns the
            // same answer at the same price, on every render pass, forever.
            // Remember it and stop paying for it.
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
