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
 * THE "KEY" IS A URL — OR THE ID INSIDE IT. needsKey is true and
 * ProviderConfig.apiKey carries the deployment URL, because that URL *is* the
 * credential: anyone holding it can spend the deployment's daily quota. It is
 * therefore validated here rather than forwarded, and validated hard — see
 * checkDeploymentUrl(). A user-supplied string that becomes a request URL is the
 * one input on this provider that the transports cannot re-derive for themselves.
 *
 * The same field also accepts the bare DEPLOYMENT ID, which is what Google's own
 * Deploy dialog offers a dedicated copy button for. Both forms normalise to the
 * identical canonical /exec URL, so everything downstream — the three transports,
 * the settings check, the stored "last good" value — keeps seeing exactly one
 * shape. See checkDeploymentUrl(), which is the single authority on both.
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

/**
 * ── THE BARE DEPLOYMENT ID ───────────────────────────────────────────────────
 *
 * Google's Deploy dialog shows a "Deployment ID" with its own copy button, and
 * that ID is literally the <ID> segment of
 * https://script.google.com/macros/s/<ID>/exec — the reference implementation
 * this product was modelled on builds its endpoint by exactly that
 * concatenation. So a bare ID needs no derivation: it is the URL with the
 * boilerplate removed, and it is normalised back to the same canonical string.
 *
 * TELLING THE TWO FORMS APART. A URL carries a scheme, or a forward slash, or
 * both. A Deployment ID carries neither — it is a single path segment. That is
 * the whole rule, and it is applied to the TRIMMED paste, so surrounding
 * whitespace decides nothing.
 *
 *   "https://script.google.com/macros/s/<ID>/exec"  → slash + scheme → URL branch
 *   "script.google.com/macros/s/<ID>/exec"          → slash          → URL branch
 *   "macros/s/<ID>/exec"                            → slash          → URL branch
 *   "<ID>"                                          → neither        → ID branch
 *   "my apps script"                                → neither        → ID branch
 *
 * The two middle cases are REFUSED, each with its own wording (see the catch
 * block in checkDeploymentUrl). They are not accepted, because the operator's
 * ruling was that the box take two forms and these are a third and a fourth;
 * accepting them later would be strictly additive and would break nothing here.
 */

/**
 * What a Deployment ID may be made of.
 *
 * NOT INVENTED. It is the same character class DEPLOYMENT_PATHS above already
 * accepts for the <ID> segment of a full URL. Reusing it is what guarantees that
 * a bare ID accepted here builds a URL this very function would also accept — a
 * wider class would let checkDeploymentUrl() return a URL it refuses.
 */
const DEPLOYMENT_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The length floor under which a paste is called truncated rather than tried.
 *
 * [A] ASSUMED, NOT MEASURED. There is no published specification for the format
 * of an Apps Script deployment id, and none is invented here. The only claim
 * behind this number is a weak one that does not need a spec: the ids Google
 * shows are long, and nothing shorter than twenty characters is a plausible
 * complete one — a clipboard that stopped early, or half a value selected by
 * hand, is.
 *
 * IT IS DELIBERATELY LOW. A false rejection tells a user that their correct
 * credential is wrong and leaves them nothing to do about it; a doubtful value
 * let through costs one request and comes back as a specific, honest 404 whose
 * hint already says "nothing is deployed at it any more … copy the current Web
 * app URL". Given that asymmetry the floor is set to catch only the obviously
 * incomplete, and everything above it is the network's question to answer.
 *
 * NO UPPER BOUND, on purpose. The full-URL branch has never bounded the length
 * of the <ID> segment either, so bounding it only for the bare form would refuse
 * a string this function accepts when it is wrapped in a URL — the same value
 * judged two ways by one authority.
 */
const MIN_DEPLOYMENT_ID_LENGTH = 20;

/** RFC 3986's scheme production, anchored: matches "https:", "mailto:", "AKfycb:". */
const HAS_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A Web App URL with the https:// missing off the front — with or without the "//". */
const SCHEMELESS_HOST = new RegExp(`^(?://)?${APPS_SCRIPT_HOST.replace(/\./g, "\\.")}/`, "i");

/** Only the tail of a Web App URL: the path, pasted without the host. */
const PATH_ONLY = /^\/?(?:macros\/s\/|a\/macros\/)/i;

export type DeploymentUrlCheck =
    | { ok: true; url: string; }
    | { ok: false; reason: string; };

/**
 * A paste with no scheme and no slash in it: judged as a bare Deployment ID.
 *
 * Private, and called from exactly one place, because checkDeploymentUrl() must
 * stay the single authority on what a valid endpoint is — three transports, the
 * settings check and state.ts's validate button all resolve their answer through
 * it, and a second entry point is how two of them start disagreeing.
 *
 * WHAT IS NOT CHECKED, and why. Nothing here distinguishes a deployment id from
 * a PROJECT id copied out of the editor URL: both are long strings of the same
 * characters, and no local rule can separate them. A project id therefore passes
 * and is answered by Google with a 404, whose STATUS_HINT already names the fix.
 * That is the intended trade — the alternative is a guess that refuses real
 * credentials.
 *
 * A WORKSPACE ACCOUNT CANNOT USE THIS FORM. Its URL is
 * /a/macros/<domain>/s/<ID>/exec and the <domain> is not recoverable from the id
 * alone, so a Workspace user pasting a bare id gets the consumer URL and a
 * failure from Google. They must paste the whole URL, which is the form their
 * dialog hands them anyway.
 */
function checkDeploymentId(candidate: string): DeploymentUrlCheck {
    // Checked before the character class so the commonest wrong paste — a phrase,
    // or two things pasted with a space between them — is named for what it is
    // rather than reported as a stray character.
    if (/\s/.test(candidate)) {
        return {
            ok: false,
            reason:
                "that is not a web address, and it is not a Deployment ID either — it has spaces " +
                "in it. Paste either the whole Web App URL, which looks like " +
                `https://${APPS_SCRIPT_HOST}/macros/s/<a long id>/exec, or just the Deployment ID ` +
                "on its own — Deploy → Manage deployments shows both, each with its own copy button."
        };
    }

    if (!DEPLOYMENT_ID.test(candidate)) {
        return {
            ok: false,
            reason:
                "a Deployment ID is made only of letters, digits, hyphens and underscores, and " +
                "this one contains something else. If you meant to paste the whole Web App URL it " +
                `starts with https://${APPS_SCRIPT_HOST}/macros/s/ and ends with /exec; if you ` +
                "meant the ID on its own, use the copy button beside Deployment ID in " +
                "Deploy → Manage deployments."
        };
    }

    if (candidate.length < MIN_DEPLOYMENT_ID_LENGTH) {
        return {
            ok: false,
            reason:
                "that is far too short to be a Deployment ID — it looks like only part of one was " +
                "copied. The ID Google shows is a long string; use the copy button beside it in " +
                "Deploy → Manage deployments rather than selecting the text by hand, or paste the " +
                "whole Web App URL ending in /exec instead."
        };
    }

    // The same canonical string the URL branch returns for the same deployment.
    return { ok: true, url: `https://${APPS_SCRIPT_HOST}/macros/s/${candidate}/exec` };
}

/**
 * Is this a usable Apps Script endpoint, and if not, what did the user paste
 * instead?
 *
 * TWO ACCEPTED FORMS, ONE CANONICAL ANSWER. A full Web App URL, or the bare
 * Deployment ID from Google's Deploy dialog. Both return
 * `https://script.google.com/macros/s/<ID>/exec` — the identical string for the
 * identical deployment — so nothing downstream has to know which was typed.
 * Which branch a paste takes is decided by scheme-or-slash; see the block above
 * DEPLOYMENT_ID for the rule and the four worked cases.
 *
 * Every refusal names what was expected, because "invalid URL" sends a
 * non-technical user back to a settings field with nothing to change. The
 * project-URL case gets its own wording: it is not a typo, it is a different page
 * of the same product, and the user will re-paste the identical string unless
 * they are told which URL to go and fetch. The bare-ID refusals are worded the
 * same way, and for the same reason.
 *
 * NO REFUSAL EVER QUOTES THE PASTE BACK. The value is the credential, and
 * test/appsScriptEndpointValidation.test.ts pins that: a reason that echoed the
 * string would put it into a settings notice and, from there, into a screenshot.
 *
 * On success the URL is REBUILT from the parsed host and path rather than passed
 * through. That drops any query string, fragment or embedded credentials the
 * paste carried, so what the transport receives is exactly the shape that was
 * checked — the same validate-one-thing-send-another gap checkUrl() closes in
 * native.ts, closed here for the same reason. The bare-ID branch is the same
 * guarantee reached from the other side: it BUILDS the URL, so there is nothing
 * left over to drop.
 */
export function checkDeploymentUrl(raw: string): DeploymentUrlCheck {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) {
        return {
            ok: false,
            reason:
                "no Web App URL configured — paste your Apps Script deployment URL, or just its " +
                "Deployment ID, into the plugin settings. The URL looks like " +
                "https://script.google.com/macros/s/…/exec"
        };
    }

    // Neither a scheme nor a slash: this is not a URL and must not be reported as
    // a broken one. Judged as a Deployment ID instead, which is the form Google's
    // Deploy dialog gives its own copy button.
    if (!trimmed.includes("/") && !HAS_SCHEME.test(trimmed)) {
        return checkDeploymentId(trimmed);
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        // Two near-misses that ARE web addresses and would read as an insult if
        // told they are not one. Neither is accepted — the ruling was that the box
        // take a full URL or a bare ID, and these are neither — but each is told
        // exactly what is missing.
        if (SCHEMELESS_HOST.test(trimmed)) {
            return {
                ok: false,
                reason:
                    "that is the Web App URL with the https:// missing from the front. Paste the " +
                    "whole thing, https:// included — the copy button in Deploy → Manage " +
                    "deployments gives you the complete URL."
            };
        }

        if (PATH_ONLY.test(trimmed)) {
            return {
                ok: false,
                reason:
                    "that is only the tail of a Web App URL — the part after the host is there, " +
                    `but https://${APPS_SCRIPT_HOST} is missing from the front. Paste the whole ` +
                    "URL, or paste just the Deployment ID on its own, with no slashes in it."
            };
        }

        return {
            ok: false,
            reason:
                "that is not a web address. The Apps Script Web App URL starts with " +
                `https://${APPS_SCRIPT_HOST}/macros/s/ and ends with /exec — copy it from ` +
                "Deploy → Manage deployments → the copy button under Web app. The Deployment ID " +
                "from that same dialog, pasted on its own, works too."
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
