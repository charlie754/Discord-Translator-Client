/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RetryableError extends Error {
    status?: number;
    retryAfterMs?: number;
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
 * Whether an error is worth trying again.
 *
 * A 4xx that is not 429 is the server saying the request itself is wrong, and it
 * will be exactly as wrong on the fourth attempt. Retrying one wasted four
 * requests and three backoff sleeps, and — worse — each such message counted as a
 * breaker failure, so five over-long messages in a row disabled translation
 * entirely. Errors with no status are network or parse failures, which are
 * genuinely transient.
 */
export function isPermanent(err: unknown): boolean {
    const status = (err as RetryableError | undefined)?.status;
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
                const delay = e.retryAfterMs ?? this.opts.baseDelayMs * 2 ** attempt;
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
