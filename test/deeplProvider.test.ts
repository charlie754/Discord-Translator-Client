/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import {
    createDeeplProvider,
    endpointForKey,
    toSourceLang,
    toTargetLang
} from "../src/plugins/channelTranslator/core/providers/deepl";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/** Shape DeepL documents for POST/GET /v2/translate. */
const okBody = JSON.stringify({
    translations: [{ detected_source_language: "JA", text: "Hello" }]
});

const okHttp: HttpTransport = async () => ({ status: 200, body: okBody });

const KEY = "test-key-0000";
const withKey = (http: HttpTransport) => createDeeplProvider(http, { apiKey: KEY });

describe("deepl provider — request shape", () => {
    it("translates one string and lowercases the detected language", async () => {
        const [r] = await withKey(okHttp).translate(["こんにちは"], "auto", "en");
        expect(r.text).toBe("Hello");
        // Downstream (cache key, selection.ts reverse-translate check) compares
        // against lowercase BCP-47, which is what the google provider returns.
        expect(r.sourceLang).toBe("ja");
        expect(r.confidence).toBe(0);
    });

    it("declares that it needs an API key", () => {
        expect(withKey(okHttp).needsKey).toBe(true);
    });

    it("routes a free key to api-free.deepl.com and a paid key to api.deepl.com", () => {
        expect(endpointForKey("abc:fx")).toBe("https://api-free.deepl.com/v2/translate");
        expect(endpointForKey("abc")).toBe("https://api.deepl.com/v2/translate");
    });

    it("maps the two language cases DeepL gets wrong under a naive uppercase", () => {
        expect(toTargetLang("zh-TW")).toBe("ZH-HANT");
        expect(toTargetLang("en")).toBe("EN-US");
        // Unmapped region subtags are dropped rather than forwarded to a 400.
        expect(toTargetLang("de-AT")).toBe("DE");
        expect(toSourceLang("pt-br")).toBe("PT");
    });

    it("omits source_lang for auto-detect and sends it otherwise", async () => {
        const auto = vi.fn(okHttp);
        await withKey(auto).translate(["hi"], "auto", "fr");
        expect(auto.mock.calls[0][0]).not.toContain("source_lang=");

        const fixed = vi.fn(okHttp);
        await withKey(fixed).translate(["hi"], "ja", "fr");
        expect(fixed.mock.calls[0][0]).toContain("source_lang=JA");
    });

    it("url-encodes the query text", async () => {
        const http = vi.fn(okHttp);
        await withKey(http).translate(["a b&c"], "auto", "en");
        expect(http.mock.calls[0][0]).toContain("a%20b%26c");
    });
});

/*
 * The same classification as googleCloud.ts and google.ts, and deliberately so.
 * DeepL is a PAID provider: a 200 has already been counted against the key's
 * character quota whether or not the body parses, so retrying it four times pays
 * four times for an answer that is deterministic and will be exactly as
 * unreadable the fourth time — and then counts all four toward opening the
 * breaker, taking down whichever provider the user switches to next.
 */
describe("deepl provider — a malformed 200 is not retried", () => {
    const noSleep = () => Promise.resolve();
    const schedOpts = {
        concurrency: 2, maxRetries: 3, baseDelayMs: 1,
        breakerThreshold: 3, sleep: noSleep
    };

    const noTranslations: HttpTransport = async () => ({ status: 200, body: JSON.stringify({}) });

    it("marks a 200 with no translations array permanent", async () => {
        const err = await withKey(noTranslations).translate(["x"], "auto", "en").catch(e => e);
        expect(err.message).toContain("no translations array");
        expect(isPermanent(err)).toBe(true);
    });

    it("marks an empty translations array permanent too", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ translations: [] }) });
        const err = await withKey(http).translate(["x"], "auto", "en").catch(e => e);
        expect(isPermanent(err)).toBe(true);
    });

    it("marks a 200 whose body is not JSON permanent, with our own wording", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: "<html>nope" });
        const err = await withKey(http).translate(["x"], "auto", "en").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toContain("deepl:");
        // Not the raw SyntaxError, and not the third-party body quoted back.
        expect(err.message).not.toContain("<html>");
    });

    it("sends ONE request under the real scheduler, not four", async () => {
        const http = vi.fn(noTranslations);
        const s = new Scheduler(schedOpts);
        const provider = withKey(http);

        await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(1);
    });

    it("sends FOUR for an unmarked transient failure (positive control)", async () => {
        const http = vi.fn(async () => ({ status: 500, body: "" }));
        const s = new Scheduler({ ...schedOpts, breakerThreshold: 99 });
        const provider = withKey(http);

        await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(4);
    });

    it("does not open the breaker on a run of malformed replies", async () => {
        const s = new Scheduler({ ...schedOpts, maxRetries: 0, breakerThreshold: 3 });
        const provider = withKey(noTranslations);

        for (let i = 0; i < 6; i++) {
            await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        }
        expect(s.state).toBe("closed");
    });
});

describe("deepl provider — status errors keep their existing classification", () => {
    it("throws a RetryableError carrying the status and retryAfterMs on a 429", async () => {
        const http: HttpTransport = async () => ({ status: 429, body: "", retryAfterMs: 2000 });
        await expect(
            withKey(http).translate(["x"], "auto", "en")
        ).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
    });

    it("leaves a 429 retryable — the permanence marker did not leak onto status errors", async () => {
        const http: HttpTransport = async () => ({ status: 429, body: "", retryAfterMs: 5 });
        const err = await withKey(http).translate(["x"], "auto", "en").catch(e => e);
        expect(isPermanent(err)).toBe(false);
    });

    it("leaves a 503 retryable", async () => {
        const http: HttpTransport = async () => ({ status: 503, body: "" });
        const err = await withKey(http).translate(["x"], "auto", "en").catch(e => e);
        expect(isPermanent(err)).toBe(false);
    });

    it("explains 403 and 456 rather than showing a bare number", async () => {
        const forbidden: HttpTransport = async () => ({ status: 403, body: "" });
        const quota: HttpTransport = async () => ({ status: 456, body: "" });

        const a = await withKey(forbidden).translate(["x"], "auto", "en").catch(e => e);
        expect(a.message).toContain("rejected the API key");
        // 4xx that is not 429 — already permanent by status, no marker needed.
        expect(isPermanent(a)).toBe(true);

        const b = await withKey(quota).translate(["x"], "auto", "en").catch(e => e);
        expect(b.message).toContain("quota exhausted");
        expect(isPermanent(b)).toBe(true);
    });
});

describe("deepl provider — a missing key is not a retryable failure", () => {
    it("marks the no-key error permanent and never touches the transport", async () => {
        const http = vi.fn(okHttp);
        const err = await createDeeplProvider(http, { apiKey: "  " })
            .translate(["x"], "auto", "en").catch(e => e);

        expect(err.message).toContain("no API key configured");
        expect(isPermanent(err)).toBe(true);
        expect(http).not.toHaveBeenCalled();
    });

    it("does not open the breaker on a run of no-key failures", async () => {
        const s = new Scheduler({
            concurrency: 2, maxRetries: 3, baseDelayMs: 1,
            breakerThreshold: 3, sleep: () => Promise.resolve()
        });
        const provider = createDeeplProvider(okHttp, {});

        for (let i = 0; i < 6; i++) {
            await s.run(() => provider.translate(["x"], "auto", "en")).catch(() => undefined);
        }
        expect(s.state).toBe("closed");
    });
});
