/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { createGoogleProvider } from "../../src/plugins/channelTranslator/core/providers/google";
import { protect, restore } from "../../src/plugins/channelTranslator/core/protect";
import type { HttpTransport } from "../../src/plugins/channelTranslator/core/providers/types";

const realHttp: HttpTransport = async url => {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    return { status: res.status, body: await res.text() };
};

const provider = createGoogleProvider(realHttp);

describe("live gtx endpoint contract", () => {
    it("translates a message longer than one request URL can carry", async () => {
        // Discord allows 2000 characters, 4000 with Nitro. The endpoint carries the
        // text in the query string and gives up around 16 KiB of URL, which CJK
        // reaches at roughly 1810 characters. Before the chunker this 400ed, was
        // retried three times, and five such messages latched the circuit breaker for
        // the rest of the session.
        const long = "这是一个测试。".repeat(330);
        expect(long.length).toBeGreaterThan(2000);

        const [r] = await provider.translate([long], "auto", "en");

        expect(r.sourceLang).toBe("zh-CN");
        expect(r.text.length).toBeGreaterThan(0);
        // Every chunk came back, so the translation is proportional to the input
        // rather than a single truncated first piece.
        expect(r.text.toLowerCase()).toContain("test");
        expect(r.text.length).toBeGreaterThan(1000);
    }, 90_000);

    it("keeps mentions intact across a chunk boundary", async () => {
        const source = Array.from({ length: 200 }, (_, i) =>
            `这是第${i}句话 <@12345678901234567> 结束。`).join("");
        const { masked, tokens } = protect(source);

        const [r] = await provider.translate([masked], "auto", "en");
        const restored = restore(r.text, tokens);

        // A sentinel cut in half restores as mojibake rather than a mention.
        expect(restored).toContain("<@12345678901234567>");
        expect(restored).not.toMatch(/|/);
    }, 90_000);

    it("returns the sentences/src/confidence shape we parse", async () => {
        const [r] = await provider.translate(["こんにちは"], "auto", "en");
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.sourceLang).toBe("ja");
    }, 20_000);

    it("passes PUA sentinels through untouched — the load-bearing assumption", async () => {
        const { masked, tokens } = protect("こんにちは <@123456789> さん");
        const [r] = await provider.translate([masked], "auto", "en");
        const restored = restore(r.text, tokens);
        expect(restored).toContain("<@123456789>");
    }, 20_000);

    it("does not corrupt a protected code fence", async () => {
        const input = "これを見て:\n```js\nconst a = 1;\n```";
        const { masked, tokens } = protect(input);
        const [r] = await provider.translate([masked], "auto", "en");
        expect(restore(r.text, tokens)).toContain("```js\nconst a = 1;\n```");
    }, 20_000);

    it("documents the known short-CJK misdetection rather than asserting it away", async () => {
        const [r] = await provider.translate(["了解"], "auto", "en");
        // Observed 2026-08-18: src=zh-CN, confidence 0.988, text "learn".
        // This test records reality; it is not a pass/fail gate on quality.
        console.log(`[contract] 了解 -> "${r.text}" src=${r.sourceLang} conf=${r.confidence}`);
        expect(typeof r.text).toBe("string");
    }, 20_000);
});
