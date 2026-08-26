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
 * Every host each copy is expected to hold. Spelled out here rather than derived
 * from one of the files, so that editing a file cannot quietly redefine the
 * expectation it is being measured against.
 *
 * translate.googleapis.com and translation.googleapis.com are two DIFFERENT
 * hosts — the free gtx endpoint and the paid Cloud Translation v2 API. Neither
 * is a subdomain of the other, and the exact-match guard treats them as the
 * unrelated third parties they are.
 *
 * script.google.com is the third Google host and the odd one out: it is not a
 * vendor endpoint but the host every user-deployed Apps Script Web App lives on.
 * Its absence from all three sets is what made the "apps-script" provider
 * unreachable while still being selectable in settings — every request was
 * refused by the transport guard, which is why it is pinned here.
 *
 * script.googleusercontent.com is the fourth Google host and the second half of
 * that same provider: a POST to /exec on script.google.com answers 302, and the
 * translation is served from THIS host. Nothing ever builds a URL on it —
 * checkDeploymentUrl() accepts only a script.google.com deployment URL — so it is
 * reached solely as the target of that redirect, after the Location has been
 * through the same checkUrl() the original URL went through. Adding
 * script.google.com alone left apps-script reachable and still unable to complete
 * a single request.
 */
const EXPECTED = [
    "api-free.deepl.com",
    "api.deepl.com",
    "script.google.com",
    "script.googleusercontent.com",
    "translate.googleapis.com",
    "translation.googleapis.com"
];

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
                expect(extractHosts("ALLOWED_HOSTS", path), label).toHaveLength(EXPECTED.length);
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

/*
 * The manifests are a SECOND gate, and they fail independently of the first.
 *
 * In the extension build the fetch happens in the background context, where the
 * browser — not this code — decides what may be reached: a host the transport
 * allows but the manifest does not grant is refused before translationHost.js is
 * consulted at all. So the allow-list above being right is necessary and not
 * sufficient, and nothing in this suite looked at the manifests until
 * script.google.com had to be added to both.
 *
 * scripts/checkExtensionPackages.mjs asserts the same thing — against its own
 * PROVIDER_HOSTS literal, which does not include script.google.com, and only
 * after a full extension build. This runs off the source manifests in
 * milliseconds and is measured against EXPECTED, so adding a transport host with
 * no manifest grant fails here rather than in a release build.
 */
describe("browser manifests", () => {
    const MANIFESTS = {
        "manifest.json (MV3)": "browser/manifest.json",
        "manifestv2.json (MV2)": "browser/manifestv2.json"
    } as const;

    function load(relativePath: string) {
        return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
    }

    /** MV3 splits host permissions out; MV2 mixes them into `permissions`. */
    function hostPatterns(manifest: any): string[] {
        const declared = manifest.host_permissions ?? manifest.permissions ?? [];
        return declared.filter((p: unknown): p is string => typeof p === "string");
    }

    /** MV3 is [{ resources, matches }]; MV2 is a flat list of strings. */
    function webAccessible(manifest: any): string[] {
        const declared = manifest.web_accessible_resources;
        if (!Array.isArray(declared)) return [];
        return declared.flatMap((entry: any) =>
            typeof entry === "string" ? [entry] : Array.isArray(entry?.resources) ? entry.resources : []);
    }

    it.each(Object.entries(MANIFESTS))("%s grants every allowed host", (_label, path) => {
        const patterns = hostPatterns(load(path));
        for (const host of EXPECTED) {
            expect(patterns.some(p => p.startsWith(`https://${host}/`)), host).toBe(true);
        }
    });

    it.each(Object.entries(MANIFESTS))("%s reads the hosts it was measured on (positive control)", (_label, path) => {
        // Without this, a manifest whose permissions key had been renamed would
        // return [] from hostPatterns() and the assertion above would fail loudly
        // — but a manifest granting <all_urls> and nothing else would pass it
        // vacuously only if startsWith were relaxed. Pin that the list is real.
        expect(hostPatterns(load(path)).length).toBeGreaterThanOrEqual(EXPECTED.length);
    });

    it.each(Object.entries(MANIFESTS))("%s makes guide.html web-accessible", (_label, path) => {
        // The plugin opens it with window.open() from a page in the discord.com
        // origin, which both engines refuse for an undeclared extension resource.
        // Presence in the package is a different question and is asserted by
        // scripts/checkExtensionPackages.mjs; this is reachability, and a guide
        // that ships but cannot be opened looks exactly like one that works.
        expect(webAccessible(load(path))).toContain("guide.html");
    });
});

/** URLs every transport must refuse. Each one is a mistake somebody could plausibly make. */
const MUST_REFUSE: [string, string][] = [
    ["plain http", "http://translate.googleapis.com/translate_a/single"],
    ["a lookalike prefix", "https://evil-translate.googleapis.com/x"],
    ["a lookalike suffix", "https://translate.googleapis.com.evil.test/x"],
    // "translation" and "translate" are both allowed; "translations" is not, and a
    // prefix or fuzzy match would not be able to tell.
    ["a near-miss on the cloud host", "https://translations.googleapis.com/language/translate/v2"],
    ["a deepl lookalike", "https://evil-deepl.com/v2/translate"],
    ["a subdomain", "https://a.api.deepl.com/v2/translate"],
    // The Apps Script host is shared by every deployment on the internet, so the
    // usual near-misses matter here too — and "scripts" is a plural nobody would
    // notice in a settings field.
    ["an apps script lookalike prefix", "https://evil-script.google.com/macros/s/x/exec"],
    ["an apps script lookalike suffix", "https://script.google.com.evil.test/macros/s/x/exec"],
    ["a near-miss on the apps script host", "https://scripts.google.com/macros/s/x/exec"],
    ["an apps script subdomain", "https://a.script.google.com/macros/s/x/exec"],
    // The host the Apps Script 302 lands on gets the same treatment: it is the
    // one an attacker would most like to be mistaken for, because it is the one
    // the transport reaches without the plugin ever building a URL for it.
    ["a user-content lookalike prefix", "https://evil-script.googleusercontent.com/macros/echo"],
    ["a user-content lookalike suffix", "https://script.googleusercontent.com.evil.test/macros/echo"],
    ["a user-content subdomain", "https://a.script.googleusercontent.com/macros/echo"],
    ["a user-content near-miss", "https://script.googleusercontents.com/macros/echo"],
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

    it("refuses a response that came from outside the list", async () => {
        // The transport asks for `redirect: "manual"`, so an allowed host answering
        // 302 is refused before anything is followed — asserted in
        // test/transportGuards.test.ts, which checks the redirect target received
        // nothing. This mock is the OTHER case: a runtime that followed the redirect
        // regardless and handed back a 200 from evil.test. The request is already
        // gone by then, so this refusal withholds the response and no more, and the
        // message no longer says "blocked after redirect" as though the request had
        // been stopped.
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://evil.test/collected")));

        const res = await ask("https://translate.googleapis.com/translate_a/single");
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked response origin:/);
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
