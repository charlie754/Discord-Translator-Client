/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * A long message used to end translation for the whole session.
 *
 * The gtx endpoint carries the text in the query string, so it limits URL length,
 * not characters. Measured against the live endpoint by binary search: 16352
 * characters of URL succeed, 16514 fail with HTTP 400. encodeURIComponent inflates
 * CJK about ninefold, so ~1810 Chinese characters is the ceiling while English of
 * the same length is nowhere near it. Discord allows 2000 characters, 4000 with
 * Nitro, so this is ordinary use.
 *
 * Nothing guarded the length, nothing marked a 4xx as permanent, so the request
 * was retried three times and then counted as a breaker failure. Five such
 * messages latched the breaker, and reset() had no production call site.
 *
 * These tests pin all three halves of the fix: the chunker, the permanence
 * classification, and the breaker's recovery.
 */

import { describe, expect, it, vi } from "vitest";
import { chunkForUrl } from "../src/plugins/channelTranslator/core/providers/google";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/** Rebuilt exactly as google.ts builds it, so the budget under test is the real one. */
function urlLength(text: string, from = "auto", to = "en"): number {
    return ("https://translate.googleapis.com/translate_a/single" +
        `?client=gtx&sl=${encodeURIComponent(from)}` +
        `&tl=${encodeURIComponent(to)}&dt=t&dj=1&q=${encodeURIComponent(text)}`).length;
}

/** The measured ceiling. Every chunk must come in under it with margin to spare. */
const HARD_LIMIT = 16_384;

const OPEN = "";
const CLOSE = "";

describe("chunkForUrl", () => {
    it("leaves a short message as a single chunk, unchanged", () => {
        const text = "这是一个测试。";
        expect(chunkForUrl(text, "auto", "en")).toEqual([text]);
    });

    it("leaves a long ASCII message alone, because URL length is what matters", () => {
        // 1800 characters of English is far below the ceiling, while 1800 characters
        // of Chinese is above it. A character-count guard would have split this.
        const text = "the quick brown fox. ".repeat(90);
        expect(text.length).toBeGreaterThan(1800);
        expect(urlLength(text)).toBeLessThan(HARD_LIMIT);
        expect(chunkForUrl(text, "auto", "en")).toHaveLength(1);
    });

    it("splits a message that would exceed the URL ceiling", () => {
        const text = "这是一个测试。".repeat(400);
        expect(urlLength(text)).toBeGreaterThan(HARD_LIMIT);

        const chunks = chunkForUrl(text, "auto", "en");
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(urlLength(c)).toBeLessThan(HARD_LIMIT);
    });

    it("loses nothing: the chunks rejoin to the original", () => {
        const text = "早安，世界。".repeat(500);
        expect(chunkForUrl(text, "auto", "en").join("")).toBe(text);
    });

    it("never cuts a protect() sentinel in half", () => {
        // Sentinels stand in for mentions, code spans and URLs. Half a sentinel is
        // not restorable, so the mention would come back as mojibake.
        const withTokens = Array.from({ length: 400 }, (_, i) =>
            `这是一个测试${OPEN}${i}${CLOSE}的句子。`).join("");

        const chunks = chunkForUrl(withTokens, "auto", "en");
        expect(chunks.length).toBeGreaterThan(1);

        for (const c of chunks) {
            expect(c.split(OPEN).length).toBe(c.split(CLOSE).length);
            // and no chunk may start mid-token or end with a dangling opener
            expect(c.startsWith(CLOSE)).toBe(false);
            expect(c.endsWith(OPEN)).toBe(false);
        }
        expect(chunks.join("")).toBe(withTokens);
    });

    it("splits a wall of text with no sentence endings at all", () => {
        const text = "这".repeat(4000);
        const chunks = chunkForUrl(text, "auto", "en");
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(urlLength(c)).toBeLessThan(HARD_LIMIT);
        expect(chunks.join("")).toBe(text);
    });

    it("accounts for the language pair, not just the text", () => {
        // A longer language code eats budget too; the chunker builds the real URL
        // rather than assuming a fixed prefix.
        const text = "これはテストです。".repeat(350);
        for (const c of chunkForUrl(text, "auto", "zh-TW")) {
            expect(urlLength(c, "auto", "zh-TW")).toBeLessThan(HARD_LIMIT);
        }
    });
});

describe("isPermanent", () => {
    it.each([400, 401, 403, 404, 413, 422])("treats HTTP %i as permanent", status => {
        expect(isPermanent(Object.assign(new Error("x"), { status }))).toBe(true);
    });

    it.each([429, 500, 502, 503])("treats HTTP %i as worth retrying", status => {
        expect(isPermanent(Object.assign(new Error("x"), { status }))).toBe(false);
    });

    it("treats an error with no status as worth retrying", () => {
        // Network and parse failures arrive this way and are genuinely transient.
        expect(isPermanent(new Error("network down"))).toBe(false);
    });
});

const opts = {
    concurrency: 2,
    maxRetries: 3,
    baseDelayMs: 1,
    breakerThreshold: 5,
    sleep: async () => { }
};

describe("Scheduler and permanent errors", () => {
    it("does not retry a permanent error", async () => {
        const fn = vi.fn().mockRejectedValue(Object.assign(new Error("400"), { status: 400 }));
        const s = new Scheduler(opts);

        await expect(s.run(fn)).rejects.toThrow("400");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("still retries a transient error", async () => {
        const fn = vi.fn().mockRejectedValue(Object.assign(new Error("503"), { status: 503 }));
        const s = new Scheduler(opts);

        await expect(s.run(fn)).rejects.toThrow("503");
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it("a run of permanent errors never opens the breaker", async () => {
        // This is the defect: five over-long messages disabled translation entirely.
        const fn = vi.fn().mockRejectedValue(Object.assign(new Error("400"), { status: 400 }));
        const s = new Scheduler(opts);

        for (let i = 0; i < 20; i++) await expect(s.run(fn)).rejects.toThrow();
        expect(s.state).toBe("closed");
    });

    it("transient errors still open it", async () => {
        const fn = vi.fn().mockRejectedValue(Object.assign(new Error("503"), { status: 503 }));
        const s = new Scheduler(opts);

        for (let i = 0; i < 5; i++) await expect(s.run(fn)).rejects.toThrow();
        expect(s.state).toBe("open");
    });
});

describe("Scheduler breaker recovery", () => {
    it("closes itself after the cooldown", async () => {
        let clock = 1_000;
        const s = new Scheduler({ ...opts, breakerCooldownMs: 30_000, now: () => clock });
        const fail = vi.fn().mockRejectedValue(Object.assign(new Error("503"), { status: 503 }));

        for (let i = 0; i < 5; i++) await expect(s.run(fail)).rejects.toThrow();
        expect(s.state).toBe("open");

        clock += 29_000;
        expect(s.state).toBe("open");

        clock += 2_000;
        expect(s.state).toBe("closed");

        await expect(s.run(async () => "back")).resolves.toBe("back");
    });

    it("reopens on a single failure after half-opening", async () => {
        let clock = 0;
        const s = new Scheduler({ ...opts, breakerCooldownMs: 10, now: () => clock });
        const fail = vi.fn().mockRejectedValue(Object.assign(new Error("503"), { status: 503 }));

        for (let i = 0; i < 5; i++) await expect(s.run(fail)).rejects.toThrow();
        clock += 100;
        expect(s.state).toBe("closed");

        // The failure count survives the half-open, so one more failure is enough.
        await expect(s.run(fail)).rejects.toThrow();
        expect(s.state).toBe("open");
    });
});
