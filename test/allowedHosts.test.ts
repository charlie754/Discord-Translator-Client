/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The hostname allow-list is the only thing constraining where message text can
 * go, and it now exists in three places because there are three transports:
 *
 *   src/plugins/channelTranslator/native.ts   Electron main process (desktop)
 *   browser/translationHost.js                extension background (Chrome + Firefox)
 *   browser/translationBridge.ts              direct fetch (userscript, plain web)
 *
 * A guard that is copied is a guard that drifts, so this file asserts the three
 * sets are identical AND exercises the behaviour of each. PRIVACY.md makes a claim
 * about all three; this is what makes that claim testable rather than aspirational.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..");

const SOURCES = {
    "native.ts": "src/plugins/channelTranslator/native.ts",
    "translationHost.js": "browser/translationHost.js",
    "translationBridge.ts": "browser/translationBridge.ts"
} as const;

/**
 * The three hosts every copy is expected to hold. Spelled out here rather than
 * derived from one of the files, so that editing a file cannot quietly redefine
 * the expectation it is being measured against.
 */
const EXPECTED = ["api-free.deepl.com", "api.deepl.com", "translate.googleapis.com"];

/**
 * Pull the literal out of the source text. Reading source rather than importing the
 * value is deliberate: translationHost.js cannot be imported for its value, because
 * it is a classic script with no exports (MV2 background.scripts and MV3
 * importScripts both refuse a module), so source extraction is the only way to
 * compare all three the same way.
 */
function extractHosts(symbol: string, relativePath: string): string[] {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    const block = new RegExp(`${symbol}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
    if (!block) return [];

    return [...block[1].replace(/\/\/[^\n]*/g, "").matchAll(/"([^"]+)"/g)]
        .map(m => m[1])
        .sort();
}

describe("translation host allow-list", () => {
    describe("extraction", () => {
        it("finds the literal in every transport (positive control)", () => {
            for (const [label, path] of Object.entries(SOURCES)) {
                expect(extractHosts("ALLOWED_HOSTS", path), label).toHaveLength(3);
            }
        });

        it("returns nothing for a symbol that is absent (negative control)", () => {
            // Without this, an extractor that silently matched nothing would make
            // every comparison below pass vacuously.
            expect(extractHosts("NOT_A_REAL_SYMBOL", SOURCES["native.ts"])).toEqual([]);
        });
    });

    it("is identical across all three transports", () => {
        for (const [label, path] of Object.entries(SOURCES)) {
            expect(extractHosts("ALLOWED_HOSTS", path), label).toEqual(EXPECTED);
        }
    });

    it("declares every entry in scripts/allowed-hosts.txt", () => {
        const declared = new Set(
            readFileSync(join(ROOT, "scripts/allowed-hosts.txt"), "utf8")
                .split("\n")
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("#"))
        );

        for (const host of EXPECTED) expect(declared.has(host), host).toBe(true);
    });
});

/** URLs every transport must refuse. Each one is a mistake somebody could plausibly make. */
const MUST_REFUSE: [string, string][] = [
    ["plain http", "http://translate.googleapis.com/translate_a/single"],
    ["a lookalike prefix", "https://evil-translate.googleapis.com/x"],
    ["a lookalike suffix", "https://translate.googleapis.com.evil.test/x"],
    ["a deepl lookalike", "https://evil-deepl.com/v2/translate"],
    ["a subdomain", "https://a.api.deepl.com/v2/translate"],
    ["loopback", "https://localhost/translate"],
    ["a file url", "file:///etc/passwd"],
    ["nonsense", "not a url at all"]
];

const MUST_ALLOW = EXPECTED.map(h => `https://${h}/path?q=1`);

function okResponse(url = "https://translate.googleapis.com/x") {
    return {
        url,
        status: 200,
        text: async () => "ok",
        headers: { get: () => null }
    };
}

describe("native.ts (desktop main process)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each(MUST_REFUSE)("refuses %s", async (_label, url) => {
        const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await fetchTranslation({} as any, url);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
    });

    it.each(MUST_ALLOW)("allows %s", async url => {
        const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(url)));

        const res = await fetchTranslation({} as any, url);
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
    });
});

describe("translationHost.js (extension background)", () => {
    let listener: (m: any, s: any, respond: (r: any) => void) => unknown;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("chrome", {
            runtime: { onMessage: { addListener: (l: any) => { listener = l; } } }
        });
        await import("../browser/translationHost.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    function ask(url: string) {
        return new Promise<any>(resolve => {
            const kept = listener({ action: "discordTranslator:fetch", url }, null, resolve);
            // MV3 closes the message channel unless the listener returns true, which
            // would drop every async reply on the floor.
            expect(kept).toBe(true);
        });
    }

    it("registers its listener at module scope", () => {
        expect(typeof listener).toBe("function");
    });

    it("ignores a message that is not ours", () => {
        expect(listener({ action: "somethingElse" }, null, () => { })).toBeUndefined();
    });

    it.each(MUST_REFUSE)("refuses %s", async (_label, url) => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(url);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
    });

    it.each(MUST_ALLOW)("allows %s", async url => {
        vi.stubGlobal("fetch", vi.fn(async (u: string) => okResponse(u)));

        const res = await ask(url);
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
    });

    it("refuses a redirect that lands outside the list", async () => {
        // An allowed host answering with a 302 elsewhere would otherwise carry the
        // message text to an arbitrary origin: fetch follows redirects by default.
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://evil.test/collected")));

        const res = await ask("https://translate.googleapis.com/translate_a/single");
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked after redirect:/);
    });
});

describe("translationBridge.ts (userscript and plain web)", () => {
    beforeEach(() => {
        vi.resetModules();
        // The direct path is the one that carries the guard. The extension path
        // delegates to translationHost.js, covered above.
        vi.stubGlobal("IS_EXTENSION", false);
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each(MUST_REFUSE)("refuses %s", async (_label, url) => {
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ChannelTranslatorHelper.fetchTranslation(url);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
    });

    it.each(MUST_ALLOW)("allows %s", async url => {
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(url)));

        const res = await ChannelTranslatorHelper.fetchTranslation(url);
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
    });
});
