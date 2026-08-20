/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

const noSleep = () => Promise.resolve();

const opts = {
    concurrency: 2, maxRetries: 3, baseDelayMs: 10,
    breakerThreshold: 3, sleep: noSleep
};

describe("Scheduler", () => {
    it("returns a successful result", async () => {
        const s = new Scheduler(opts);
        await expect(s.run(async () => "ok")).resolves.toBe("ok");
    });

    it("never exceeds the concurrency cap", async () => {
        const s = new Scheduler({ ...opts, concurrency: 2 });
        let active = 0, peak = 0;
        await Promise.all(Array.from({ length: 8 }, () => s.run(async () => {
            active++; peak = Math.max(peak, active);
            await new Promise(r => setTimeout(r, 5));
            active--;
        })));
        expect(peak).toBeLessThanOrEqual(2);
    });

    it("retries a failing call and succeeds", async () => {
        const s = new Scheduler(opts);
        let calls = 0;
        const result = await s.run(async () => {
            if (++calls < 3) throw Object.assign(new Error("boom"), { status: 500 });
            return "recovered";
        });
        expect(result).toBe("recovered");
        expect(calls).toBe(3);
    });

    it("gives up after maxRetries and rejects", async () => {
        const s = new Scheduler({ ...opts, breakerThreshold: 99 });
        await expect(
            s.run(async () => { throw Object.assign(new Error("nope"), { status: 500 }); })
        ).rejects.toThrow("nope");
    });

    it("honours retryAfterMs on a 429", async () => {
        const sleep = vi.fn((ms: number) => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep });
        let calls = 0;
        await s.run(async () => {
            if (++calls === 1) {
                throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 1234 });
            }
            return "ok";
        });
        expect(sleep).toHaveBeenCalledWith(1234);
    });

    it("backs off exponentially when no Retry-After is given", async () => {
        const sleep = vi.fn((ms: number) => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep, breakerThreshold: 99 });
        await s.run(async () => {
            throw Object.assign(new Error("x"), { status: 500 });
        }).catch(() => undefined);
        const delays = sleep.mock.calls.map(c => c[0] as number);
        expect(delays[1]).toBeGreaterThan(delays[0]);
    });

    it("opens the breaker after consecutive failures", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        for (let i = 0; i < 3; i++) {
            await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
                .catch(() => undefined);
        }
        expect(s.state).toBe("open");
    });

    it("rejects immediately while the breaker is open", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 1 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
            .catch(() => undefined);
        const spy = vi.fn(async () => "never");
        await expect(s.run(spy)).rejects.toThrow(/breaker/i);
        expect(spy).not.toHaveBeenCalled();
    });

    it("closes the breaker on reset and works again", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 1 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
            .catch(() => undefined);
        s.reset();
        expect(s.state).toBe("closed");
        await expect(s.run(async () => "back")).resolves.toBe("back");
    });

    it("a success clears the consecutive-failure count", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 500 }); })
            .catch(() => undefined);
        await s.run(async () => "ok");
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 500 }); })
            .catch(() => undefined);
        expect(s.state).toBe("closed");
    });
});
