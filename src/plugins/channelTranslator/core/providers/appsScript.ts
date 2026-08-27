/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { permanentError } from "../scheduler";
import type { TranslateResult } from "../types";
import { toLanguageCode } from "./languageCodes";
import type { HttpTransport, ProviderConfig, TranslationProvider } from "./types";

/**
 * Google Apps Script — a translation proxy the USER deploys, on the user's own
 * Google account, reached at a Web App URL only they have.
 *
 * WHAT IS DIFFERENT ABOUT THIS ONE. Every other keyed provider here sends a
 * credential to a third party's endpoint. This one sends the message text to an
 * endpoint the user created, running code the user pasted, under a Google account
 * that is theirs — and Apps Script has NO BILLING AT ALL, so the failure mode at
 * the ceiling is refusal rather than a bill. The ceiling on a consumer account is
 * 5,000 translate calls per day and it resets daily.
 *
 * THE "KEY" IS A URL. needsKey is true and ProviderConfig.apiKey carries the
 * deployment URL, because that URL *is* the credential: anyone holding it can
 * spend the deployment's daily quota. It is therefore validated here rather than
 * forwarded, and validated hard — see checkDeploymentUrl(). A user-supplied
 * string that becomes a request URL is the one input on this provider that the
 * transports cannot re-derive for themselves.
 *
 * The transport still has the final word: script.google.com must be in the
 * ALLOWED_HOSTS set of all three transports or nothing here can reach it. This
 * file deliberately does not assume that has happened — see the status-0 branch
 * in classifyBlocked(), which tells the user what they are looking at rather than
 * showing them an empty failure.
 */
export const APPS_SCRIPT_HOST = "script.google.com";

/**
 * The two shapes a deployed Web App URL actually takes.
 *
 *   consumer  https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
 *   Workspace https://script.google.com/a/macros/<domain>/s/<DEPLOYMENT_ID>/exec
 *
 * The consumer form is the one verified against a live deployment. The Workspace
 * form is accepted too because a Workspace account is handed that URL by Google's
 * own dialog and has no way to produce the other one; rejecting it would read as
 * "your correctly-copied URL is wrong". Both are on the same host, both end in
 * /exec, and the host — not the path — is what the transports enforce.
 */
const DEPLOYMENT_PATHS = [
    /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/,
    /^\/a\/macros\/[A-Za-z0-9.-]+\/s\/[A-Za-z0-9_-]+\/exec$/
];

/** The /dev twin of a deployment URL: same shape, and it does not work for anyone but the owner. */
const DEV_PATHS = [
    /^\/macros\/s\/[A-Za-z0-9_-]+\/dev$/,
    /^\/a\/macros\/[A-Za-z0-9.-]+\/s\/[A-Za-z0-9_-]+\/dev$/
];

/**
 * The editor URL, which is what a user copies out of the browser address bar
 * while they are looking at their script. It is the single likeliest wrong paste,
 * because at the moment of copying it is the URL on screen.
 *
 *   https://script.google.com/home/projects/<id>/edit
 *   https://script.google.com/u/0/home/projects/<id>
 *   https://script.google.com/d/<id>/edit
 */
const PROJECT_PATHS = [
    /^(?:\/u\/\d+)?\/home\/projects\//,
    /^(?:\/u\/\d+)?\/d\//,
    /^(?:\/u\/\d+)?\/home\/?$/
];

export type DeploymentUrlCheck =
    | { ok: true; url: string; }
    | { ok: false; reason: string; };

/**
 * Is this a Web App deployment URL, and if not, what did the user paste instead?
 *
 * Every refusal names what was expected, because "invalid URL" sends a
 * non-technical user back to a settings field with nothing to change. The
 * project-URL case gets its own wording: it is not a typo, it is a different page
 * of the same product, and the user will re-paste the identical string unless
 * they are told which URL to go and fetch.
 *
 * On success the URL is REBUILT from the parsed host and path rather than passed
 * through. That drops any query string, fragment or embedded credentials the
 * paste carried, so what the transport receives is exactly the shape that was
 * checked — the same validate-one-thing-send-another gap checkUrl() closes in
 * native.ts, closed here for the same reason.
 */
export function checkDeploymentUrl(raw: string): DeploymentUrlCheck {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
        return {
            ok: false,
            reason:
                "no Web App URL configured — paste your Apps Script deployment URL into the " +
                "plugin settings. It looks like https://script.google.com/macros/s/…/exec"
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return {
            ok: false,
            reason:
                "that is not a web address. The Apps Script Web App URL starts with " +
                `https://${APPS_SCRIPT_HOST}/macros/s/ and ends with /exec — copy it from ` +
                "Deploy → Manage deployments → the copy button under Web app."
        };
    }

    if (parsed.protocol !== "https:") {
        return {
            ok: false,
            reason:
                `the Web App URL must start with https:// (this one starts with ${parsed.protocol}//). ` +
                "Google only serves Apps Script deployments over https."
        };
    }

    // Refused rather than silently dropped by the rebuild below, so a paste that
    // carried credentials is reported instead of quietly changing meaning.
    if (parsed.username !== "" || parsed.password !== "") {
        return { ok: false, reason: "the Web App URL must not carry a username or password before the host." };
    }

    if (parsed.hostname !== APPS_SCRIPT_HOST) {
        return {
            ok: false,
            reason:
                `the Web App URL must be on ${APPS_SCRIPT_HOST}, and this one is on ` +
                `${parsed.hostname}. Nothing else is contacted for this provider.`
        };
    }

    const path = parsed.pathname;

    if (PROJECT_PATHS.some(p => p.test(path))) {
        return {
            ok: false,
            reason:
                "that is the URL of the Apps Script EDITOR, not of the deployment. It is the " +
                "address bar of the page where you write the script, and it cannot translate " +
                "anything. Open Deploy → Manage deployments, and copy the Web app URL shown " +
                "there — it ends with /exec."
        };
    }

    if (DEV_PATHS.some(p => p.test(path))) {
        return {
            ok: false,
            reason:
                "that URL ends with /dev, which is the test version — it only ever answers the " +
                "Google account that owns the script, so it will not work here. Use the /exec " +
                "URL from Deploy → Manage deployments instead."
        };
    }

    if (!DEPLOYMENT_PATHS.some(p => p.test(path))) {
        return {
            ok: false,
            reason:
                "that is not a Web App deployment URL. The one to paste looks like " +
                `https://${APPS_SCRIPT_HOST}/macros/s/<a long id>/exec — it must end with /exec. ` +
                "Copy it from Deploy → Manage deployments."
        };
    }

    return { ok: true, url: `https://${APPS_SCRIPT_HOST}${path}` };
}

/**
 * The one cause behind most first-run failures, worded once and reused.
 *
 * A deployment left at "Who has access: Only myself" does not answer with an
 * error. It answers with Google's sign-in page — as a redirect to
 * accounts.google.com, or as a page of HTML with HTTP 200 — because from
 * Google's side this is an anonymous visitor being asked to log in. Neither of
 * those looks like a permissions problem unless somebody says so.
 */
const ACCESS_HINT =
    "Google answered with a sign-in page instead of a translation, which almost always means " +
    "the deployment is not public. Open your script → Deploy → Manage deployments → the pencil " +
    "icon, set \"Who has access\" to \"Anyone\", and deploy again. (\"Execute as\" should stay " +
    "\"Me\".) Note that editing a deployment gives you a NEW URL to paste back into the settings.";

/** What the quota ceiling is, and what it is not — in particular, it is not a bill. */
const QUOTA_HINT =
    "your Apps Script daily quota is used up. A consumer Google account gets 5,000 translate " +
    "calls per day and this one has spent them. It costs nothing and it is not a bill — Apps " +
    "Script has no billing at all — and the allowance resets on Google's next daily rollover. " +
    "Until then, switch Provider back to Google (free) if you need translation today.";

/** Statuses worth explaining rather than showing as a bare number. */
const STATUS_HINT: Readonly<Record<number, string>> = {
    401: ACCESS_HINT,
    403: ACCESS_HINT,
    404: "Google could not find that deployment. The URL is well-formed but nothing is deployed " +
        "at it any more — most often because the deployment was edited or deleted, which " +
        "changes the URL. Open Deploy → Manage deployments and copy the current Web app URL.",
    429: "Google is rate-limiting the script. Unlike the daily quota this one usually clears " +
        "within a minute, and it costs nothing either way.",
    500: "the Apps Script itself threw an error. Open the script → Executions to see what it " +
        "said. This is your own code, so nothing here can fix it from the outside.",
    503: "Apps Script is temporarily unavailable. This one is usually worth waiting out."
};

/** How much of the script's own error text to quote back. Enough to be useful, not enough to be a wall. */
const MAX_QUOTED_ERROR = 200;

/**
 * The script's own error text, made safe to show.
 *
 * It is third-party text — it comes off the network, and the proxy is code the
 * user pasted rather than code this project ships — so it is stripped of control
 * characters and length-capped before it goes anywhere near the user.
 */
function quoted(message: string): string {
    const clean = message.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
    if (!clean) return "";
    return ` The script said: "${clean.slice(0, MAX_QUOTED_ERROR)}"`;
}

/**
 * The exact strings Apps Script uses when a daily allowance is spent.
 *
 * "Service invoked too many times for one day: translate." is the one a user
 * actually hits; the other two are the same event worded differently by
 * neighbouring services, kept narrow so that an unrelated error containing the
 * word "limit" is not silently reclassified as a quota problem.
 */
const QUOTA_PATTERN = /too many times|quota|daily limit/i;

export function isQuotaMessage(message: string): boolean {
    return QUOTA_PATTERN.test(message);
}

/**
 * status 0 means the request never left this machine: one of the three transports
 * refused it, or the network failed.
 *
 * The two are not the same and must not be classified the same. A refusal is
 * deterministic — the guard will refuse the identical request identically for the
 * rest of the session — so retrying it three more times buys nothing and spends
 * three breaker strikes, which then take down whichever provider the user
 * switches to next. A network failure is exactly the transient case the scheduler
 * exists for. The transports mark their own refusals with a "blocked" prefix
 * (native.ts, translationHost.js, translationBridge.ts all return
 * `blocked: <why>`), and that prefix is the only honest way to tell them apart
 * from `String(err)` of a fetch that fell over.
 */
function classifyBlocked(body: string): Error {
    if (!/^blocked/.test(body)) {
        // No prefix: a genuine network failure. Transient, and left unmarked so
        // the scheduler retries it the way it retries any other one.
        return new Error(
            "apps-script: the request to your Apps Script deployment did not complete — " +
            "this is usually a network problem and is retried automatically."
        );
    }

    if (/redirect/i.test(body)) {
        return permanentError(`apps-script: ${ACCESS_HINT}`);
    }

    if (/not an allowed translation host/i.test(body)) {
        return permanentError(
            `apps-script: this build of the plugin is not allowed to contact ${APPS_SCRIPT_HOST}, ` +
            "so the request was stopped before it was sent. That is a bug in the build rather " +
            "than anything you can fix in the settings — please report it."
        );
    }

    return permanentError(
        "apps-script: the request was refused before it was sent, because the Web App URL did " +
        "not pass the plugin's own safety check. Re-copy it from Deploy → Manage deployments."
    );
}

/** A body that is markup rather than JSON. Google's sign-in page is the one that matters. */
function looksLikeHtml(body: string): boolean {
    return /^\s*(?:<!doctype|<html|<)/i.test(body);
}

interface ProxyReply {
    translations?: unknown;
    error?: unknown;
}

/**
 * A translation proxy running on the user's OWN Google account.
 *
 * ONE REQUEST FOR ALL THE TEXTS, which was the opposite of what the since-deleted deepl.ts and
 * googleCloud.ts did, and the difference is deliberate rather than an oversight.
 * Those two were billed per CHARACTER, so batching would save the user nothing and
 * would add an index-mapping step whose failure mode is showing one message's
 * translation on another. Here the scarce resource is CALLS — 5,000 a day, a hard
 * refusal at the ceiling — so one call for five messages is five times the day's
 * usable translation. The index-mapping hazard is real and is answered directly:
 * a reply whose translations array is not exactly as long as the texts array is
 * refused outright below rather than zipped up hopefully.
 *
 * NO DETECTED SOURCE LANGUAGE. The proxy contract returns translations and
 * nothing else, so sourceLang is reported as "auto" — the same value googleCloud
 * uses when v2 sends no detection back. selection.ts's reverse-translate check
 * and the cache key both compare lowercase tags, and "auto" is what they already
 * handle.
 */
export function createAppsScriptProvider(
    http: HttpTransport,
    config: ProviderConfig = {}
): TranslationProvider {
    // The deployment URL arrives in `apiKey` because that is the field
    // ProviderConfig has and because the URL genuinely is the credential. See the
    // file header.
    const configured = (config.apiKey ?? "").trim();

    return {
        id: "apps-script",
        label: "Google Apps Script (your own free proxy)",
        needsKey: true,

        async translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> {
            // Permanent for the same reason as the since-deleted deepl.ts and googleCloud.ts: no
            // amount of retrying conjures a URL, and four attempts at a request
            // that was never sent still counted four times toward opening the
            // breaker, taking down whichever provider the user switched to next.
            //
            // A MALFORMED url is permanent for the same reason and one more: it is
            // deterministic. The string in the settings field will be exactly as
            // wrong on the fourth attempt.
            const checked = checkDeploymentUrl(configured);
            if (!checked.ok) throw permanentError(`apps-script: ${checked.reason}`);

            if (texts.length === 0) return [];

            const payload = {
                q: texts,
                target: toLanguageCode(to),
                // An empty string is how the proxy is asked to auto-detect. Sent
                // as an explicit "" rather than omitted, because that is the
                // contract the deployed script reads.
                source: from && from !== "auto" ? toLanguageCode(from) : ""
            };

            const res = await http(checked.url, { method: "POST", body: JSON.stringify(payload) });

            // Never sent: a transport refusal or a network failure. classifyBlocked
            // decides which, because only one of the two is worth retrying.
            if (res.status === 0) throw classifyBlocked(res.body ?? "");

            // A redirect this far up the stack means the transports handed the 3xx
            // back rather than refusing it, which happens when the runtime honoured
            // `redirect: "manual"` and returned the response. Either way the cause
            // is the same one: an anonymous visitor being bounced to a Google
            // sign-in page. Permanent, because the deployment's access setting will
            // not change between retries.
            if (res.status >= 300 && res.status < 400) {
                throw permanentError(`apps-script: HTTP ${res.status} — ${ACCESS_HINT}`);
            }

            if (res.status !== 200) {
                const hint = STATUS_HINT[res.status];
                throw Object.assign(
                    new Error(`apps-script: HTTP ${res.status}` + (hint ? ` — ${hint}` : "")),
                    { status: res.status, retryAfterMs: res.retryAfterMs }
                );
            }

            const body = res.body ?? "";

            // HTML at HTTP 200 is the sign-in page. It is checked BEFORE the JSON
            // parse so the user is told the cause rather than told that a body they
            // never saw would not parse.
            if (looksLikeHtml(body)) {
                throw permanentError(`apps-script: ${ACCESS_HINT}`);
            }

            // Everything below is a 200 whose body we cannot use, and every one of
            // them is marked permanent. On the billed providers that is a money
            // question; here it is a QUOTA question, and it is the same argument
            // with a different currency. The call has already been spent out of a
            // hard daily allowance of 5,000. Asking the same deterministic
            // deployment the same question three more times spends three more, gets
            // the same unusable answer, and counts four breaker strikes on the way.
            //
            // The cost of this choice, stated plainly: a genuinely transient hiccup
            // inside the user's own script is classed permanent too, and that
            // message is not retried again this session. Changing the provider or
            // the URL clears the permanent-failure registry (see state.ts), which is
            // the same action the wording below asks for anyway.
            let parsed: ProxyReply;
            try {
                parsed = JSON.parse(body);
            } catch {
                // The body is quoted nowhere: it is unparsed third-party text of
                // unknown length, and this message is shown to the user.
                throw permanentError(
                    "apps-script: your deployment answered with something that is not JSON. If " +
                    "you changed the script, check it still ends by returning " +
                    "ContentService.createTextOutput(JSON.stringify(...)) — and that it was " +
                    "re-deployed afterwards, because editing the script alone changes nothing."
                );
            }

            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw permanentError("apps-script: your deployment answered with JSON that is not a reply object.");
            }

            if (typeof parsed.error === "string" && parsed.error.trim()) {
                if (isQuotaMessage(parsed.error)) {
                    throw permanentError(`apps-script: ${QUOTA_HINT}${quoted(parsed.error)}`);
                }
                throw permanentError(
                    "apps-script: your deployment reported an error rather than a translation." +
                    quoted(parsed.error)
                );
            }

            const { translations } = parsed;
            if (!Array.isArray(translations) || translations.length === 0) {
                throw permanentError("apps-script: response had no translations array");
            }

            // The index-mapping guard the batching above earns. A short or long
            // array cannot be lined up with the messages that were sent, and
            // guessing would put one person's translation under another person's
            // message — a wrong answer that looks exactly like a right one.
            if (translations.length !== texts.length) {
                throw permanentError(
                    `apps-script: your deployment returned ${translations.length} translations for ` +
                    `${texts.length} messages, so they cannot be matched up. If you changed the ` +
                    "script, check it returns one entry per item of the q array, in the same order."
                );
            }

            return translations.map((value): TranslateResult => {
                if (typeof value !== "string") {
                    throw permanentError("apps-script: your deployment returned a translation that is not text.");
                }
                return {
                    text: value,
                    // Nothing is detected: the proxy contract carries translations
                    // only. "auto" is the same fallback the since-deleted googleCloud.ts used, and it
                    // is lowercase because the cache key and selection.ts's
                    // reverse-translate check both compare lowercase tags.
                    sourceLang: "auto",
                    // No detection, so no confidence. 0 is what the google provider
                    // reports when the field is absent; nothing gates on it.
                    confidence: 0
                };
            });
        }
    };
}
