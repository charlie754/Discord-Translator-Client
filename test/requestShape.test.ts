/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * HttpTransport grew a second argument so a provider could POST a JSON body.
 *
 * It was added for core/providers/googleCloud.ts, because Cloud Translation v2
 * is POST-only. That provider has since been deleted along with every path that
 * could bill the user — but the second argument stays, because
 * core/providers/appsScript.ts POSTs too: a Web App deployment is reached with a
 * JSON body on /exec. The surface below is therefore still live, and dropping
 * these tests with the provider that first needed them would have left the one
 * that still uses it untested.
 *
 * That widened a surface PRIVACY.md makes a claim about. Before this change the
 * three transports could only issue a GET to an allow-listed host, so the worst
 * a page script could do with the relay was ask an allowed host a question. A
 * body turns the same relay into something that can PUSH, so the shaping rules
 * are as load-bearing as the hostname check and are tested the same way: in all
 * three transports, behaviourally, with the refusals spelled out one by one.
 *
 *   src/plugins/channelTranslator/native.ts   Electron main process (desktop)
 *   browser/translationHost.js                extension background (Chrome + Firefox)
 *   browser/translationBridge.ts              direct fetch (userscript, plain web)
 *   browser/content.js                        the page -> background relay
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An allow-listed host, and deliberately NOT script.google.com.
 *
 * Every assertion here is about the general shaping rule — the closed verb
 * union, the fixed Content-Type, the body cap, `redirect: "manual"` — which is
 * what all three transports apply to every host EXCEPT the one FOLLOW_MODE_HOSTS
 * names. Keying this file on the Apps Script host would test that exception
 * instead of the rule, and the two redirect assertions below would be asserting
 * the wrong mode. test/transportGuards.test.ts owns the exception.
 *
 * It used to be translation.googleapis.com, the paid Cloud Translation host.
 * That host was removed from all three allow-lists with the provider that used
 * it, so a fixture on it now measures the hostname refusal rather than the
 * shaping rule — which is why it moved to the free gtx host rather than simply
 * being left alone.
 */
const ALLOWED = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dj=1&q=hello";

const BODY = JSON.stringify({ q: "hello", target: "es", format: "text" });

/**
 * Every request option shape that must be refused, and the reason each one is
 * something a hostile page script would actually try.
 */
const MUST_REFUSE: [string, unknown][] = [
    ["a verb that is neither GET nor POST", { method: "PUT", body: BODY }],
    ["a DELETE", { method: "DELETE" }],
    ["lowercase post — the union is exact, not case-insensitive", { method: "post", body: BODY }],
    ["a body on a GET", { method: "GET", body: BODY }],
    ["a body with no method, which would be a GET", { body: BODY }],
    ["a POST with no body", { method: "POST" }],
    ["a non-string body", { method: "POST", body: { q: "hello" } }],
    ["a numeric body", { method: "POST", body: 42 }],
    // The whole reason HttpRequestInit has no headers field: a caller-named header
    // is a header-injection channel through the guard that exists to prevent one.
    ["a smuggled header", { method: "POST", body: BODY, headers: { Authorization: "Bearer x" } }],
    ["an unknown key", { method: "POST", body: BODY, credentials: "include" }],
    ["init that is not an object", "POST"],
    ["init that is an array", [{ method: "POST", body: BODY }]],
    ["an oversized body", { method: "POST", body: "x".repeat(1024 * 1024 + 1) }]
];

function okResponse(url = ALLOWED) {
    return {
        url,
        status: 200,
        text: async () => "ok",
        headers: { get: () => null }
    };
}

/** What a correctly shaped POST must look like on the wire, whichever transport sent it. */
function expectPostInit(init: any) {
    expect(init.method).toBe("POST");
    expect(init.body).toBe(BODY);
    // Fixed by the transport, never named by the caller.
    expect(init.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(Object.keys(init.headers).some(h => /^authorization$/i.test(h))).toBe(false);
}

describe("native.ts (desktop main process)", () => {
    afterEach(() => vi.unstubAllGlobals());

    async function ask(url: string, init?: unknown) {
        const { fetchTranslation } = await import("../src/plugins/channelTranslator/native");
        return fetchTranslation({} as any, url, init as any);
    }

    it("sends a POST with the body and a fixed JSON content type", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask(ALLOWED, { method: "POST", body: BODY });

        expect(res.status).toBe(200);
        expectPostInit(fetchMock.mock.calls[0][1]);
    });

    it("still sends a plain GET when no options are given", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        await ask(ALLOWED);

        const init = fetchMock.mock.calls[0][1] as any;
        expect(init.method).toBeUndefined();
        expect(init.body).toBeUndefined();
    });

    it("checks the host before the shape, so a bad host is still a host error", async () => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask("https://evil.test/x", { method: "PUT" });
        expect(res.body).toMatch(/is not an allowed translation host/);
    });

    it.each(MUST_REFUSE)("refuses %s", async (_label, init) => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(ALLOWED, init);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
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

    it("sends a POST with the body and a fixed JSON content type", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask(ALLOWED, { method: "POST", body: BODY });

        expect(res.status).toBe(200);
        expectPostInit(fetchMock.mock.calls[0][1]);
    });

    it("keeps credentials omitted on a POST, as it does on a GET", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        await ask(ALLOWED, { method: "POST", body: BODY });

        expect((fetchMock.mock.calls[0][1] as any).credentials).toBe("omit");
    });

    it("still sends a plain GET when the message carries no options", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        await ask(ALLOWED);

        const init = fetchMock.mock.calls[0][1] as any;
        expect(init.method).toBeUndefined();
        expect(init.body).toBeUndefined();
    });

    it("refuses a POST response that came from somewhere else", async () => {
        // This mock is a runtime that FOLLOWED the redirect despite the transport
        // asking for `redirect: "manual"` — a 200 that arrived from evil.test. By
        // then the body has already been replayed there, so refusing here withholds
        // the response and nothing more. The message says exactly that, rather than
        // the old "blocked after redirect", which read as though the request had
        // been stopped when it had not. The refusal that actually stops it lives in
        // test/transportGuards.test.ts, which asserts the target received nothing.
        vi.stubGlobal("fetch", vi.fn(async () => okResponse("https://evil.test/collected")));

        const res = await ask(ALLOWED, { method: "POST", body: BODY });
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked response origin:/);
    });

    it.each(MUST_REFUSE)("refuses %s", async (_label, init) => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(ALLOWED, init);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
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

    it("sends a POST with the body and a fixed JSON content type", async () => {
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        const res = await ask(ALLOWED, { method: "POST", body: BODY });

        expect(res.status).toBe(200);
        expectPostInit(fetchMock.mock.calls[0][1]);
    });

    it("sends a GET carrying nothing but redirect: manual", async () => {
        // This test used to assert `fetch` was called with ONE argument, to keep the
        // userscript path spelled exactly as it always had been. That is precisely
        // what left the free gtx provider on the default redirect mode — and gtx is
        // the provider whose URL carries the message text — so the assertion was
        // pinning the defect in place. It now asserts the opposite: the GET carries
        // the redirect refusal, and STILL carries nothing else, which is the part
        // that keeps GMPolyfill's GM_fetch behaving as before.
        const fetchMock = vi.fn(async () => okResponse());
        vi.stubGlobal("fetch", fetchMock);

        await ask(ALLOWED);

        expect(fetchMock.mock.calls[0]).toHaveLength(2);
        expect(fetchMock.mock.calls[0][1]).toEqual({ redirect: "manual" });
    });

    it.each(MUST_REFUSE)("refuses %s", async (_label, init) => {
        vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not be reached"); }));

        const res = await ask(ALLOWED, init);
        expect(res.status).toBe(0);
        expect(res.body).toMatch(/^blocked:/);
    });
});

describe("content.js (page -> background relay)", () => {
    let onMessage: (event: any) => void;
    let sent: any[];
    let posted: any[];

    beforeEach(async () => {
        vi.resetModules();
        sent = [];
        posted = [];

        vi.stubGlobal("chrome", {
            runtime: {
                lastError: undefined,
                sendMessage: (message: any, cb: (r: any) => void) => {
                    sent.push(message);
                    cb({ status: 200, body: "ok" });
                },
                getManifest: () => ({ version: "0.0.0" }),
                getURL: (p: string) => `chrome-extension://x/${p}`
            }
        });
        vi.stubGlobal("window", {
            addEventListener: (type: string, fn: any) => { if (type === "message") onMessage = fn; },
            postMessage: (m: any) => posted.push(m),
            location: { origin: "https://discord.com" }
        });
        vi.stubGlobal("document", { addEventListener: () => { } });

        await import("../browser/content.js");
    });

    afterEach(() => vi.unstubAllGlobals());

    function relay(init?: unknown) {
        onMessage({
            source: (globalThis as any).window,
            data: { type: "discordTranslator:fetch", id: 1, url: ALLOWED, init }
        });
    }

    it("registers its message listener at module scope", () => {
        expect(typeof onMessage).toBe("function");
    });

    it("carries a POST through to the background", () => {
        relay({ method: "POST", body: BODY });

        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe(ALLOWED);
        expect(sent[0].init).toEqual({ method: "POST", body: BODY });
    });

    it("carries a GET through with no options, exactly as before", () => {
        relay();

        expect(sent).toHaveLength(1);
        expect(sent[0].init).toBeUndefined();
    });

    it("rebuilds the options rather than forwarding the page's object", () => {
        // Structured clone already flattens the prototype, so what this pins is
        // that only the two known keys can ever cross: a key we do not name must
        // not ride along even if the shape check were ever loosened.
        relay({ method: "POST", body: BODY });
        expect(Object.keys(sent[0].init).sort()).toEqual(["body", "method"]);
    });

    it.each(MUST_REFUSE)("refuses %s rather than forwarding it", (_label, init) => {
        relay(init);

        // Refused at the hop out of the page's world, so nothing reached the
        // background at all — translationHost.js re-checks, but it never sees this.
        expect(sent).toHaveLength(0);
        expect(posted).toHaveLength(1);
        expect(posted[0].id).toBe(1);
        expect(posted[0].response.status).toBe(0);
        expect(posted[0].response.body).toMatch(/^blocked:/);
    });

    it("answers a refusal rather than dropping it, so the page promise resolves", () => {
        // Silence here would leave the bridge's 20s timeout as the only exit, and
        // the scheduler holds a concurrency slot open for the whole of it.
        relay({ method: "PUT" });

        expect(sent).toHaveLength(0);
        expect(posted).toHaveLength(1);
        expect(posted[0].type).toBe("discordTranslator:fetch:result");
        expect(posted[0].response.body).toMatch(/^blocked:/);
    });

    it("ignores a message from another frame", () => {
        onMessage({
            source: { not: "window" },
            data: { type: "discordTranslator:fetch", id: 2, url: ALLOWED }
        });
        expect(sent).toHaveLength(0);
        expect(posted).toHaveLength(0);
    });
});
