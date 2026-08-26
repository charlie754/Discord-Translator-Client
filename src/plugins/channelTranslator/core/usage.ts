/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { TranslationProvider } from "./providers/types";
import type { TranslateResult } from "./types";

/**
 * A spend meter for the providers the user pays for.
 *
 * The product gained a provider billed to the user's own Google Cloud project
 * and had nothing that bounded — or even observed — what that costs. The panel's
 * only states were Translating / On / Rate limited, so a user could not tell
 * whether they had sent five hundred characters this month or five million.
 *
 * This file is the whole meter, and it is deliberately in core/: no settings, no
 * localStorage, no DataStore, no Discord. Persistence arrives as an injected
 * UsageStore exactly as HTTP arrives as an injected HttpTransport, which is what
 * lets every rule below be tested offline.
 */

/**
 * Google bills CODE POINTS, not bytes and not UTF-16 units. Verbatim from their
 * pricing page: "Cloud Translation counts usage on a per character basis, even
 * if a character is multiple bytes. Each character corresponds to a code point."
 *
 * So CJK is NOT penalised three-to-one, and an emoji outside the BMP is one
 * character rather than the two that `String.length` reports. Iterating a string
 * with for..of walks code points, which is precisely the unit wanted here.
 */
export function countCodePoints(text: string): number {
    let n = 0;
    for (const _ of text) n++;
    return n;
}

/** Code points across a batch — the exact strings a provider is about to be handed. */
export function countBatch(texts: readonly string[]): number {
    let n = 0;
    for (const text of texts) n += countCodePoints(text);
    return n;
}

/**
 * The month a count belongs to, as "YYYY-MM" in the user's OWN local calendar.
 *
 * Stored rather than inferred from a timer: a timer that has to survive
 * restarts, sleep and a client left open across midnight on the 31st is a source
 * of bugs, whereas a key comparison is not. Reading a stored key that does not
 * match today's is the rollover, and it works identically whether the client ran
 * through the boundary or was closed across it.
 *
 * Local, not UTC, because the user reads this next to their own calendar.
 * Google's invoice is cut on the billing account's own timezone, so the two can
 * disagree for a few hours at a month boundary — one more reason the number
 * below is labelled an estimate.
 *
 * The year is padded to four digits for the same reason the month is padded to
 * two: these keys are COMPARED as strings (see parseUsage), and "999-12" would
 * sort after "2026-01" and break the ordering that protects a recorded month.
 */
export function monthKey(at: Date): string {
    const year = String(at.getFullYear()).padStart(4, "0");
    const month = String(at.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}

/**
 * Shape of a month key. Everything that compares two of them checks this first,
 * because a hand-edited blob holding "August" or "2026-8" is not orderable and
 * must be treated as no record at all rather than as an earlier or later month.
 */
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export function isMonthKey(value: unknown): value is string {
    return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

/**
 * Is `a` a later month than `b`? Zero-padded "YYYY-MM" orders lexicographically,
 * so this is a string comparison and it crosses a YEAR boundary correctly:
 * "2027-01" > "2026-12". Both arguments must already be month keys.
 */
export function isLaterMonth(a: string, b: string): boolean {
    return a > b;
}

/** Characters sent this month, per provider id. */
export interface UsageState {
    month: string;
    characters: Record<string, number>;
}

/**
 * Persistence, injected. core/ may not know what a Discord setting is, so it is
 * handed two functions over an opaque string and nothing more.
 */
export interface UsageStore {
    load(): string;
    save(json: string): void;
}

/**
 * Which providers bill the user, and therefore which ones are metered.
 *
 * "google" is deliberately absent. It is Google's keyless gtx endpoint: no
 * account, no project, no invoice. Metering it would put a number in front of
 * the user that no one will ever charge them for, which is worse than no number
 * at all. Its behaviour is unchanged by everything in this file — see
 * meterIfBilled(), which returns a free provider by identity.
 */
const BILLED = new Set(["google-cloud", "deepl"]);

export function isBilledProvider(id: string): boolean {
    return BILLED.has(id);
}

/**
 * The one provider whose price the chair verified against Google's own pricing
 * page. DeepL bills too and is therefore metered and capped, but its rates were
 * not verified here, so no currency figure is offered for it: characters are
 * counted, and the money column stays empty rather than being invented.
 */
export const PRICED_PROVIDER = "google-cloud";

/**
 * Cloud Translation Basic (v2), verbatim from Google: the first 500,000
 * characters a month are "applied as $10 credit every month", and "credit usage
 * applies collectively to both Cloud Translation - Basic and Cloud Translation -
 * Advanced. The credit is up to $10, based on your usage and does not roll
 * over."
 *
 * Note what that is NOT — and the name here is deliberate. It is NOT a free
 * tier: the characters are charged at the ordinary rate and a monthly USD 10
 * credit is applied against that charge. So it is not free usage, it is SPENT
 * CREDIT, it is shared with Cloud Translation - Advanced, and anything left of
 * it at the end of the month is gone rather than carried forward. It is also not
 * a hard stop at 500,000: exceeding it blocks nothing, it bills at USD 20.00 per
 * 1,000,000 characters.
 *
 * The constant was called FREE_CHARACTERS_PER_MONTH, and the panel it fed
 * printed "estimated $0.00" for the first half-million characters — the exact
 * free-tier reading GOOGLE_CLOUD_SETUP.md has a whole section correcting. Both
 * the name and the number it produced are fixed here; see creditUsedUsd().
 */
export const CREDIT_CHARACTERS_PER_MONTH = 500_000;
export const CREDIT_USD_PER_MONTH = 10;
export const USD_PER_MILLION_CHARACTERS = 20;

/** What this many characters costs at the list rate, credit or no credit, in USD. */
export function grossUsd(characters: number): number {
    return (Math.max(0, characters) / 1_000_000) * USD_PER_MILLION_CHARACTERS;
}

/**
 * How much of the monthly USD 10 credit these characters have consumed.
 *
 * The three constants above are not independent — 500,000 characters at USD 20
 * per million IS the USD 10 credit — so this clamps at CREDIT_USD_PER_MONTH and
 * a test pins the identity, which is what stops the two ever drifting into a
 * panel that shows $11 of a $10 credit consumed.
 */
export function creditUsedUsd(characters: number): number {
    return Math.min(grossUsd(characters), CREDIT_USD_PER_MONTH);
}

/** What is left of this month's credit, in USD. It does not roll over. */
export function creditRemainingUsd(characters: number): number {
    return CREDIT_USD_PER_MONTH - creditUsedUsd(characters);
}

/**
 * What Google would charge for this many characters BEYOND the credit, in USD.
 *
 * An ESTIMATE, and it cannot be anything else. It cannot see other projects on
 * the same billing account, it cannot see the same credit being spent by Cloud
 * Translation - Advanced, and Google also charges for empty queries, which have
 * no characters to count. Every surface that shows this number must say so.
 *
 * Zero here means "the credit still covers it", NOT "this was free" — which is
 * why no surface may print this figure on its own. See usageSettings.tsx.
 */
export function estimateUsd(characters: number): number {
    const billable = Math.max(0, characters - CREDIT_CHARACTERS_PER_MONTH);
    return (billable / 1_000_000) * USD_PER_MILLION_CHARACTERS;
}

/** Fixed en-US so the string is identical on every machine, including in tests. */
export function formatCount(n: number): string {
    return n.toLocaleString("en-US");
}

export function formatUsd(n: number): string {
    return `$${n.toFixed(2)}`;
}

/**
 * A corrupt or absent blob is not an error condition — it is a first run, or a
 * user who edited the file. Start the month at zero rather than throwing on a
 * path that runs before every translation.
 *
 * Non-finite and negative counts are dropped rather than carried: a NaN in the
 * total would silently disable the cap comparison below, which is the one thing
 * in this file that must not fail open by accident.
 *
 * ROLLOVER IS ONE-WAY, AND THAT IS THE POINT.
 *
 * The rule used to be `raw.month !== month → start fresh`, which read a stored
 * month and a clock month as merely equal or not. A clock that moves BACKWARDS
 * across a month boundary — a corrected NTP sync, a VM resumed from a snapshot,
 * a dual-boot machine writing local time to the RTC, or a user setting the date
 * by hand — then destroyed the later month's record permanently: September's
 * count was discarded on read, the very next translation saved an August blob
 * over it, and the cap silently handed back a whole month's budget on top.
 *
 * So a stored month is only replaced when time has actually moved FORWARD past
 * it. A stored month later than today's is kept and kept counting into, which
 * loses nothing and keeps the cap enforced against the highest count on record —
 * the safe direction. The cost is that a clock briefly set far into the future
 * leaves the meter parked in that month; that is what the panel's reset button
 * is for, and the panel says which month it is showing.
 */
export function parseUsage(json: string, month: string): UsageState {
    const fresh: UsageState = { month, characters: {} };
    try {
        const parsed = JSON.parse(json) as unknown;
        if (typeof parsed !== "object" || parsed === null) return fresh;

        const raw = parsed as { month?: unknown; characters?: unknown; };
        // Not a month key at all — no record, rather than an older or newer one.
        if (!isMonthKey(raw.month)) return fresh;
        // Time moved forward past the stored month: a real rollover.
        if (isLaterMonth(month, raw.month)) return fresh;
        if (typeof raw.characters !== "object" || raw.characters === null) return fresh;

        const characters: Record<string, number> = {};
        for (const [id, value] of Object.entries(raw.characters as Record<string, unknown>)) {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
            characters[id] = value;
        }
        // raw.month, not month: when the clock has gone backwards these differ,
        // and the state must keep saying which month it is really counting.
        return { month: raw.month, characters };
    } catch {
        return fresh;
    }
}

/**
 * The meter itself. Every operation reads and writes through the injected store,
 * so there is no in-memory copy to drift: a reset from the settings screen is
 * visible to the very next translation, and a translation is visible to the
 * settings screen without any subscription between them.
 */
export class UsageMeter {
    constructor(
        private readonly store: UsageStore,
        private readonly now: () => Date = () => new Date()
    ) {}

    /**
     * The state that is being counted right now: today's, already rolled over if
     * the clock has moved past the stored month — and the STORED one if the
     * clock has moved backwards behind it. `.month` says which, and every
     * surface that displays a month must read it from here rather than assume
     * the clock agrees.
     */
    snapshot(): UsageState {
        return parseUsage(this.store.load(), monthKey(this.now()));
    }

    /** Characters sent to every billed provider this month, combined. */
    total(): number {
        let n = 0;
        for (const value of Object.values(this.snapshot().characters)) n += value;
        return n;
    }

    charactersFor(providerId: string): number {
        return this.snapshot().characters[providerId] ?? 0;
    }

    /**
     * Add what was sent.
     *
     * Called by meteredProvider() AFTER the request for these exact texts has
     * either come back or failed — never before it, and never for a text the
     * loop never reached. This method does not decide which failures count; see
     * wasSent().
     *
     * An earlier version recorded before the call and its own comment claimed it
     * was counting sends. It was counting INTENT: a batch that died on text 2 of
     * 3 charged the user for text 3, every scheduler retry charged the whole
     * batch again, and a request the transport refused locally — one that never
     * reached a socket — was recorded as spend that never happened.
     */
    record(providerId: string, texts: readonly string[]): void {
        const state = this.snapshot();
        state.characters[providerId] = (state.characters[providerId] ?? 0) + countBatch(texts);
        this.store.save(JSON.stringify(state));
    }

    /**
     * Start this month over. A user who rotates a key or moves to a different
     * Google Cloud project has a counter that no longer describes anything, and
     * with no way to clear it the number stops being trusted and stops being
     * read.
     *
     * This is also the one way OUT of a month key that has run ahead of the
     * clock — parseUsage() refuses to go backwards on its own, and it should,
     * but a person who knows their clock was wrong can say so here. It is the
     * deliberate, two-click, explicitly-destructive path; nothing automatic may
     * do this.
     */
    reset(): void {
        this.store.save(JSON.stringify({ month: monthKey(this.now()), characters: {} } satisfies UsageState));
    }
}

/**
 * 402 Payment Required, chosen for what the scheduler does with it rather than
 * for its HTTP meaning.
 *
 * core/scheduler.ts's isPermanent() treats any 4xx that is not 429 as permanent,
 * and permanence there buys two things this refusal needs: attempt() breaks
 * instead of retrying, and run() does NOT increment the breaker. A cap the user
 * set themselves must not look like a sick provider — retrying it would be
 * pointless, and five capped messages must not open the breaker and take the
 * free provider down with them on the next switch.
 */
export const CAP_REFUSAL_STATUS = 402;

export interface CapRefusalError extends Error {
    status: number;
    usageCapExceeded: true;
}

export function isCapRefusal(err: unknown): err is CapRefusalError {
    return typeof err === "object" && err !== null && (err as CapRefusalError).usageCapExceeded === true;
}

/**
 * The refusal message, which has one job beyond stopping the request: making it
 * unmistakable that this is the user's own setting. A bare "translation failed"
 * here sends people to the Google Cloud console to debug a limit that does not
 * exist on Google's side.
 */
export function capRefusalMessage(
    cap: number,
    used: number,
    requested: number,
    month: string,
    inFlight = 0
): string {
    return (
        `Monthly character cap reached. Your own cap is ${formatCount(cap)} characters; ` +
        `${formatCount(used)} have been sent to paid providers in ${month} and this message needs ` +
        `${formatCount(requested)} more, so it was not sent. ` +
        // Without this clause a concurrent refusal reads as arithmetic that does
        // not add up — "0 sent, 60 needed, cap 100, refused" — and the user goes
        // looking for a bug that is really two other messages already in the air.
        (inFlight > 0
            ? `${formatCount(inFlight)} more characters are already in flight for other messages and are ` +
              "counted against the cap until they land. "
            : "") +
        "This is a limit you set in ChannelTranslator's settings, not an error from Google. " +
        "Raise it or set it to 0 to switch the cap off — it clears by itself when the month rolls over."
    );
}

function capRefusal(
    cap: number,
    used: number,
    requested: number,
    month: string,
    inFlight = 0
): CapRefusalError {
    return Object.assign(new Error(capRefusalMessage(cap, used, requested, month, inFlight)), {
        status: CAP_REFUSAL_STATUS,
        usageCapExceeded: true as const
    });
}

/**
 * Characters that have been committed to the cap but are not in the meter yet.
 *
 * THE BUG THIS EXISTS FOR. The cap used to be a check-then-act: read
 * meter.snapshot(), sum it, compare, and then `await` the first send. The await
 * is the gap. state.ts runs a Scheduler with `concurrency: 3` and every message
 * builds its own wrapper over the same stored count, so three messages could all
 * read the same pre-send total and all conclude there was room. Measured against
 * the real scheduler with a cap of 100 and three 60-character batches: all three
 * were sent and 180 characters were recorded, 80% past the user's own cap. The
 * overshoot bound was roughly (concurrency - 1) x the largest batch, and one
 * Nitro message is up to 4,000 characters.
 *
 * A reservation closes the gap by moving the decision BEFORE the await: the
 * check and the increment happen together, inside one synchronous function, so
 * there is no point at which a second caller can observe the first caller's room
 * as still free. tryReserve() is deliberately one call rather than a `check()`
 * plus a `reserve()` — two functions is an invitation to put an await between
 * them, which is the original bug wearing a different shape.
 *
 * MODULE-LEVEL BY DESIGN, not per meter and not per store. The cap is one
 * monthly budget for the whole process, and both the meter and the wrapper are
 * constructed fresh per message (see state.ts's translationProvider(), and
 * settings.ts's usageStore(), which returns a NEW object every call). A ledger
 * hung off either of those would be a ledger of one, which is no ledger at all.
 * Tests that need isolation pass their own through MeterOptions.reservations.
 */
export class CapReservations {
    private pending = 0;

    /** Characters reserved by requests that have not finished. */
    get outstanding(): number {
        return this.pending;
    }

    /**
     * Reserve `characters` if `used + outstanding + characters` fits under `cap`.
     *
     * Synchronous and indivisible: single-threaded JavaScript cannot interleave
     * another caller between the comparison and the increment, which is the
     * entire guarantee. A caller MUST NOT await between reading `used` and
     * calling this.
     *
     * Returns false and reserves NOTHING when it does not fit — a refusal that
     * consumed budget would strangle the cap closed a request at a time.
     */
    tryReserve(characters: number, cap: number, used: number): boolean {
        if (used + this.pending + characters > cap) return false;
        this.pending += characters;
        return true;
    }

    /**
     * Give back what was reserved.
     *
     * Called on every exit — sent, failed, threw — because a reservation that is
     * not released is budget the user paid for and never gets to spend, and it
     * never comes back until Discord restarts. Clamped at zero so a
     * double-release is a no-op rather than a negative counter that would open
     * the cap wide.
     */
    release(characters: number): void {
        this.pending = Math.max(0, this.pending - characters);
    }
}

/** The process-wide ledger. Everything that does not ask for its own uses this one. */
export const capReservations = new CapReservations();

/** Characters currently in flight against the cap, for surfaces that display it. */
export function reservedCharacters(): number {
    return capReservations.outstanding;
}

export interface MeterOptions {
    /**
     * Characters per month across all billed providers, or 0 for no cap.
     *
     * DEFAULTS TO OFF and must stay that way. A cap that arrives switched on is
     * a silent breakage for every existing user the first time they cross a
     * number they never chose.
     */
    monthlyCharacterCap?: number;

    /**
     * Where in-flight characters are counted. Defaults to the process-wide
     * ledger, which is what makes the cap hold across concurrent messages.
     * Overridden only by tests that need an isolated one.
     */
    reservations?: CapReservations;
}

/**
 * The status every transport in this repo returns when there is no HTTP status
 * to report — a blocked host, an over-long body, a REFUSED REDIRECT, a BLOCKED
 * RESPONSE ORIGIN, a TIMEOUT, or a fetch that threw.
 *
 * Verified against all three transports: src/plugins/channelTranslator/native.ts,
 * browser/translationHost.js and browser/translationBridge.ts each return
 * `{ status: 0, body: … }` for every one of those, and the providers turn any
 * non-200 into an Error carrying that same status and no body.
 *
 * It is therefore NOT a statement about billing — the capitalised cases above
 * happen after the characters have been transmitted — which is why wasSent()
 * below no longer treats it as one. Kept exported because it is the number the
 * transports agree on and the tests pin.
 */
export const TRANSPORT_REFUSED_STATUS = 0;

/**
 * Did the characters of a failed request actually leave the machine?
 *
 * THE ANSWER IS YES FOR EVERY FAILURE THAT REACHES HERE, and that is a decision
 * rather than a shrug. What changed is not the risk appetite but the evidence.
 *
 * This used to read `status !== 0 → sent`, on the stated belief that status 0
 * means "a transport refused the request locally, so nothing was billed". That
 * belief was wrong about most of its own cases. Status 0 is what all three
 * transports return for FOUR different situations, and they are not alike:
 *
 *  1. `blocked: <why>` — a host or request-shape refusal, raised before any
 *     socket is opened. Never sent. (native.ts, translationHost.js,
 *     translationBridge.ts.)
 *  2. `blocked: <redirect refusal>` and `blocked response origin: <why>` — the
 *     request WAS sent, a response came back, and the transport refused what
 *     came back. Already billed.
 *  3. `translation request timed out` — 20 seconds elapsed with no reply
 *     (browser/translationBridge.ts's TIMEOUT_MS). Overwhelmingly likely to have
 *     been delivered, and a timeout is exactly the failure a slow, large,
 *     expensive request produces. Already billed, and this is the case the old
 *     rule under-counted while the comment admitted it.
 *  4. `String(err)` — fetch itself threw. That covers a DNS failure before the
 *     send AND a socket reset after the request was written. Ambiguous.
 *
 * So of the four, one is provably unsent, two are provably sent, and one is
 * ambiguous — and the old rule counted none of them. The asymmetry decides the
 * ambiguous case and the tie: over-counting trips the user's own cap early,
 * which is annoying, free and visible in the panel, while under-counting trips
 * it late, which is real money on a real invoice that the cap was set to
 * prevent. A spend cap must err upward. It counts.
 *
 * WHY NOT KEEP CASE 1 OUT: because it is not distinguishable here. Both billed
 * providers throw `HTTP ${res.status}` and DISCARD the transport's body — see
 * core/providers/googleCloud.ts and core/providers/deepl.ts, where the only
 * body that survives is Google's own JSON error envelope, which a `blocked:`
 * string is not. Guessing from the message text would misread case 2 as case 1,
 * because both begin with "blocked". Restoring the distinction means giving the
 * transports a marker for never-sent that survives into the Error — a change to
 * files outside this one, and not a change the cap should wait on.
 *
 * A status-less failure counts for the same reason it always did: it is a
 * `permanentError` raised after an HTTP 200 whose body would not parse, and both
 * providers bill for the characters in the request rather than for a usable
 * answer, so that money is already gone.
 */
export function wasSent(err: unknown): boolean {
    // `err` is deliberately not inspected. Nothing it can carry today proves the
    // characters never left the machine, and a guard that cannot tell case 1
    // from case 2 above would silently discard real spend.
    void err;
    return true;
}

/**
 * Wrap a provider so that what it is handed is counted, and — if the user asked
 * for a cap — refused once that cap would be crossed.
 *
 * The count is taken from the exact strings passed to translate(), which is the
 * only place that can be right. By this point core/protect.ts has already
 * replaced links, mentions and custom emoji with n sentinels, and
 * Google bills those too: verbatim, "You are charged for all characters that you
 * include in a Cloud Translation request, even untranslated characters. This
 * includes, for example, whitespace characters." Counting the pre-protect text
 * would quietly under-report every message containing a mention.
 *
 * The cap is checked against the whole batch and refuses it whole. A partial
 * send would leave the user with half a translated message and no way to tell
 * which half, for the sake of a few hundred characters at the boundary. It is
 * checked ONCE, up front, and deliberately not re-checked between the per-text
 * sends below — re-checking mid-batch is exactly the partial send that rule
 * exists to prevent. The check RESERVES what it is about to spend, in the same
 * synchronous breath; see CapReservations for why that is not optional.
 *
 * WHY A RETRY DOES NOT RE-SEND WHAT ALREADY SUCCEEDED
 *
 * core/scheduler.ts retries by re-invoking the whole closure, up to
 * maxRetries + 1 = 4 times, and state.ts's closure calls translate() on the FULL
 * line array every time. This wrapper had no memory across those attempts, so a
 * message whose LAST line kept failing re-sent — and re-billed — every earlier
 * line on every attempt. Measured against the real scheduler and this real
 * meter: a 20-line message whose last line returns 503 on every attempt produced
 * 80 HTTP sends and 1,536 characters billed where one clean pass needs 20 sends
 * and 384 characters. A 4.0x multiplier, on the provider the user pays for, and
 * every 5xx, every 429 and every status-less network error on any line but the
 * first triggered it.
 *
 * The one-request-per-text loop already makes each send individually
 * addressable, so the fix is only to remember which texts came back: a retry
 * then re-sends exactly the texts that have not. What that does NOT do — and
 * cannot — is make the multiplier 1.0x overall, because the line that failed is
 * the line the retry exists to try again. It makes it 1.0x on every line that
 * already succeeded, which is the whole of the overspend. The same 20-line
 * message now sends 19 + 1 + 1 + 1 + 1 = 23 times instead of 80.
 *
 * THE MEMO'S SCOPE, WHICH MATTERS MORE THAN THE MEMO
 *
 * A stale memo handing back someone else's translation would be far worse than
 * the overspend it replaces, so it is fenced three ways:
 *
 *  - It is keyed on the exact (from, to, texts) of the call. A different message,
 *    a different target language, or an edited line is a different key and starts
 *    a fresh memo, so nothing can be served across messages.
 *  - It is DISCARDED the moment the batch completes. It exists only for the
 *    window between a throw and the scheduler's next attempt, so a later
 *    identical call really does send again rather than replay an old answer.
 *  - It is held per wrapper, and both call sites — state.ts's requestTranslation
 *    and selection.ts's translateSelection — build a wrapper per translation and
 *    drop it, so it cannot outlive the call even if the batch never completes.
 *
 * Each call also captures the memo object it started with, rather than reading
 * the wrapper's current one as it goes. If two different batches ever did share
 * a wrapper concurrently, the worst that happens is that both lose the memo and
 * behave exactly as this code did before — never that one reads the other's
 * results.
 *
 * WHY THE BATCH IS DRIVEN ONE TEXT AT A TIME HERE
 *
 * The meter is supposed to count what was SENT, and from outside a single
 * `provider.translate(allTexts)` call that is unknowable: when it rejects, the
 * caller cannot tell whether the provider died on the first text or the last.
 * Recording the whole batch up front was the old answer and it charged the user
 * for texts that were never transmitted.
 *
 * Both billed providers already issue exactly one HTTP request per text —
 * `for (const text of texts)` in core/providers/googleCloud.ts and
 * core/providers/deepl.ts — so calling them once per text sends byte-identical
 * traffic in the same order, and makes each send individually observable. The
 * count then stops being an estimate: it is the set of texts that got a reply,
 * plus any text whose failure proves it was transmitted.
 *
 * The cost of this choice: a future provider that batched several texts into one
 * request would be forced back to one request per text by this wrapper. That is
 * a visible, greppable consequence of a comment, not a silent one — and it
 * applies only to providers the user pays for, which are the only ones wrapped.
 *
 * An empty batch now issues no request at all instead of one empty one. Google
 * charges for empty queries, so that is a small strict improvement.
 */
export function meteredProvider(
    provider: TranslationProvider,
    meter: UsageMeter,
    options: MeterOptions = {}
): TranslationProvider {
    const cap = options.monthlyCharacterCap ?? 0;
    const reservations = options.reservations ?? capReservations;

    /**
     * What the batch currently being retried has already got back. Null between
     * logical translations — never a stale map. See the header for the scoping
     * rules this upholds.
     */
    let batch: { key: string; done: Map<number, TranslateResult[]>; } | null = null;

    return {
        id: provider.id,
        label: provider.label,
        needsKey: provider.needsKey,

        async translate(texts, from, to) {
            // JSON rather than a join: it escapes, so no arrangement of texts can
            // forge another batch's key by containing the separator.
            const key = JSON.stringify([from, to, texts]);
            if (batch === null || batch.key !== key) batch = { key, done: new Map() };
            // Captured on purpose — see the header. Everything below reads and
            // writes `mine`, never `batch`.
            const mine = batch;

            // Only the texts that have NOT already come back will be sent, so
            // only those are charged against the cap. Charging the whole batch on
            // a retry would refuse a message for characters it is not going to
            // send, which is the cap drifting closed by another route.
            const toSend: number[] = [];
            for (let i = 0; i < texts.length; i++) if (!mine.done.has(i)) toSend.push(i);
            const requested = countBatch(toSend.map(i => texts[i]));

            // Characters this call holds against the cap and still owes back.
            let held = 0;

            if (cap > 0 && requested > 0) {
                const state = meter.snapshot();
                let used = 0;
                for (const value of Object.values(state.characters)) used += value;
                // NOTHING MAY AWAIT BETWEEN THE LINE ABOVE AND THE LINE BELOW.
                // That gap is the check-then-act this reservation replaces.
                if (!reservations.tryReserve(requested, cap, used)) {
                    throw capRefusal(cap, used, requested, state.month, reservations.outstanding);
                }
                held = requested;
            }

            /** Record a text that really was sent, and stop holding its reservation. */
            const settle = (text: string): void => {
                meter.record(provider.id, [text]);
                const give = Math.min(held, countCodePoints(text));
                reservations.release(give);
                held -= give;
            };

            try {
                for (const i of toSend) {
                    const text = texts[i];
                    try {
                        const part = await provider.translate([text], from, to);
                        // It came back, so it was sent. Count it and only it.
                        settle(text);
                        mine.done.set(i, part);
                    } catch (err) {
                        if (wasSent(err)) settle(text);
                        // Texts after this one were never reached, so they are
                        // never counted — which is the whole point of the loop.
                        // The ones BEFORE it stay in `mine.done`, so the
                        // scheduler's next attempt does not buy them again.
                        throw err;
                    }
                }

                const results: TranslateResult[] = [];
                for (let i = 0; i < texts.length; i++) results.push(...(mine.done.get(i) ?? []));
                // The batch is done, so the memo has served its purpose and must
                // not answer for any later call.
                if (batch === mine) batch = null;
                return results;
            } finally {
                // Whatever is still held — a refused send, a throw, an early
                // return — goes back. A leaked reservation is budget the user
                // never gets to spend again this session.
                reservations.release(held);
                held = 0;
            }
        }
    };
}

/**
 * Meter a provider only if the user pays for it.
 *
 * Returns the free provider BY IDENTITY — the same object, not an equivalent
 * wrapper. That is the strongest available statement that switching this on
 * changed nothing for the keyless Google endpoint, and it is directly assertable
 * in a test with toBe().
 */
export function meterIfBilled(
    provider: TranslationProvider,
    meter: UsageMeter,
    options: MeterOptions = {}
): TranslationProvider {
    if (!isBilledProvider(provider.id)) return provider;
    return meteredProvider(provider, meter, options);
}

/**
 * How many permanently-failed messages are remembered before the oldest is
 * forgotten. Matched to the 5,000-entry translation cache so the two bounds
 * cannot drift into a state where a message is evicted from one and not the
 * other.
 */
export const MAX_TRACKED_PERMANENT_FAILURES = 5_000;

/**
 * The messages that will never translate, so they are not paid for again.
 *
 * This lives in core/usage.ts — with the meter and the cap — because the loop it
 * closes is a SPEND loop, not a rendering one. state.ts re-enqueues every
 * untranslated message on every render pass by design ("failure is transient"),
 * the cache is written only on success so nothing suppresses a failure, and the
 * circuit breaker cannot help: it opens on five CONSECUTIVE non-permanent
 * failures and any interleaved success resets the count, so one poison message
 * inside healthy traffic never trips it. On a billed provider that is an
 * unmetered, unbounded, permanent charge for a message that will never render.
 *
 * Only failures the scheduler itself calls permanent belong here. A transient
 * failure must keep retrying — that is the behaviour the original comment was
 * protecting and it survives intact.
 *
 * Insertion-ordered and bounded: a Set iterates in insertion order, so evicting
 * `values().next()` drops the oldest. Re-marking moves an entry to the back,
 * which keeps a message that keeps failing from being evicted by newer ones.
 */
export class PermanentFailureRegistry {
    private readonly keys = new Set<string>();

    constructor(private readonly capacity: number = MAX_TRACKED_PERMANENT_FAILURES) {}

    has(key: string): boolean {
        return this.keys.has(key);
    }

    mark(key: string): void {
        this.keys.delete(key);
        this.keys.add(key);
        while (this.keys.size > this.capacity) {
            const oldest: string | undefined = this.keys.values().next().value;
            if (oldest === undefined) break;
            this.keys.delete(oldest);
        }
    }

    /**
     * Forget everything. Called when the thing that caused the failures may have
     * changed underneath us — a new provider, a new key — because a message that
     * DeepL refused is not a message Google Cloud will refuse.
     */
    clear(): void {
        this.keys.clear();
    }

    get size(): number {
        return this.keys.size;
    }
}

/**
 * How long a click waits to find out whether it is the middle of a longer
 * gesture, in milliseconds.
 *
 * 500 ms because that is the multi-click interval both Blink and Windows default
 * to, and it is the same clock the browser itself uses to decide that a third
 * click belongs to the same burst. It is a DEFAULT and not a fact: a user who
 * has raised their system double-click speed past this can still complete a
 * triple-click outside the window, and then still pays twice. Waiting longer
 * would buy that case at the price of stalling every double-click translation,
 * so the residual is stated rather than gold-plated.
 */
export const CLICK_BURST_MS = 500;

const defaultBurstWait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/**
 * One gesture, one billed translation.
 *
 * THE BUG. A triple-click is not a separate event from a double-click: the
 * browser fires `dblclick` on the second click and then `click` with
 * `detail === 3` on the third, and selection.ts translates on both. So one
 * triple-click — the gesture the product recommends for selecting a whole line —
 * issued TWO requests to a paid provider, billed both, and threw the first
 * answer away when the second popover replaced it. The rendered path has dedupe
 * guards for exactly this class of double-spend; the selection path had none.
 *
 * This lives in core/usage.ts, with the meter and the cap and
 * PermanentFailureRegistry, for the reason those do: the loop it closes is a
 * SPEND loop. It is also the only shape in which the rule is testable offline —
 * the handlers themselves need a DOM, a running client and a real provider.
 *
 * WHY IT IS A WAIT AND NOT A CANCEL. Nothing can un-bill a request that has
 * already gone, so the first click of the burst cannot be refunded once it is
 * sent; it can only be held. The double-click's request therefore waits out the
 * rest of the burst and drops itself if a third click arrives — the third click
 * is the one the user meant, since it carries the whole selection rather than a
 * single word.
 *
 * The free paths must NOT be routed through this. Showing a held original costs
 * nothing, and delaying it by half a second to protect a bill that is not being
 * incurred is a regression in the one interaction the UI advertises. Only the
 * request path waits.
 */
export class ClickBurstGate {
    /** Bumped by every click. A waiter that no longer holds the newest one lost. */
    private epoch = 0;

    constructor(
        private readonly windowMs: number = CLICK_BURST_MS,
        private readonly wait: (ms: number) => Promise<void> = defaultBurstWait
    ) {}

    /**
     * Hold this click for the rest of the burst.
     *
     * Resolves true if it is still the newest click and may spend, false if a
     * later click in the same gesture — or a later gesture entirely — superseded
     * it, in which case the caller must return without sending anything.
     */
    async settle(): Promise<boolean> {
        const mine = ++this.epoch;
        await this.wait(this.windowMs);
        return this.epoch === mine;
    }

    /**
     * A click that is going to spend immediately, so anything still waiting is
     * now the wrong request. Synchronous on purpose: it runs inside the event
     * handler, before any waiter can wake, which is what makes the supersede
     * win the race.
     */
    supersede(): void {
        this.epoch++;
    }

    /** Drop everything pending — the handlers are being removed, or the plugin stopped. */
    abandon(): void {
        this.epoch++;
    }
}

/**
 * One notice per episode, where an episode ends when someone calls reset().
 *
 * The cap refusal cannot dedupe on its own text: the message embeds `requested`,
 * which differs for every message, so the "have I already said this?" check in
 * provider.ts never fires and the user gets one banner per message on screen.
 * Hoisting the decision to a gate the caller resets on the events that actually
 * end a cap episode — a successful translation, a changed cap, a changed
 * provider or key — is the only way to make "at most once" true.
 */
export class CapNoticeGate {
    private spent = false;

    /** True exactly once per episode; false until the next reset(). */
    claim(): boolean {
        if (this.spent) return false;
        this.spent = true;
        return true;
    }

    reset(): void {
        this.spent = false;
    }

    get armed(): boolean {
        return !this.spent;
    }
}
