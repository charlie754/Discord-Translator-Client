/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "../src/plugins/channelTranslator/core/providers/google";
import { registry } from "../src/plugins/channelTranslator/core/providers/registry";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";

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

describe("registry", () => {
    it("contains the google provider", () => {
        expect(registry.has("google")).toBe(true);
    });

    it("constructs a provider from the registry", () => {
        const make = registry.get("google")!;
        expect(make(okHttp).id).toBe("google");
    });
});
