/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "../src/plugins/channelTranslator/core/providers/google";
import { registry } from "../src/plugins/channelTranslator/core/providers/registry";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/** Shape observed from the live gtx endpoint with dj=1. */
const okBody = JSON.stringify({
    sentences: [{ trans: "Hello", orig: "こんにちは" }],
    src: "ja",
    confidence: 0.98
});

const okHttp: HttpTransport = async () => ({ status: 200, body: okBody });

describe("google provider", () => {
    it("translates one string", async () => {
        const p = createGoogleProvider(okHttp);
        const [result] = await p.translate(["こんにちは"], "auto", "en");
        expect(result.text).toBe("Hello");
        expect(result.sourceLang).toBe("ja");
        expect(result.confidence).toBeCloseTo(0.98);
    });

    it("declares that it needs no API key", () => {
        expect(createGoogleProvider(okHttp).needsKey).toBe(false);
    });

    it("puts the target language in the request url", async () => {
        const http = vi.fn(okHttp);
        await createGoogleProvider(http).translate(["hi"], "auto", "fr");
        expect(http.mock.calls[0][0]).toContain("tl=fr");
    });

    it("url-encodes the query text", async () => {
        const http = vi.fn(okHttp);
        await createGoogleProvider(http).translate(["a b&c"], "auto", "en");
        expect(http.mock.calls[0][0]).toContain("a%20b%26c");
    });

    it("joins multi-sentence responses", async () => {
        const http: HttpTransport = async () => ({
            status: 200,
            body: JSON.stringify({
                sentences: [{ trans: "One. " }, { trans: "Two." }],
                src: "ja", confidence: 0.9
            })
        });
        const [r] = await createGoogleProvider(http).translate(["x"], "auto", "en");
        expect(r.text).toBe("One. Two.");
    });

    it("throws a RetryableError carrying the status on a 429", async () => {
        const http: HttpTransport = async () => ({ status: 429, body: "", retryAfterMs: 2000 });
        await expect(
            createGoogleProvider(http).translate(["x"], "auto", "en")
        ).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
    });

    it("throws on malformed json rather than returning junk", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: "<html>nope" });
        await expect(
            createGoogleProvider(http).translate(["x"], "auto", "en")
        ).rejects.toThrow();
    });

    it("defaults confidence to 0 when the field is absent", async () => {
        const http: HttpTransport = async () => ({
            status: 200,
            body: JSON.stringify({ sentences: [{ trans: "Hi" }], src: "ja" })
        });
        const [r] = await createGoogleProvider(http).translate(["x"], "auto", "en");
        expect(r.confidence).toBe(0);
    });
});

/*
 * The same classification as googleCloud.ts, and deliberately so. This endpoint
 * is free, so a retried malformed 200 costs no money — but it still costs four
 * requests, three backoff sleeps and four breaker strikes for a deterministic
 * answer that will be exactly as unparseable the fourth time. Keeping the two
 * providers the same shape means a reader comparing them does not have to work
 * out whether the difference was meaningful.
 */
describe("google provider — a malformed 200 is not retried", () => {
    const noSleep = () => Promise.resolve();
    const schedOpts = {
        concurrency: 2, maxRetries: 3, baseDelayMs: 1,
        breakerThreshold: 3, sleep: noSleep
    };

    const noSentences: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ src: "ja" }) });

    it("marks a 200 with no sentences array permanent", async () => {
        const err = await createGoogleProvider(noSentences).translate(["x"], "auto", "en").catch(e => e);
        expect(err.message).toContain("no sentences array");
        expect(isPermanent(err)).toBe(true);
    });

    it("marks a 200 whose body is not JSON permanent, with our own wording", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: "<html>nope" });
        const err = await createGoogleProvider(http).translate(["x"], "auto", "en").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toContain("google:");
        // Not the raw SyntaxError, and not the body quoted back.
        expect(err.message).not.toContain("<html>");
    });

    it("sends ONE request under the real scheduler, not four", async () => {
        const http = vi.fn(noSentences);
        const s = new Scheduler(schedOpts);
        const provider = createGoogleProvider(http);

        await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(1);
    });

    it("sends FOUR for an unmarked transient failure (positive control)", async () => {
        const http = vi.fn(async () => ({ status: 500, body: "" }));
        const s = new Scheduler({ ...schedOpts, breakerThreshold: 99 });
        const provider = createGoogleProvider(http);

        await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(4);
    });

    it("does not open the breaker on a run of malformed replies", async () => {
        const s = new Scheduler({ ...schedOpts, maxRetries: 0, breakerThreshold: 3 });
        const provider = createGoogleProvider(noSentences);

        for (let i = 0; i < 6; i++) {
            await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        }
        expect(s.state).toBe("closed");
    });

    it("leaves a 429 retryable — the marker did not leak onto status errors", async () => {
        const http: HttpTransport = async () => ({ status: 429, body: "", retryAfterMs: 5 });
        const err = await createGoogleProvider(http).translate(["x"], "auto", "en").catch(e => e);
        expect(isPermanent(err)).toBe(false);
    });
});

describe("registry", () => {
    it("contains the google provider", () => {
        expect(registry.has("google")).toBe(true);
    });

    it("constructs a provider from the registry", () => {
        const make = registry.get("google")!;
        expect(make(okHttp).id).toBe("google");
    });
});
