/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import {
    clampRetryAfterMs,
    isPermanent,
    MAX_RETRY_AFTER_MS,
    permanentError,
    Scheduler
} from "../src/plugins/channelTranslator/core/scheduler";

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

/*
 * The `permanent` marker exists for one case no status code can express: an HTTP
 * 200 whose body the provider cannot parse. On a billed provider that response
 * has ALREADY been charged, so a retry pays again for an answer that is
 * deterministically identical. Everything below is about not paying four times.
 */
describe("isPermanent — the explicit marker", () => {
    it("classes an error carrying permanent:true as permanent", () => {
        expect(isPermanent(permanentError("cannot parse"))).toBe(true);
    });

    it("still classes a bare status-less error as transient (negative control)", () => {
        // Without this the assertion above would pass just as well from an
        // isPermanent() that had been broken into returning true for everything.
        expect(isPermanent(new Error("network went away"))).toBe(false);
    });

    it("beats the 429 exemption, because the caller read the body and the rule did not", () => {
        const err = Object.assign(new Error("x"), { status: 429, permanent: true });
        expect(isPermanent(err)).toBe(true);
        // And a 429 without the marker is still retryable — the exemption is not gone.
        expect(isPermanent(Object.assign(new Error("x"), { status: 429 }))).toBe(false);
    });

    it("ignores a falsy or non-boolean marker rather than treating presence as truth", () => {
        expect(isPermanent(Object.assign(new Error("x"), { permanent: false }))).toBe(false);
        expect(isPermanent(Object.assign(new Error("x"), { permanent: "yes" }))).toBe(false);
    });

    it("permanentError carries the message through unchanged", () => {
        const err = permanentError("google-cloud: response had no translations array");
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("google-cloud: response had no translations array");
        expect(err.permanent).toBe(true);
        // No invented HTTP status. A synthetic number would show up in the
        // user-visible message as if Google had sent it.
        expect(err.status).toBeUndefined();
    });
});

describe("Scheduler — a permanent-marked failure is not paid for twice", () => {
    it("calls the work function exactly once instead of maxRetries+1 times", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 3, breakerThreshold: 99 });
        const fn = vi.fn(async () => { throw permanentError("unparseable 200"); });

        await expect(s.run(fn)).rejects.toThrow("unparseable 200");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries an UNMARKED status-less error four times (positive control for the count)", async () => {
        // This is the pre-fix behaviour, and the number the test above is measuring
        // against. If maxRetries stopped being honoured, both tests would read 1
        // and the one above would prove nothing.
        const s = new Scheduler({ ...opts, maxRetries: 3, breakerThreshold: 99 });
        const fn = vi.fn(async () => { throw new Error("unparseable 200"); });

        await expect(s.run(fn)).rejects.toThrow("unparseable 200");
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it("does not sleep between attempts, because there are none", async () => {
        const sleep = vi.fn(() => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep, maxRetries: 3, breakerThreshold: 99 });

        await s.run(async () => { throw permanentError("x"); }).catch(() => undefined);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("does not count toward the breaker, so bad messages cannot disable translation", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        for (let i = 0; i < 10; i++) {
            await s.run(async () => { throw permanentError("x"); }).catch(() => undefined);
        }
        expect(s.state).toBe("closed");
        // The provider is still reachable for everything else.
        await expect(s.run(async () => "ok")).resolves.toBe("ok");
    });

    it("still opens the breaker for UNMARKED failures (negative control for the above)", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        for (let i = 0; i < 3; i++) {
            await s.run(async () => { throw new Error("x"); }).catch(() => undefined);
        }
        expect(s.state).toBe("open");
    });
});

/*
 * retryAfterMs IS ATTACKER-CONTROLLED. native.ts computes it as
 * `Number(retryAfter) * 1000` straight from the response's Retry-After header,
 * the providers attach it to the error unchanged, and the scheduler used to feed
 * it to setTimeout raw.
 *
 * setTimeout holds its delay in a SIGNED 32-BIT INT. At or above 2**31 ms the
 * value overflows and the timer fires almost immediately — so `Retry-After:
 * 2147484`, six digits and entirely plausible-looking, does not back off for
 * 24.9 days: it does not back off AT ALL. Every remaining attempt is fired at
 * once, against a provider that just said stop, on a key the user is billed for.
 */
describe("clampRetryAfterMs — a third party does not get to choose our timer", () => {
    it("passes an ordinary delay through untouched", () => {
        expect(clampRetryAfterMs(1234)).toBe(1234);
    });

    it("keeps a delay exactly at the maximum", () => {
        expect(clampRetryAfterMs(MAX_RETRY_AFTER_MS)).toBe(MAX_RETRY_AFTER_MS);
    });

    it("clamps one millisecond past the maximum (boundary)", () => {
        expect(clampRetryAfterMs(MAX_RETRY_AFTER_MS + 1)).toBe(MAX_RETRY_AFTER_MS);
    });

    it("clamps THE OVERFLOW VALUE ITSELF, 2**31 ms", () => {
        // 2_147_483_648. One above the largest signed 32-bit int; the first
        // value at which the timer wraps and fires immediately.
        expect(clampRetryAfterMs(2 ** 31)).toBe(MAX_RETRY_AFTER_MS);
        // And the ~2,147,484,000 ms figure the defect was reported as.
        expect(clampRetryAfterMs(2_147_484_000)).toBe(MAX_RETRY_AFTER_MS);
    });

    it("clamps the largest value below the overflow, so the fix does not depend on the wrap point", () => {
        expect(clampRetryAfterMs(2 ** 31 - 1)).toBe(MAX_RETRY_AFTER_MS);
    });

    it("treats a negative value as absent rather than as zero", () => {
        // undefined, not 0: the caller's `??` must fall through to exponential
        // backoff. Returning 0 would replace backoff with a busy retry, which is
        // the same defect through a different door.
        expect(clampRetryAfterMs(-1)).toBeUndefined();
        expect(clampRetryAfterMs(-(2 ** 31))).toBeUndefined();
    });

    it("treats NaN as absent — the case a sign test alone would miss", () => {
        // `Number("abc") * 1000` is NaN, and `NaN < 0` is false, so a bare
        // `value < 0` guard would hand NaN to setTimeout, where it becomes 1 ms.
        expect(clampRetryAfterMs(NaN)).toBeUndefined();
        expect(clampRetryAfterMs(Number("not-a-number") * 1000)).toBeUndefined();
    });

    it("treats Infinity as absent — the case Math.min alone would silently 'fix'", () => {
        // Math.min(Infinity, max) is max, so a clamp with no finiteness check
        // would quietly turn a nonsense header into a full-length real wait.
        expect(clampRetryAfterMs(Infinity)).toBeUndefined();
        expect(clampRetryAfterMs(-Infinity)).toBeUndefined();
    });

    it("treats a non-number as absent", () => {
        expect(clampRetryAfterMs(undefined)).toBeUndefined();
        expect(clampRetryAfterMs(null)).toBeUndefined();
        expect(clampRetryAfterMs("5000")).toBeUndefined();
    });

    it("keeps zero, because 'retry immediately' is a real and bounded instruction", () => {
        expect(clampRetryAfterMs(0)).toBe(0);
    });

    it("the maximum is a sane wait, not a decorative constant (guards the constant itself)", () => {
        // A maximum above the 32-bit wrap point would leave the overflow open.
        expect(MAX_RETRY_AFTER_MS).toBeLessThan(2 ** 31);
        // …and one below a second would make every clamped retry a busy loop.
        expect(MAX_RETRY_AFTER_MS).toBeGreaterThanOrEqual(1000);
    });
});

describe("Scheduler — the clamp is actually wired into the sleep", () => {
    it("sleeps the clamped maximum, not the overflowing value the server sent", async () => {
        const sleep = vi.fn(() => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep });
        let calls = 0;
        await s.run(async () => {
            if (++calls === 1) {
                throw Object.assign(new Error("slow down"), {
                    status: 429,
                    retryAfterMs: 2_147_484_000
                });
            }
            return "ok";
        });
        expect(sleep).toHaveBeenCalledWith(MAX_RETRY_AFTER_MS);
        // The raw value must never reach the timer.
        expect(sleep).not.toHaveBeenCalledWith(2_147_484_000);
    });

    it("falls back to exponential backoff when the header was garbage", async () => {
        const sleep = vi.fn(() => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep, baseDelayMs: 10, breakerThreshold: 99 });
        await s.run(async () => {
            throw Object.assign(new Error("x"), { status: 429, retryAfterMs: NaN });
        }).catch(() => undefined);

        const delays = sleep.mock.calls.map(c => c[0] as number);
        expect(delays).toEqual([10, 20, 40]);
        // Not a single NaN — which is what an unclamped `?? ` would have passed
        // straight through, NaN being neither null nor undefined.
        expect(delays.some(Number.isNaN)).toBe(false);
    });

    it("a small, legitimate Retry-After is still honoured exactly (negative control)", async () => {
        // Without this, a clamp broken into returning the maximum for everything
        // would pass every test above.
        const sleep = vi.fn(() => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep });
        let calls = 0;
        await s.run(async () => {
            if (++calls === 1) {
                throw Object.assign(new Error("x"), { status: 429, retryAfterMs: 1500 });
            }
            return "ok";
        });
        expect(sleep).toHaveBeenCalledWith(1500);
    });
});
