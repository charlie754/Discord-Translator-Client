/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Nothing here touches the network. There is no Google Cloud key in this repo and
 * there never will be, so every response below is a recorded shape from Google's
 * own v2 documentation rather than a live call.
 */

import { describe, expect, it, vi } from "vitest";
import {
    createGoogleCloudProvider,
    decodeEntities,
    toLanguageCode
} from "../src/plugins/channelTranslator/core/providers/googleCloud";
import { registry, resolveProvider } from "../src/plugins/channelTranslator/core/providers/registry";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

const KEY = "test-key-not-a-real-one";

function bodyFor(translatedText: string, detected?: string) {
    return JSON.stringify({
        data: {
            translations: [
                detected === undefined
                    ? { translatedText }
                    : { translatedText, detectedSourceLanguage: detected }
            ]
        }
    });
}

const okHttp: HttpTransport = async () => ({ status: 200, body: bodyFor("Hola", "en") });

function failing(status: number, body = "", retryAfterMs?: number): HttpTransport {
    return async () => ({ status, body, retryAfterMs });
}

describe("google cloud provider — identity", () => {
    it("declares the id and label the settings and the guide both use", () => {
        const p = createGoogleCloudProvider(okHttp, { apiKey: KEY });
        expect(p.id).toBe("google-cloud");
        expect(p.label).toBe("Google Cloud Translation (your own key)");
    });

    it("declares that it needs a key", () => {
        expect(createGoogleCloudProvider(okHttp, { apiKey: KEY }).needsKey).toBe(true);
    });
});

describe("google cloud provider — no key", () => {
    it("is refused by the registry with a reason a user can act on", () => {
        const resolution = resolveProvider("google-cloud", okHttp, {});
        expect(resolution.ok).toBe(false);
        if (resolution.ok) throw new Error("unreachable");
        expect(resolution.reason).toContain("Google Cloud Translation (your own key)");
        expect(resolution.reason).toContain("API key");
    });

    it("is refused for a key that is only whitespace", () => {
        expect(resolveProvider("google-cloud", okHttp, { apiKey: "   " }).ok).toBe(false);
    });

    it("is constructed once a key is present (negative control for the two above)", () => {
        // Without this, a resolveProvider that refused EVERYTHING would make both
        // assertions above pass while proving nothing.
        expect(resolveProvider("google-cloud", okHttp, { apiKey: KEY }).ok).toBe(true);
    });

    it("throws rather than sending a keyless request if it is called anyway", async () => {
        const http = vi.fn(okHttp);
        await expect(
            createGoogleCloudProvider(http, {}).translate(["hi"], "auto", "es")
        ).rejects.toThrow(/no API key configured/);
        expect(http).not.toHaveBeenCalled();
    });
});

describe("google cloud provider — a successful translation", () => {
    it("returns the translated text and the detected source language", async () => {
        const [r] = await createGoogleCloudProvider(okHttp, { apiKey: KEY })
            .translate(["Hello"], "auto", "es");

        expect(r.text).toBe("Hola");
        // Lowercased, because the cache key and selection.ts's reverse-translate
        // check both compare against lowercase tags.
        expect(r.sourceLang).toBe("en");
        expect(r.confidence).toBe(0);
    });

    it("POSTs a JSON body to the v2 endpoint on translation.googleapis.com", async () => {
        const http = vi.fn(okHttp);
        await createGoogleCloudProvider(http, { apiKey: KEY }).translate(["Hello"], "auto", "es");

        const [url, init] = http.mock.calls[0];
        expect(url).toBe(
            `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(KEY)}`
        );
        // Note the host: "translation", not the "translate" the free provider uses.
        expect(new URL(url).hostname).toBe("translation.googleapis.com");

        expect(init).toBeDefined();
        expect(init!.method).toBe("POST");
        expect(JSON.parse(init!.body!)).toEqual({ q: "Hello", target: "es", format: "text" });
    });

    it("names no header at all — the transport fixes the content type", async () => {
        const http = vi.fn(okHttp);
        await createGoogleCloudProvider(http, { apiKey: KEY }).translate(["Hello"], "auto", "es");

        expect(Object.keys(http.mock.calls[0][1] as object).sort()).toEqual(["body", "method"]);
    });

    it("omits source when asked to auto-detect, and sends it otherwise", async () => {
        const http = vi.fn(okHttp);
        const p = createGoogleCloudProvider(http, { apiKey: KEY });

        await p.translate(["Hello"], "auto", "es");
        expect(JSON.parse(http.mock.calls[0][1]!.body!).source).toBeUndefined();

        await p.translate(["Hello"], "en", "es");
        expect(JSON.parse(http.mock.calls[1][1]!.body!).source).toBe("en");
    });

    it("falls back to \"auto\" when the reply carries no detected language", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: bodyFor("Hola") });
        const [r] = await createGoogleCloudProvider(http, { apiKey: KEY })
            .translate(["Hello"], "en", "es");
        expect(r.sourceLang).toBe("auto");
    });

    it("translates each text in its own request", async () => {
        const http = vi.fn(okHttp);
        await createGoogleCloudProvider(http, { apiKey: KEY })
            .translate(["one", "two"], "auto", "es");

        expect(http).toHaveBeenCalledTimes(2);
        expect(JSON.parse(http.mock.calls[0][1]!.body!).q).toBe("one");
        expect(JSON.parse(http.mock.calls[1][1]!.body!).q).toBe("two");
    });

    it("does not chunk a message far longer than the free endpoint's URL ceiling", async () => {
        // google.ts splits at roughly 1800 CJK characters because the free endpoint
        // carries the text in the URL. A POST body has no such limit, so this must
        // go out as ONE request — the point of deciding not to port the chunker.
        const http = vi.fn(okHttp);
        const long = "这是一个测试。".repeat(400);
        expect(long.length).toBeGreaterThan(2000);

        await createGoogleCloudProvider(http, { apiKey: KEY }).translate([long], "auto", "en");

        expect(http).toHaveBeenCalledTimes(1);
        expect(JSON.parse(http.mock.calls[0][1]!.body!).q).toBe(long);
    });

    it("throws on a 200 whose body is not the shape we parse", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ data: {} }) });
        await expect(
            createGoogleCloudProvider(http, { apiKey: KEY }).translate(["x"], "auto", "es")
        ).rejects.toThrow(/no translations array/);
    });

    it("throws on malformed json rather than returning junk", async () => {
        await expect(
            createGoogleCloudProvider(failing(200, "<html>nope"), { apiKey: KEY })
                .translate(["x"], "auto", "es")
        ).rejects.toThrow();
    });
});

describe("google cloud provider — error classification", () => {
    it("explains a 403 as an unenabled API or a restricted key, not a typo", async () => {
        const body = JSON.stringify({
            error: { code: 403, message: "Cloud Translation API has not been used in project 1234 before or it is disabled." }
        });

        const err = await createGoogleCloudProvider(failing(403, body), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(err.status).toBe(403);
        expect(err.message).toContain("Cloud Translation API");
        expect(err.message).toMatch(/not be enabled|restrictions/);
        // Google's own words are quoted back, because they are usually more precise.
        expect(err.message).toContain("Google said:");
    });

    it("marks a 403 permanent so the scheduler stops retrying a missing key", async () => {
        const { isPermanent } = await import("../src/plugins/channelTranslator/core/scheduler");
        const err = await createGoogleCloudProvider(failing(403), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(isPermanent(err)).toBe(true);
    });

    it("explains a 429 as quota, and carries retryAfterMs through", async () => {
        const err = await createGoogleCloudProvider(failing(429, "", 2000), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(2000);
        expect(err.message).toMatch(/quota|rate limit/i);
        expect(err.message).toContain("500,000");
    });

    it("leaves a 429 retryable so the breaker does not treat quota as a dead provider", async () => {
        const err = await createGoogleCloudProvider(failing(429), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(isPermanent(err)).toBe(false);
    });

    /*
     * Cloud Translation ships with NO characters-per-day limit — the only default
     * is 6,000,000 characters per MINUTE, which ordinary chat cannot approach. So
     * a 429 here is nearly always a cap the user set on the quota page themselves,
     * and it does not clear in seconds. The scheduler still retries it (the test
     * above), so the message has to explain why the retries are not helping.
     */
    it("names the user's own daily cap as the likely cause of a 429", async () => {
        const err = await createGoogleCloudProvider(failing(429), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(err.message).toMatch(/characters-per-day|per day/i);
        expect(err.message).toMatch(/your own project|you set/i);
        // And says what ends it, so the user is not left watching the panel.
        expect(err.message).toMatch(/quota window resets|rolls over/i);
    });

    it("does not tell the user a 429 will clear shortly", async () => {
        const err = await createGoogleCloudProvider(failing(429), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.message).toMatch(/will not clear in a few seconds|not clear in a few seconds/i);
    });

    /*
     * Finding 4. The 500,000 is not a project-wide allowance and not a stop: it is
     * a monthly credit of up to USD 10 that "applies collectively to both Cloud
     * Translation - Basic and Cloud Translation - Advanced" and does not roll over.
     * Google's pricing page states no project-vs-billing-account scope, so neither
     * does this string.
     */
    it("describes the free allowance as a monthly credit, not a project-wide cap", async () => {
        const err = await createGoogleCloudProvider(failing(429), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(err.message).toMatch(/credit/i);
        expect(err.message).toMatch(/USD 10/);
        expect(err.message).toMatch(/does not roll over/i);
        expect(err.message).toContain("USD 20 per million");

        // The claim that was wrong, and a scope Google's pricing page never states.
        expect(err.message).not.toMatch(/across the whole project/i);
        expect(err.message).not.toMatch(/whole project/i);
    });

    it("says the credit is shared between the two Cloud Translation editions", async () => {
        const err = await createGoogleCloudProvider(failing(429), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.message).toMatch(/collectively/i);
        expect(err.message).toMatch(/Basic and Advanced/);
    });

    /*
     * Google answers a MALFORMED API KEY with 400 and the body
     * "API key not valid. Please pass a valid API key." — the same status an
     * unsupported target language code produces. The hint used to name only the
     * language code, so a user who mistyped their key was sent to the Language
     * setting, where nothing was wrong.
     */
    it("explains a 400 as a key problem FIRST, and a language code second", async () => {
        const err = await createGoogleCloudProvider(failing(400, JSON.stringify({
            error: { message: "API key not valid. Please pass a valid API key." }
        })), { apiKey: KEY }).translate(["x"], "auto", "es").catch(e => e);

        expect(err.status).toBe(400);

        // Both causes are named — the language code is real too, just rarer.
        const keyAt = err.message.indexOf("API key");
        const langAt = err.message.indexOf("language");
        expect(keyAt).toBeGreaterThanOrEqual(0);
        expect(langAt).toBeGreaterThanOrEqual(0);

        // Ordering is the whole fix: the first thing the user reads must be the
        // likelier cause. An assertion that both words merely appear would have
        // passed against the old wording too.
        expect(keyAt).toBeLessThan(langAt);

        // Google's own words still come through, and here they settle which it was.
        expect(err.message).toContain("API key not valid");
    });

    it("still names the language code for a 400 that really is one", async () => {
        const err = await createGoogleCloudProvider(failing(400, JSON.stringify({
            error: { message: "Invalid Value" }
        })), { apiKey: KEY }).translate(["x"], "auto", "xx").catch(e => e);

        expect(err.message).toContain("Language setting");
        expect(err.message).toContain("Invalid Value");
    });

    it("still reports a status it has no hint for", async () => {
        const err = await createGoogleCloudProvider(failing(418), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.message).toContain("418");
    });

    it("never puts the API key in the error message", async () => {
        const err = await createGoogleCloudProvider(failing(403, "not json"), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.message).not.toContain(KEY);
    });

    it("survives an error body that is not JSON at all", async () => {
        const err = await createGoogleCloudProvider(failing(500, "<html>502 Bad Gateway"), { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.message).toContain("500");
        expect(err.message).not.toContain("Google said:");
    });

    it("strips control characters out of the quoted error", async () => {
        const err = await createGoogleCloudProvider(
            failing(400, JSON.stringify({ error: { message: "bad\u0000value\u001B[31m red" } })),
            { apiKey: KEY }
        ).translate(["x"], "auto", "es").catch(e => e);

        expect(err.message).not.toMatch(/[\u0000-\u001F\u007F]/);
    });
});

/*
 * FINDING 1 — the billed-and-discarded retry loop.
 *
 * This provider is billed by the character, and Google charges for the
 * characters in the REQUEST: "You are charged for all characters that you
 * include in a Cloud Translation request, even untranslated characters." An
 * HTTP 200 whose body we cannot parse has therefore already cost the user money.
 * Before the fix that error carried no status, isPermanent() classed anything
 * status-less as transient, and the scheduler sent the identical request to the
 * identical deterministic endpoint four times — paying four times for four
 * replies it discarded, then counting all four toward opening the breaker.
 */
describe("google cloud provider — a malformed 200 is paid for once, not four times", () => {
    const noSleep = () => Promise.resolve();
    const schedOpts = {
        concurrency: 2, maxRetries: 3, baseDelayMs: 1,
        breakerThreshold: 3, sleep: noSleep
    };

    const emptyData: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ data: {} }) });
    const notJson: HttpTransport = async () => ({ status: 200, body: "<html>nope" });

    it("marks a 200 with no translations array permanent", async () => {
        const err = await createGoogleCloudProvider(emptyData, { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(err.message).toContain("no translations array");
        expect(isPermanent(err)).toBe(true);
    });

    it("marks a 200 whose body is not JSON permanent", async () => {
        const err = await createGoogleCloudProvider(notJson, { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        // A raw SyntaxError from JSON.parse would carry the parser's own wording
        // and no marker at all; this is our own error, and it says what it cost.
        expect(err.message).toContain("google-cloud");
        expect(err.message).toMatch(/billed/i);
    });

    it("does not quote the unparseable body back at the user", async () => {
        const err = await createGoogleCloudProvider(
            async () => ({ status: 200, body: "<html>Sign in to your account</html>" }),
            { apiKey: KEY }
        ).translate(["x"], "auto", "es").catch(e => e);

        expect(err.message).not.toContain("Sign in");
        expect(err.message).not.toContain("<html>");
        // A bare JSON.parse would let V8's own SyntaxError through — which quotes
        // the first ten characters of the body verbatim and reads like a plugin
        // crash rather than a provider that answered badly.
        expect(err.message).not.toMatch(/Unexpected token|not valid JSON/i);
    });

    it("attaches no invented HTTP status — the response really was a 200", async () => {
        const err = await createGoogleCloudProvider(emptyData, { apiKey: KEY })
            .translate(["x"], "auto", "es").catch(e => e);
        expect(err.status).toBeUndefined();
        expect(err.message).not.toMatch(/HTTP 5\d\d/);
    });

    it("costs ONE request under the real scheduler, not four", async () => {
        // The end-to-end measurement, and the one that is about money: how many
        // times the transport is actually invoked when the provider is driven
        // through the scheduler the plugin really uses.
        const http = vi.fn(emptyData);
        const s = new Scheduler(schedOpts);
        const provider = createGoogleCloudProvider(http, { apiKey: KEY });

        await s.run(() => provider.translate(["x"], "auto", "es")).catch(() => undefined);

        expect(http).toHaveBeenCalledTimes(1);
    });

    it("costs FOUR requests when the error is unmarked (positive control)", async () => {
        // The pre-fix behaviour, reproduced against the same scheduler so the
        // "1" above is a measured difference rather than a number that would
        // read the same if retrying had quietly stopped working everywhere.
        const http = vi.fn(async () => ({ status: 500, body: "" }));
        const s = new Scheduler({ ...schedOpts, breakerThreshold: 99 });
        const provider = createGoogleCloudProvider(http, { apiKey: KEY });

        await s.run(() => provider.translate(["x"], "auto", "es")).catch(() => undefined);

        expect(http).toHaveBeenCalledTimes(4);
    });

    it("a run of malformed replies does not open the breaker", async () => {
        const s = new Scheduler({ ...schedOpts, maxRetries: 0, breakerThreshold: 3 });
        const provider = createGoogleCloudProvider(emptyData, { apiKey: KEY });

        for (let i = 0; i < 6; i++) {
            await s.run(() => provider.translate(["x"], "auto", "es")).catch(() => undefined);
        }

        expect(s.state).toBe("closed");
    });

    it("a missing key is permanent too — four retries of a request never sent", async () => {
        const http = vi.fn(okHttp);
        const s = new Scheduler(schedOpts);
        const provider = createGoogleCloudProvider(http, {});

        const err = await s.run(() => provider.translate(["x"], "auto", "es")).catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toMatch(/no API key configured/);
        expect(http).not.toHaveBeenCalled();
        // And it does not drag the breaker down with it, which used to end
        // translation for whichever provider the user switched to next.
        expect(s.state).toBe("closed");
    });

    it("a genuinely transient failure is still retried (negative control)", async () => {
        // The fix must not have made everything permanent. A 500 is exactly the
        // case retries exist for.
        const http = vi.fn<HttpTransport>();
        http.mockResolvedValueOnce({ status: 500, body: "" });
        http.mockResolvedValue({ status: 200, body: bodyFor("Hola", "en") });

        const s = new Scheduler(schedOpts);
        const provider = createGoogleCloudProvider(http, { apiKey: KEY });

        const [r] = await s.run(() => provider.translate(["x"], "auto", "es"));

        expect(r.text).toBe("Hola");
        expect(http).toHaveBeenCalledTimes(2);
    });
});

describe("google cloud provider — language mapping", () => {
    it.each([
        // The one that matters most: "zh" alone returns Simplified to someone who
        // explicitly asked for Traditional.
        ["zh-TW", "zh-TW"],
        ["zh-tw", "zh-TW"],
        ["zh-HK", "zh-TW"],
        ["zh-Hant", "zh-TW"],
        ["zh", "zh-CN"],
        ["zh-CN", "zh-CN"],
        ["zh-Hans", "zh-CN"],
        // v2's language list uses the legacy spellings for these three.
        ["he", "iw"],
        ["jv", "jw"],
        ["fil", "tl"],
        // Everything else is the base subtag; v2 would 400 on a region it does not know.
        ["en", "en"],
        ["en-GB", "en"],
        ["pt-BR", "pt"],
        ["ja", "ja"],
        ["  ES  ", "es"]
    ])("maps %s to %s", (tag, expected) => {
        expect(toLanguageCode(tag)).toBe(expected);
    });

    it("puts the mapped target in the request body, not the raw setting", async () => {
        const http = vi.fn(okHttp);
        await createGoogleCloudProvider(http, { apiKey: KEY }).translate(["x"], "auto", "zh-TW");
        expect(JSON.parse(http.mock.calls[0][1]!.body!).target).toBe("zh-TW");
    });

    it("maps the source language too", async () => {
        const http = vi.fn(okHttp);
        await createGoogleCloudProvider(http, { apiKey: KEY }).translate(["x"], "he", "en");
        expect(JSON.parse(http.mock.calls[0][1]!.body!).source).toBe("iw");
    });
});

describe("google cloud provider — the entities v2 returns even for format=text", () => {
    it.each([
        ["don&#39;t", "don't"],
        ["Tom &amp; Jerry", "Tom & Jerry"],
        ["a &lt; b &gt; c", "a < b > c"],
        ["&quot;quoted&quot;", "\"quoted\""],
        ["nothing to decode", "nothing to decode"]
    ])("decodes %s", (raw, expected) => {
        expect(decodeEntities(raw)).toBe(expected);
    });

    it("decodes in one pass, so &amp;lt; does not become a tag", () => {
        // Sequential replacement would turn this into "<", inventing markup that
        // was never in the message.
        expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    });

    it("leaves a numeric entity that could forge a protect() sentinel alone", () => {
        // core/protect.ts masks mentions with U+E000..U+E001. A general numeric
        // decoder would let the provider's reply synthesise one.
        expect(decodeEntities("&#57344;1&#57345;")).toBe("&#57344;1&#57345;");
    });

    it("applies the decode to the text the provider returns", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: bodyFor("don&#39;t", "en") });
        const [r] = await createGoogleCloudProvider(http, { apiKey: KEY })
            .translate(["x"], "auto", "en");
        expect(r.text).toBe("don't");
    });
});

describe("registry", () => {
    it("contains the google cloud provider under the id the settings use", () => {
        expect(registry.has("google-cloud")).toBe(true);
    });

    it("still contains the two providers that were there before", () => {
        expect(registry.has("google")).toBe(true);
        expect(registry.has("deepl")).toBe(true);
    });

    it("constructs it from the registry", () => {
        const make = registry.get("google-cloud")!;
        expect(make(okHttp, { apiKey: KEY }).id).toBe("google-cloud");
    });
});
