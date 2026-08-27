/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RetryableError extends Error {
    status?: number;
    retryAfterMs?: number;
    /**
     * Set by a caller that KNOWS retrying cannot help, in cases the HTTP status
     * cannot express.
     *
     * The status is the scheduler's only other evidence, and it is silent about
     * the case that costs the most: a 200 whose body is not the shape the
     * provider parses. That request already succeeded at the HTTP layer — on a
     * billed provider it has already been charged — and asking the same
     * deterministic endpoint the same question again returns the same
     * unparseable answer at the same price. Before this flag existed such an
     * error reached isPermanent() with no status at all and was therefore
     * classed transient, so the scheduler paid for it four times over and then
     * counted all four toward opening the breaker.
     *
     * Deliberately NOT a synthetic status. Attaching, say, 502 to a response
     * that really was a 200 would put a number in the user-visible message that
     * never came from Google, and would silently pick up whatever else keys off
     * 5xx later. A separate boolean says exactly the one thing it means.
     */
    permanent?: boolean;
}

/**
 * An error the scheduler must not retry, for a reason no status code carries.
 *
 * Kept here rather than in the providers so the marker and the function that
 * honours it cannot drift apart.
 */
export function permanentError(message: string): RetryableError {
    return Object.assign(new Error(message), { permanent: true });
}

export interface SchedulerOptions {
    concurrency: number;
    maxRetries: number;
    baseDelayMs: number;
    breakerThreshold: number;
    /**
     * How long the breaker stays open before it lets one request through again.
     * Without this it never closes: reset() had no production call site, so five
     * consecutive failures ended translation for the rest of the session with no
     * way back short of reloading Discord.
     */
    breakerCooldownMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

const DEFAULT_BREAKER_COOLDOWN_MS = 60_000;

/**
 * The longest a provider is allowed to make us wait between attempts.
 *
 * WHAT THIS CLOSES. `retryAfterMs` is not ours: native.ts builds it from the
 * remote server's `Retry-After` header (`Number(retryAfter) * 1000`) and the
 * providers attach it to the error unchanged, so the value that reached
 * `setTimeout` below was chosen by a third party. Node and the browser both hold
 * a timer delay in a SIGNED 32-BIT INT, so any delay at or above 2**31
 * (2,147,483,648 ms — about 24.9 days) overflows and the timer fires almost
 * immediately instead. A `Retry-After: 2147484` — a plausible-looking six-digit
 * number of seconds — therefore does not back off at all: it retries at once,
 * for every remaining attempt, against a provider that has just told us to stop,
 * on a key the user is billed for. Backoff defeated, at the remote server's
 * direction.
 *
 * Clamping rather than discarding, because a huge value is still evidence that
 * the provider wants a long pause; we simply refuse to hold a concurrency slot
 * for it. One minute is deliberately the same figure as
 * DEFAULT_BREAKER_COOLDOWN_MS: past that point the honest outcome is to let the
 * attempt fail, which is not terminal — state.ts re-enqueues every non-permanent
 * failure on the next render pass, and five consecutive ones open the breaker,
 * which is the mechanism that already exists for "the provider is unwell".
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * A provider-supplied retry delay, or `undefined` when there is no usable one.
 *
 * `undefined` — not 0 — for anything unusable, so the caller's `??` falls
 * through to its own exponential backoff. Returning 0 would silently replace
 * backoff with a busy retry, which is the same defect this function exists to
 * prevent, arrived at through a different door.
 *
 * NaN and Infinity are rejected before the comparison, because `NaN < 0` is
 * false and `Math.min(Infinity, max)` is finite — so a `< 0` test alone would
 * let NaN through to `setTimeout`, where it is coerced to 1 ms. `Number.isFinite`
 * catches both, and is why the check is not merely a sign test.
 *
 * Zero IS kept: a server saying "retry immediately" is a real instruction, and
 * it is bounded, which is all this guard is for.
 */
export function clampRetryAfterMs(
    value: unknown,
    max: number = MAX_RETRY_AFTER_MS
): number | undefined {
    if (typeof value !== "number") return undefined;
    if (!Number.isFinite(value)) return undefined;
    if (value < 0) return undefined;
    return Math.min(value, max);
}

/**
 * Whether an error is worth trying again.
 *
 * A 4xx that is not 429 is the server saying the request itself is wrong, and it
 * will be exactly as wrong on the fourth attempt. Retrying one wasted four
 * requests and three backoff sleeps, and — worse — each such message counted as a
 * breaker failure, so five over-long messages in a row disabled translation
 * entirely. Errors with no status are network or parse failures, which are
 * genuinely transient — UNLESS the provider marked them permanent, which is the
 * only way it can say "this 200 will never parse" (see RetryableError.permanent).
 *
 * The explicit marker is checked FIRST and beats every status rule, including
 * the 429 exemption. A caller setting it has looked at the response body; the
 * status rules are inference from a number.
 */
export function isPermanent(err: unknown): boolean {
    const e = err as RetryableError | undefined;
    if (e?.permanent === true) return true;
    const status = e?.status;
    if (typeof status !== "number") return false;
    if (status === 429) return false;
    return status >= 400 && status < 500;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Every failure here is transient. There is deliberately no terminal
 * "this message failed" state — the inherited plugin had one and a single
 * rate-limit burst permanently blanked a whole screen of messages.
 */
export class Scheduler {
    private active = 0;
    private queue: Array<() => void> = [];
    private consecutiveFailures = 0;
    private open = false;
    private openedAt = 0;

    constructor(private readonly opts: SchedulerOptions) {}

    get state(): "closed" | "open" {
        if (this.open) {
            const now = (this.opts.now ?? Date.now)();
            const cooldown = this.opts.breakerCooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
            // Half-open rather than fully reset: after the cooldown the next caller is
            // let through, but the failure count is left one short of the threshold, so
            // a single failure reopens immediately instead of granting another five
            // free attempts against a provider that is still unwell.
            if (now - this.openedAt >= cooldown) {
                this.open = false;
                this.openedAt = 0;
                this.consecutiveFailures = Math.max(0, this.opts.breakerThreshold - 1);
            }
        }
        return this.open ? "open" : "closed";
    }

    reset(): void {
        this.open = false;
        this.openedAt = 0;
        this.consecutiveFailures = 0;
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        // Reading .state, not .open, so the cooldown gets a chance to close it.
        if (this.state === "open") throw new Error("Circuit breaker is open");
        await this.acquire();
        try {
            const result = await this.attempt(fn);
            this.consecutiveFailures = 0;
            return result;
        } catch (err) {
            // A permanent error says this request was wrong, not that the provider is
            // unwell. Counting it would let a handful of malformed messages take
            // translation down for everything else.
            if (!isPermanent(err)) {
                this.consecutiveFailures++;
                if (this.consecutiveFailures >= this.opts.breakerThreshold) {
                    this.open = true;
                    this.openedAt = (this.opts.now ?? Date.now)();
                }
            }
            throw err;
        } finally {
            this.release();
        }
    }

    private async attempt<T>(fn: () => Promise<T>): Promise<T> {
        const sleep = this.opts.sleep ?? defaultSleep;
        let lastError: unknown;

        for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (isPermanent(err)) break;
                if (attempt === this.opts.maxRetries) break;
                const e = err as RetryableError;
                // Clamped, because this number came from the remote server. See
                // clampRetryAfterMs — unclamped, a large enough value overflows
                // the 32-bit timer and turns backoff into an immediate retry.
                const supplied = clampRetryAfterMs(e.retryAfterMs);
                const delay = supplied ?? this.opts.baseDelayMs * 2 ** attempt;
                await sleep(delay);
            }
        }
        throw lastError;
    }

    private acquire(): Promise<void> {
        if (this.active < this.opts.concurrency) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.queue.push(() => { this.active++; resolve(); });
        });
    }

    private release(): void {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
    }
}
