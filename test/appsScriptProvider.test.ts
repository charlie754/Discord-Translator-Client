/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Nothing here touches the network. There is no Apps Script deployment in this
 * repo and there never will be, so every response below is a recorded shape —
 * the proxy contract, and the two things Google itself puts in the way of a
 * misconfigured deployment: a sign-in page and a quota refusal.
 */

import { describe, expect, it, vi } from "vitest";
import {
    APPS_SCRIPT_HOST,
    checkDeploymentUrl,
    createAppsScriptProvider,
    isQuotaMessage
} from "../src/plugins/channelTranslator/core/providers/appsScript";
import { registry, resolveProvider } from "../src/plugins/channelTranslator/core/providers/registry";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/** A deployment URL of the shape Google hands out. Not a real deployment. */
const URL_OK = "https://script.google.com/macros/s/AKfycbxTESTdeploymentIDnotreal123456/exec";

/** The editor URL — what a user copies out of the address bar while looking at their script. */
const URL_PROJECT = "https://script.google.com/home/projects/1a2b3c4d5e6f/edit";

function replyWith(...translations: string[]) {
    return JSON.stringify({ translations });
}

const okHttp: HttpTransport = async () => ({ status: 200, body: replyWith("Hola") });

function responding(status: number, body = "", retryAfterMs?: number): HttpTransport {
    return async () => ({ status, body, retryAfterMs });
}

describe("apps script provider — identity", () => {
    it("declares the id and label the settings, the registry and the guide all use", () => {
        const p = createAppsScriptProvider(okHttp, { apiKey: URL_OK });
        expect(p.id).toBe("apps-script");
        expect(p.label).toBe("Google Apps Script (your own free proxy)");
    });

    it("declares that it needs a key — the key being the deployment URL", () => {
        expect(createAppsScriptProvider(okHttp, { apiKey: URL_OK }).needsKey).toBe(true);
    });
});

describe("apps script provider — no URL configured", () => {
    it("is refused by the registry with a reason a user can act on", () => {
        const resolution = resolveProvider("apps-script", okHttp, {});
        expect(resolution.ok).toBe(false);
        if (resolution.ok) throw new Error("unreachable");
        expect(resolution.reason).toContain("Google Apps Script (your own free proxy)");
        // The refusal names the thing the user must actually go and find. "API key"
        // here would send them looking for a field that does not exist.
        expect(resolution.reason).toContain("Web App URL");
        expect(resolution.reason).not.toContain("API key");
    });

    it("is refused for a URL that is only whitespace", () => {
        expect(resolveProvider("apps-script", okHttp, { apiKey: "   " }).ok).toBe(false);
    });

    it("is constructed once a URL is present (negative control for the two above)", () => {
        // Without this, a resolveProvider that refused EVERYTHING would make both
        // assertions above pass while proving nothing.
        expect(resolveProvider("apps-script", okHttp, { apiKey: URL_OK }).ok).toBe(true);
    });

    it("still says \"an API key\" for a key-requiring provider that names no noun of its own", () => {
        // WHAT THIS USED TO ASSERT, and why it is written this way now. It used to
        // resolve "deepl" and "google-cloud" and check that the per-provider noun
        // had not changed the wording for them. Both providers are deleted, so
        // that version now passes on `Unknown translation provider "deepl".` —
        // which contains neither noun and proves nothing about either.
        //
        // The DEFAULT_CREDENTIAL_NOUN branch in resolveProvider() is still live
        // code and apps-script is the only entry that overrides it, so the branch
        // has no caller in the shipped registry. Rather than delete the coverage
        // or fake it with a string comparison, a key-requiring provider is put in
        // the registry for the length of this test and taken out again — so the
        // real resolveProvider() really does take the default branch.
        const id = "test-only-key-provider";
        registry.set(id, () => ({
            id,
            label: "Test Provider",
            needsKey: true,
            translate: async () => { throw new Error("must not be reached"); }
        }));
        try {
            const refused = resolveProvider(id, okHttp, {});
            if (refused.ok) throw new Error("unreachable");
            expect(refused.reason).toContain("needs an API key of your own");
            // …and the apps-script override is genuinely an override, not the
            // default text with different words around it.
            expect(refused.reason).not.toContain("Web App URL");
        } finally {
            registry.delete(id);
        }
        // Left exactly as it was found: a leaked entry would make the free-only
        // registry assertions below depend on test ordering.
        expect(registry.has(id)).toBe(false);
    });

    it("throws rather than sending a URL-less request if it is called anyway", async () => {
        const http = vi.fn(okHttp);
        const err = await createAppsScriptProvider(http, {}).translate(["hi"], "auto", "es").catch(e => e);

        expect(err.message).toContain("no Web App URL configured");
        expect(isPermanent(err)).toBe(true);
        expect(http).not.toHaveBeenCalled();
    });
});

describe("apps script provider — the URL is validated before anything is sent", () => {
    it("accepts the consumer deployment URL and normalises it", () => {
        const check = checkDeploymentUrl(URL_OK);
        expect(check.ok).toBe(true);
        if (!check.ok) throw new Error("unreachable");
        expect(check.url).toBe(URL_OK);
    });

    it("accepts the Workspace form, which is the only URL such an account is given", () => {
        const workspace =
            "https://script.google.com/a/macros/example.com/s/AKfycbxTESTdeployment123/exec";
        expect(checkDeploymentUrl(workspace).ok).toBe(true);
    });

    it("tolerates surrounding whitespace from a copy-paste", () => {
        expect(checkDeploymentUrl(`  ${URL_OK}\n`).ok).toBe(true);
    });

    it("drops a query string and fragment rather than forwarding them", () => {
        const check = checkDeploymentUrl(`${URL_OK}?foo=bar#frag`);
        if (!check.ok) throw new Error("unreachable");
        // What the transport receives is exactly what was checked.
        expect(check.url).toBe(URL_OK);
    });

    /*
     * The mistake this provider exists to survive. The editor URL is on screen at
     * the moment the user is told to copy a URL, so it is the one they copy — and
     * it is not a typo, so a generic "invalid URL" would send them back to paste
     * the identical string again.
     */
    it("names the PROJECT-url mistake specifically instead of saying \"invalid\"", () => {
        const check = checkDeploymentUrl(URL_PROJECT);
        expect(check.ok).toBe(false);
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("EDITOR");
        expect(check.reason).toContain("Manage deployments");
        expect(check.reason).toContain("/exec");
    });

    it("names the project-url mistake for the /u/0/ and /d/ variants too", () => {
        for (const url of [
            "https://script.google.com/u/0/home/projects/1a2b3c/edit",
            "https://script.google.com/d/1a2b3c4d5e/edit",
            "https://script.google.com/home"
        ]) {
            const check = checkDeploymentUrl(url);
            expect(check.ok, url).toBe(false);
            if (check.ok) throw new Error("unreachable");
            expect(check.reason, url).toContain("EDITOR");
        }
    });

    it("names the /dev twin specifically — it answers only the script's owner", () => {
        const check = checkDeploymentUrl(
            "https://script.google.com/macros/s/AKfycbxTESTdeployment123/dev"
        );
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("/dev");
        expect(check.reason).toContain("/exec");
    });

    it("refuses a wrong host and says which host was expected", () => {
        for (const url of [
            "https://scripts.google.com/macros/s/AKfycbxTEST123/exec",
            "https://script.google.com.evil.test/macros/s/AKfycbxTEST123/exec",
            "https://evil.test/macros/s/AKfycbxTEST123/exec",
            "https://docs.google.com/macros/s/AKfycbxTEST123/exec"
        ]) {
            const check = checkDeploymentUrl(url);
            expect(check.ok, url).toBe(false);
            if (check.ok) throw new Error("unreachable");
            expect(check.reason, url).toContain(APPS_SCRIPT_HOST);
        }
    });

    it("refuses plain http", () => {
        const check = checkDeploymentUrl(URL_OK.replace("https:", "http:"));
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("https://");
    });

    it("refuses embedded credentials rather than silently stripping them", () => {
        const check = checkDeploymentUrl(
            "https://user:pass@script.google.com/macros/s/AKfycbxTEST123/exec"
        );
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("username or password");
    });

    it("refuses text that is not a URL at all", () => {
        const check = checkDeploymentUrl("my apps script");
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("not a web address");
    });

    it("refuses a path on the right host that is not a deployment", () => {
        const check = checkDeploymentUrl("https://script.google.com/macros/s/AKfycbxTEST123");
        if (check.ok) throw new Error("unreachable");
        expect(check.reason).toContain("/exec");
    });

    it("never sends a request when the URL is malformed, and does not retry it", async () => {
        const http = vi.fn(okHttp);
        const err = await createAppsScriptProvider(http, { apiKey: URL_PROJECT })
            .translate(["hi"], "auto", "es")
            .catch(e => e);

        expect(http).not.toHaveBeenCalled();
        expect(err.message).toContain("apps-script:");
        expect(err.message).toContain("EDITOR");
        // The string in the settings field is exactly as wrong on the fourth attempt.
        expect(isPermanent(err)).toBe(true);
    });
});

describe("apps script provider — a successful translation", () => {
    it("returns the translated text", async () => {
        const [r] = await createAppsScriptProvider(okHttp, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es");

        expect(r.text).toBe("Hola");
        // The proxy contract carries translations only, so nothing is detected.
        expect(r.sourceLang).toBe("auto");
        expect(r.confidence).toBe(0);
    });

    it("POSTs the documented JSON body to the deployment URL", async () => {
        const http = vi.fn(okHttp);
        await createAppsScriptProvider(http, { apiKey: URL_OK }).translate(["Hello"], "auto", "es");

        const [url, init] = http.mock.calls[0];
        expect(url).toBe(URL_OK);
        expect(new URL(url).hostname).toBe(APPS_SCRIPT_HOST);

        expect(init).toBeDefined();
        expect(init!.method).toBe("POST");
        expect(JSON.parse(init!.body!)).toEqual({ q: ["Hello"], target: "es", source: "" });
    });

    it("names no header at all — the transport fixes the content type", async () => {
        const http = vi.fn(okHttp);
        await createAppsScriptProvider(http, { apiKey: URL_OK }).translate(["Hello"], "auto", "es");

        expect(Object.keys(http.mock.calls[0][1] as object).sort()).toEqual(["body", "method"]);
    });

    it("sends an empty source to auto-detect, and a real one otherwise", async () => {
        const http = vi.fn(okHttp);
        const p = createAppsScriptProvider(http, { apiKey: URL_OK });

        await p.translate(["Hello"], "auto", "es");
        expect(JSON.parse(http.mock.calls[0][1]!.body!).source).toBe("");

        await p.translate(["Hello"], "en", "es");
        expect(JSON.parse(http.mock.calls[1][1]!.body!).source).toBe("en");
    });

    it("maps the target language the way the Google providers do", async () => {
        const http = vi.fn(okHttp);
        await createAppsScriptProvider(http, { apiKey: URL_OK }).translate(["Hello"], "auto", "zh-TW");
        // Not "zh": plain zh returns Simplified to someone who asked for 繁體中文.
        expect(JSON.parse(http.mock.calls[0][1]!.body!).target).toBe("zh-TW");
    });

    it("translates a whole batch in ONE request, in order", async () => {
        const http = vi.fn(async () => ({ status: 200, body: replyWith("uno", "dos", "tres") }));
        const results = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate(["one", "two", "three"], "auto", "es");

        // The scarce resource here is CALLS — 5,000 a day — so one call for three
        // messages is three times the day's usable translation.
        expect(http).toHaveBeenCalledTimes(1);
        expect(JSON.parse(http.mock.calls[0][1]!.body!).q).toEqual(["one", "two", "three"]);
        expect(results.map(r => r.text)).toEqual(["uno", "dos", "tres"]);
    });

    it("sends nothing at all for an empty batch", async () => {
        const http = vi.fn(okHttp);
        const results = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate([], "auto", "es");

        expect(results).toEqual([]);
        expect(http).not.toHaveBeenCalled();
    });
});

describe("apps script provider — the sign-in page", () => {
    /*
     * A deployment left at "Who has access: Only myself" does not answer with an
     * error. It answers with Google's login page, and the user sees a translator
     * that silently does nothing. Every shape that arrives as is asserted here,
     * because the cause is one thing and the symptoms are three.
     */
    const EXPECTED = ["Who has access", "Anyone", "Manage deployments"];

    function expectAccessHint(err: Error) {
        for (const phrase of EXPECTED) expect(err.message, phrase).toContain(phrase);
        expect(err.message).toContain("apps-script:");
    }

    it("explains an HTML page returned at HTTP 200", async () => {
        const http = responding(200, "<!DOCTYPE html><html><head><title>Sign in</title>");
        const err = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expectAccessHint(err);
        // Not the raw parse failure, and not the page quoted back at the user.
        expect(err.message).not.toContain("<html");
        expect(err.message).not.toContain("JSON");
        expect(isPermanent(err)).toBe(true);
    });

    it("explains a 302 that the transport handed back rather than followed", async () => {
        const http = responding(302, "");
        const err = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expectAccessHint(err);
        expect(err.message).toContain("HTTP 302");
        // 3xx is NOT in the 4xx band isPermanent() keys off, so without the
        // explicit marker this would have been retried four times against a
        // deployment whose access setting cannot change in between.
        expect(isPermanent(err)).toBe(true);
    });

    it("explains the transport's own refusal to follow that redirect", async () => {
        // The exact string all three transports return: see REDIRECT_REFUSAL in
        // src/plugins/channelTranslator/native.ts.
        const http = responding(0, "blocked: refused to follow a redirect away from the translation host");
        const err = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expectAccessHint(err);
        expect(isPermanent(err)).toBe(true);
    });

    it("explains a 403 the same way", async () => {
        const err = await createAppsScriptProvider(responding(403), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expectAccessHint(err);
        expect(err.status).toBe(403);
    });
});

describe("apps script provider — the daily quota", () => {
    /** The exact wording Apps Script uses when the day's allowance is spent. */
    const QUOTA_BODY = JSON.stringify({
        error: "Exception: Service invoked too many times for one day: translate."
    });

    it("recognises the quota wording, and only the quota wording", () => {
        expect(isQuotaMessage("Service invoked too many times for one day: translate.")).toBe(true);
        expect(isQuotaMessage("You have exceeded your quota")).toBe(true);
        expect(isQuotaMessage("daily limit reached")).toBe(true);
        // A negative control: an unrelated failure must not be reclassified as a
        // quota problem, which would tell the user to wait for a rollover that
        // will not fix anything.
        expect(isQuotaMessage("TypeError: cannot read property q of undefined")).toBe(false);
    });

    it("says what the ceiling is, that it resets, and that it is not a bill", async () => {
        const err = await createAppsScriptProvider(responding(200, QUOTA_BODY), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.message).toContain("apps-script:");
        expect(err.message).toContain("5,000");
        expect(err.message).toContain("resets");
        expect(err.message).toContain("costs nothing");
        expect(err.message).toContain("no billing");
    });

    it("quotes the script's own words back, capped and stripped", async () => {
        const noisy = JSON.stringify({ error: `too many times ${"x".repeat(500)}` });
        const err = await createAppsScriptProvider(responding(200, noisy), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        // Capped at 200 characters of third-party text, so a hostile or broken
        // deployment cannot paste a wall into the user's client.
        expect(err.message).not.toContain("x".repeat(300));
        expect(err.message).toContain("The script said:");
    });

    it("is not retried — three more calls out of a spent daily allowance buy nothing", async () => {
        const http = vi.fn(responding(200, QUOTA_BODY));
        const s = new Scheduler({
            concurrency: 2, maxRetries: 3, baseDelayMs: 1,
            breakerThreshold: 3, sleep: () => Promise.resolve()
        });
        const provider = createAppsScriptProvider(http, { apiKey: URL_OK });

        await s.run(() => provider.translate(["Hello"], "auto", "es")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(1);
    });

    it("leaves a real 429 retryable, carrying the status and Retry-After", async () => {
        // The infrastructure rate limit is a different thing from the daily quota
        // and it does clear on its own, so the marker must not have leaked onto it.
        const err = await createAppsScriptProvider(responding(429, "", 2000), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(2000);
        expect(isPermanent(err)).toBe(false);
    });
});

describe("apps script provider — a malformed but successful response is permanent", () => {
    const noSleep = () => Promise.resolve();
    const schedOpts = {
        concurrency: 2, maxRetries: 3, baseDelayMs: 1,
        breakerThreshold: 3, sleep: noSleep
    };

    const noTranslations: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ ok: true }) });

    it("marks a 200 with no translations array permanent", async () => {
        const err = await createAppsScriptProvider(noTranslations, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.message).toContain("no translations array");
        expect(isPermanent(err)).toBe(true);
    });

    it("marks a 200 whose body is not JSON permanent, with our own wording", async () => {
        // Not HTML — that is the sign-in case above. This is a body that is simply
        // not parseable, which is what a half-edited script returns.
        const err = await createAppsScriptProvider(responding(200, "translations: Hola"), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toContain("apps-script:");
        expect(err.message).toContain("re-deployed");
        // Not the raw SyntaxError, and not the body quoted back.
        expect(err.message).not.toContain("translations: Hola");
    });

    it("refuses a length mismatch rather than putting a translation under the wrong message", async () => {
        const short: HttpTransport = async () => ({ status: 200, body: replyWith("uno") });
        const err = await createAppsScriptProvider(short, { apiKey: URL_OK })
            .translate(["one", "two"], "auto", "es").catch(e => e);

        expect(err.message).toContain("1 translations");
        expect(err.message).toContain("2 messages");
        expect(isPermanent(err)).toBe(true);
    });

    it("refuses a translation that is not text", async () => {
        const weird: HttpTransport = async () => ({ status: 200, body: JSON.stringify({ translations: [42] }) });
        const err = await createAppsScriptProvider(weird, { apiKey: URL_OK })
            .translate(["one"], "auto", "es").catch(e => e);

        expect(err.message).toContain("not text");
        expect(isPermanent(err)).toBe(true);
    });

    it("refuses a JSON body that is not a reply object", async () => {
        const err = await createAppsScriptProvider(responding(200, "[1,2,3]"), { apiKey: URL_OK })
            .translate(["one"], "auto", "es").catch(e => e);

        expect(err.message).toContain("not a reply object");
        expect(isPermanent(err)).toBe(true);
    });

    it("reports an { error } that is not about quota, quoting the script", async () => {
        const body = JSON.stringify({ error: "TypeError: cannot read property q of undefined" });
        const err = await createAppsScriptProvider(responding(200, body), { apiKey: URL_OK })
            .translate(["one"], "auto", "es").catch(e => e);

        expect(err.message).toContain("reported an error rather than a translation");
        expect(err.message).toContain("TypeError");
        expect(err.message).not.toContain("5,000");
        expect(isPermanent(err)).toBe(true);
    });

    it("sends ONE request under the real scheduler, not four", async () => {
        const http = vi.fn(noTranslations);
        const s = new Scheduler(schedOpts);
        const provider = createAppsScriptProvider(http, { apiKey: URL_OK });

        await s.run(() => provider.translate(["Hello"], "auto", "es")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(1);
    });

    it("sends FOUR for an unmarked transient failure (positive control)", async () => {
        // Without this, a provider that marked EVERYTHING permanent would make the
        // assertion above pass while proving nothing.
        const http = vi.fn(responding(500));
        const s = new Scheduler({ ...schedOpts, breakerThreshold: 99 });
        const provider = createAppsScriptProvider(http, { apiKey: URL_OK });

        await s.run(() => provider.translate(["Hello"], "auto", "es")).catch(() => undefined);
        expect(http).toHaveBeenCalledTimes(4);
    });

    it("does not open the breaker on a run of malformed replies", async () => {
        const s = new Scheduler({ ...schedOpts, maxRetries: 0, breakerThreshold: 3 });
        const provider = createAppsScriptProvider(noTranslations, { apiKey: URL_OK });

        for (let i = 0; i < 6; i++) {
            await s.run(() => provider.translate(["Hello"], "auto", "es")).catch(() => undefined);
        }
        expect(s.state).toBe("closed");
    });
});

describe("apps script provider — the request that never left the machine", () => {
    it("treats a bare network failure as transient", async () => {
        // native.ts returns { status: 0, body: String(err) } for a fetch that fell
        // over. That is the one status-0 case worth retrying.
        const http = vi.fn(responding(0, "TypeError: fetch failed"));
        const err = await createAppsScriptProvider(http, { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(isPermanent(err)).toBe(false);
        expect(err.message).toContain("network");
    });

    it("treats a host-allow-list refusal as permanent, and says it is a build problem", async () => {
        const blocked = `blocked: https://${APPS_SCRIPT_HOST} is not an allowed translation host`;
        const err = await createAppsScriptProvider(responding(0, blocked), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toContain(APPS_SCRIPT_HOST);
        expect(err.message).toContain("report it");
    });

    it("treats any other transport refusal as permanent", async () => {
        const err = await createAppsScriptProvider(
            responding(0, "blocked: a translation URL must not carry embedded credentials"),
            { apiKey: URL_OK }
        ).translate(["Hello"], "auto", "es").catch(e => e);

        expect(isPermanent(err)).toBe(true);
        expect(err.message).toContain("refused before it was sent");
    });
});

describe("apps script provider — other HTTP statuses", () => {
    it("explains a 404 as a deployment that has moved or gone", async () => {
        const err = await createAppsScriptProvider(responding(404), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.message).toContain("HTTP 404");
        expect(err.message).toContain("Manage deployments");
        expect(err.status).toBe(404);
    });

    it("says a 500 is the user's own script and where to read it", async () => {
        const err = await createAppsScriptProvider(responding(500), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.message).toContain("Executions");
        expect(isPermanent(err)).toBe(false);
    });

    it("still reports a status it has no hint for", async () => {
        const err = await createAppsScriptProvider(responding(418), { apiKey: URL_OK })
            .translate(["Hello"], "auto", "es").catch(e => e);

        expect(err.message).toBe("apps-script: HTTP 418");
    });
});

describe("registry", () => {
    it("contains the apps script provider", () => {
        expect(registry.has("apps-script")).toBe(true);
    });

    it("holds the free default, and NOTHING that can bill anyone", () => {
        // This used to read "still contains the three that were there before" and
        // named deepl and google-cloud. Both are deleted: they took an API key of
        // the user's own and charged them per character, and the operator's ruling
        // was to remove them rather than discourage them.
        //
        // The promise "no configuration of this plugin can put a charge on
        // anyone" is a property of THIS MAP and of nothing downstream — the spend
        // meter and the cap that used to sit behind it are gone too. So the map is
        // pinned exhaustively rather than by membership: a new entry has to come
        // past this line and be argued for.
        expect([...registry.keys()].sort()).toEqual(["apps-script", "google"]);
        expect(registry.has("deepl")).toBe(false);
        expect(registry.has("google-cloud")).toBe(false);
    });

    it("constructs it from the registry", () => {
        const make = registry.get("apps-script")!;
        expect(make(okHttp, { apiKey: URL_OK }).id).toBe("apps-script");
    });
});
