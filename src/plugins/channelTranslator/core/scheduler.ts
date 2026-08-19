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
    sleep?: (ms: number) => Promise<void>;
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

    constructor(private readonly opts: SchedulerOptions) {}

    get state(): "closed" | "open" {
        return this.open ? "open" : "closed";
    }

    reset(): void {
        this.open = false;
        this.consecutiveFailures = 0;
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.open) throw new Error("Circuit breaker is open");
        await this.acquire();
        try {
            const result = await this.attempt(fn);
            this.consecutiveFailures = 0;
            return result;
        } catch (err) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.opts.breakerThreshold) this.open = true;
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
