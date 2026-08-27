/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Browser replacement for the plugin's Electron native transport.
 *
 * On the desktop, src/plugins/channelTranslator/native.ts runs in the main process
 * and the renderer reaches it over IPC as VencordNative.pluginHelpers.ChannelTranslator.
 * There is no main process here, so this module provides the same object with the
 * same shape, and the plugin never learns the difference.
 *
 * Two transports, chosen at build time:
 *
 *   extension  the request is relayed to the background context (translationHost.js),
 *              which is the only part of the extension that may fetch cross-origin.
 *   otherwise  a direct fetch. In the userscript bundle this is GMPolyfill's GM_fetch,
 *              injected by scripts/build/buildWeb.mjs, which also escapes CORS. In the
 *              plain web bundle it is the page's own fetch and is subject to Discord's
 *              CSP — that build has no privileged context to borrow, and this is the
 *              honest best it can do.
 */

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * Kept structurally identical to HttpRequestInit in
 * src/plugins/channelTranslator/core/providers/types.ts. No headers field, on
 * purpose: this module is compiled into the page bundle, so "a caller" here
 * means any script running on the Discord page.
 */
export interface HttpRequestInit {
    method?: "GET" | "POST";
    body?: string;
}

/**
 * Kept deliberately identical to ALLOWED_HOSTS in native.ts and in
 * browser/translationHost.js. Three copies is not an accident: each one guards a
 * different transport, and the direct path below has no privileged process to
 * check it on the way out. scripts/checkHosts.mjs fails CI if any of them reaches
 * a host that is not declared in scripts/allowed-hosts.txt.
 *
 * Exact hostnames, matched with Set.has(). Never relax this to endsWith or a
 * wildcard: endsWith("googleapis.com") also admits evil-googleapis.com.
 *
 * Both surviving providers are free and keyless-or-self-hosted. Nothing here can
 * bill the user, and there is deliberately no entry that requires a paid account.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
    // The default, keyless gtx endpoint — see core/providers/google.ts.
    "translate.googleapis.com",
    // A Web App the USER deployed on their OWN Google account, contacted only if
    // they paste its deployment URL — see core/providers/appsScript.ts. The path
    // names one deployment and this guard checks only the host; the path is
    // enforced by checkDeploymentUrl(), which rebuilds the URL from what it
    // parsed, so what reaches this transport is the shape that was validated.
    "script.google.com",
    // Where Apps Script actually SERVES the result of a Web App call. A POST to
    // /exec on script.google.com answers 302 to this host every single time —
    // measured against a live deployment — and the JSON is served from here, so
    // without this entry the Apps Script provider cannot complete a single
    // request.
    //
    // ⚠ NEITHER BUILD THIS FILE SERVES CAN INSPECT THAT 302, so in this transport
    // the entry is not the checked target of an inspected redirect — it is the
    // host the response is required to have LANDED on after the runtime followed
    // the hop itself. Plain web asks for "follow" deliberately; the userscript
    // manager followed regardless of what was asked. Either way the landing is now
    // checked against FOLLOW_LANDING_HOSTS, a NARROWER set than this one, which is
    // what keeps the exception from inheriting the reach of the allow-list. See
    // the block above FOLLOW_MODE_HOSTS for the measurement and the residual risk.
    "script.googleusercontent.com"
]);

/**
 * Longest request body this transport will send, matching the response cap in
 * browser/translationHost.js.
 */
const MAX_BODY_CHARS = 1024 * 1024;

/** Fixed, never caller-supplied — see HttpRequestInit above. */
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** The complete set of keys a request init may carry. Anything else is refused, not ignored. */
const INIT_KEYS = ["method", "body"];

/**
 * Why a redirect was refused. Four reasons, not one, because 3xx is not one
 * thing on the wire. All four are hand-copied into the three transports and
 * pinned across them by test/transportGuards.test.ts.
 *
 * The wording of this first one is deliberate. An earlier version of this guard
 * followed the redirect and then inspected where the response had come from,
 * reporting "blocked after redirect" — which was FALSE about the thing that
 * matters. By the time a followed redirect can be inspected the request has
 * ALREADY been delivered to the new origin. The post-hoc check stopped the
 * RESPONSE reaching the plugin; it never stopped the exfiltration, which had
 * already happened. Every fetch below therefore asks for `redirect: "manual"`,
 * and this string names the case that survives it: a 3xx we are permitted to
 * follow, pointing somewhere we are not permitted to go.
 *
 * It is used for the GET-reissuing statuses whose Location fails the same
 * checkUrl() the original URL went through, or which name no usable Location at
 * all. The free gtx provider is why that check matters: it puts the message text
 * in the QUERY STRING (see urlFor() in core/providers/google.ts), and a
 * redirecting host, which already received that query, is free to name it in the
 * Location it sends us to. HTTP does not append the original query itself; the
 * host does. checkUrl() on the Location is what stops that landing at an origin
 * the allow-list exists to forbid.
 */
const REDIRECT_REFUSAL = "refused to follow a redirect away from the translation host";

/**
 * 307 and 308 REPLAY the method and the body at the new origin — the POST body,
 * which is the user's message text, is delivered verbatim before any code here
 * runs. No check can happen after that, so these are refused always, whatever
 * the Location says. This is the exfiltration reproduced over real sockets at
 * the bottom of test/transportGuards.test.ts.
 */
const REDIRECT_REPLAY_REFUSAL = "refused a 307 or 308 redirect, which would replay the request body";

/**
 * A redirect the runtime will not describe.
 *
 * The Fetch standard answers `redirect: "manual"` with an OPAQUE-REDIRECT
 * filtered response: status 0, url "", and NO readable headers — so there is no
 * status to branch on and no Location to validate. Refusing is the only
 * fail-closed option, because a redirect that cannot be classified cannot be
 * shown to be one of the safe ones. Any 3xx outside 301/302/303/307/308 (300,
 * 304-306, 309+) lands here too: unknown semantics are refused, not guessed at.
 *
 * ⚠ WHAT THAT MEANS FOR THE TWO BUILDS THIS FILE SERVES, AND THEY DIFFER:
 *
 *   plain web   the page's own fetch is the Fetch standard, so EVERY 3xx arrives
 *               opaque and is refused here — for every host except the one
 *               FOLLOW_MODE_HOSTS names, which is asked to follow instead.
 *   userscript  GM_fetch does not implement `redirect` at all under Violentmonkey
 *               or Greasemonkey — the redirect is followed by the manager and a
 *               200 arrives with finalUrl already at the new origin, so this
 *               branch is never taken. That path is NOT protected by this refusal;
 *               see manualFetch() below, which still says so.
 *
 * ⚠ THIS COMMENT USED TO SAY THE APPS SCRIPT PROVIDER "CANNOT WORK" IN THE PLAIN
 * WEB BUILD. THAT WAS WRONG. The opaque response is a consequence of asking for
 * "manual", not a limit on what a browser can do: the same page fetch asked to
 * FOLLOW that 302 follows it, lands on script.googleusercontent.com and returns
 * the JSON — measured in real headless Chromium, and jimakuChan does exactly this
 * from an ordinary web page. What a browser will not do is let us look at the hop,
 * which is a different and much smaller claim. See the block above
 * FOLLOW_MODE_HOSTS for the measurement, the scope, and what is given up.
 */
const REDIRECT_OPAQUE_REFUSAL = "refused a redirect this runtime will not describe";

/**
 * One hop, and one only. A redirect FROM a redirect target is refused: chasing a
 * chain means each Location is trusted to be caught by the check after it, and
 * each extra hop is one more origin that learns the request happened. Nothing
 * legitimate needs two — an Apps Script Web App answers /exec with exactly one.
 */
const REDIRECT_HOP_REFUSAL = "refused a second redirect from a redirect target";

/**
 * The two halves of 3xx, split by what the client does with the ORIGINAL
 * request. This is the whole distinction the redirect handling rests on.
 *
 *   307 / 308        REPLAY the method and the body at the new origin.
 *   301 / 302 / 303  reissue as a GET WITHOUT the body — 303 by specification,
 *                    301 and 302 by universal practice. A POST body therefore
 *                    does NOT reach the new origin.
 *
 * The difference is not academic. A Google Apps Script Web App ALWAYS answers
 * /exec with a 302 to script.googleusercontent.com, which is where the result is
 * actually served — measured against a live deployment. Refusing every 3xx made
 * core/providers/appsScript.ts a provider that could not succeed once.
 */
const BODY_REPLAYING_REDIRECTS = [307, 308];
const GET_REISSUING_REDIRECTS = [301, 302, 303];
/**
 * ── THE ONE EXCEPTION TO redirect: "manual", AND ITS EXACT SCOPE ────────────
 *
 * Everything above refuses a redirect this transport cannot inspect, and that
 * stays the DEFAULT for every host. What follows is the single narrow exception,
 * written down here rather than spread across the three transports as inline
 * string compares, so that the exact reach of it is readable in ONE place.
 *
 * WHY IT EXISTS. The guard above, on a runtime that answers `redirect: "manual"`
 * with an opaque-redirect response, made core/providers/appsScript.ts impossible
 * in the browser builds: an Apps Script Web App answers /exec with a 302 every
 * single time, and an opaque redirect cannot be classified, so it was refused.
 * An earlier round concluded from that that a browser "cannot" reach an Apps
 * Script deployment. THAT CONCLUSION WAS WRONG, and it was measured wrong — in
 * real headless Chromium, against a local 302:
 *
 *   fetch(u, { method: "POST", body: SECRET, redirect: "manual" })
 *       -> status 0, type "opaqueredirect", location null, 0 readable headers
 *   fetch(u, { method: "POST", body: SECRET })        // i.e. redirect: "follow"
 *       -> status 200, landed on the redirect target
 *       -> AND THE TARGET SERVER RECORDED  { "method": "GET", "body": "" }
 *
 * The browser follows the hop perfectly well. It simply does it ITSELF instead of
 * letting us look at it, so the restriction was self-imposed by asking for
 * "manual" — not a platform limit. jimakuChan does exactly this from an ordinary
 * web page.
 *
 * The second line is the security fact the whole exception rests on, and it is
 * MEASURED rather than assumed: ON A 302 THE CLIENT REISSUES AS GET AND DROPS THE
 * BODY, so the user's message text is not delivered to the redirect target. It is
 * reproduced over real sockets — two local servers, one 302 to the other — at the
 * bottom of test/transportGuards.test.ts, not cited from prose. The attack the
 * earlier round demonstrated used a 307, which DOES replay the body, and 307/308
 * are refused everywhere, including here.
 *
 * WHICH TRANSPORT TAKES WHICH BRANCH, AND WHY:
 *
 *   native.ts             RUNTIME_DESCRIBES_REDIRECTS = true. The Electron main
 *                         process runs on Node/undici, which hands back the real
 *                         302 WITH a readable Location, so the inspect-then-follow
 *                         path above is available — and it is PREFERRED, because
 *                         it refuses a 307 BEFORE the body flies, which follow
 *                         mode cannot. That transport therefore never takes the
 *                         follow branch; the branch is compiled into it anyway,
 *                         and is dead code there on purpose, because the three
 *                         transports are pinned identical to each other and one
 *                         boolean is easier to audit than three divergent files.
 *   translationHost.js    false. The extension background gets the Fetch
 *                         standard's opaque-redirect response for EVERY 3xx:
 *                         status 0, no headers, no Location. There is nothing to
 *                         inspect, so follow mode is the only way this build ever
 *                         reaches an Apps Script result.
 *   translationBridge.ts  false. Plain web is the page's own fetch, which is the
 *                         same Fetch standard and the same opaque redirect. The
 *                         userscript build is GMPolyfill's GM_fetch, whose manager
 *                         follows redirects on its own regardless of what is asked
 *                         for — so on that path this changes nothing that was not
 *                         already happening, except that it is now deliberate and
 *                         the landing is checked against a narrower set.
 *
 * WHY THE MODE IS CHOSEN BEFORE THE REQUEST rather than after seeing an opaque
 * response: retrying in follow mode after an opaque refusal would mean the POST
 * had already been delivered and the user's Apps Script had ALREADY RUN, so every
 * translation would burn two executions of a quota that is capped per day. The
 * host is known before the fetch; the runtime's answer is not.
 *
 * ⚠ THE RESIDUAL RISK, STATED PLAINLY AND NOT OVERSTATED.
 *
 * In follow mode WE CANNOT SEE THE HOP. If script.google.com answered 307 rather
 * than 302, the runtime would REPLAY THE POST BODY — the user's message text — at
 * whatever the Location names, and this code would learn of it only from where the
 * response says it landed, which is after the fact. The landing check below then
 * refuses the RESPONSE; it cannot un-send the request. That is exactly what the
 * 307/308 refusal above exists to prevent, and follow mode gives it up for this
 * one host.
 *
 * What bounds that, and what does NOT:
 *
 *   - script.google.com is ALREADY the intended recipient of that body. The user
 *     pasted their own deployment URL; the message is being sent there on purpose.
 *     A hostile script.google.com loses us nothing it had not already been given.
 *     This does NOT bound where that host could send the body ONWARD, and that
 *     part is genuinely given up.
 *   - In the EXTENSION build Chrome additionally refuses a redirect to an origin
 *     outside host_permissions, which are the same hosts ALLOWED_HOSTS names. That
 *     is a real second control, but it is CHROME'S, nothing in this repo enforces
 *     it, and it does not apply to the plain-web or userscript builds.
 *   - Nothing here bounds a 307 aimed at script.googleusercontent.com, which is
 *     inside both the landing scope and host_permissions.
 *
 * The exposure is therefore: one host, which already holds the plaintext, able to
 * bounce it onward. It is not "the browser is safe"; it is a bounded trade made so
 * that a provider the user chose can work at all.
 */

/**
 * The ONLY host for which this transport may ask the runtime to follow a redirect
 * instead of describing it. One entry, matched with === like every other host set
 * in this file, and named here so the exception cannot widen by accident: a reader
 * checking "what may follow redirects?" reads this line, not three call sites.
 */
const FOLLOW_MODE_HOSTS: ReadonlySet<string> = new Set(["script.google.com"]);

/**
 * Where a follow-mode response is permitted to have LANDED.
 *
 * Deliberately NARROWER than ALLOWED_HOSTS. A follow-mode request that ended up at
 * translate.googleapis.com is refused even though that is a perfectly good
 * translation host, because nothing in the Apps Script flow can legitimately end
 * there — and the whole point of a scoped exception is that it does not quietly
 * inherit the reach of the general allow-list.
 *
 * script.google.com is in the set as well as the result host, because a deployment
 * that answers directly, without redirecting, is a normal Apps Script response and
 * must not be refused for staying put.
 */
const FOLLOW_LANDING_HOSTS: ReadonlySet<string> = new Set([
    "script.google.com",
    "script.googleusercontent.com"
]);

/**
 * Whether THIS transport's runtime hands back a 3xx that can be read.
 *
 * FALSE here and TRUE in native.ts — the one line that differs between the three
 * copies, and the reason is in the block above. It is a constant
 * rather than a feature test because the mode has to be chosen before the request
 * is issued, and because a feature test would be a second request.
 */
const RUNTIME_DESCRIBES_REDIRECTS = false;

/**
 * Why a follow-mode response was refused.
 *
 * The wording says "landed", not "blocked the request": in follow mode the request
 * has already been made and this refusal withholds the RESPONSE. It must not be
 * read as a promise that nothing left the machine — that is the mistake the old
 * post-hoc redirect guard made, and it is not being repeated in the naming.
 *
 * Like the four redirect refusals above it is hand-copied into the three
 * transports and pinned across them by test/transportGuards.test.ts.
 */
const FOLLOW_LANDING_REFUSAL = "refused a followed redirect that landed off the Apps Script hosts";

/**
 * Does this URL get the follow-mode exception?
 *
 * The named predicate, and the only place the exception's scope is decided. Two
 * gates, both of which must pass: the runtime must be one that cannot describe a
 * redirect, and the host must be exactly the one in FOLLOW_MODE_HOSTS. Anything
 * else — every other allow-listed host, and every host on the desktop — takes the
 * `redirect: "manual"` branch and the inspect-then-follow path with it.
 *
 * Takes the already-checked href, so `new URL` cannot fail in practice; it is
 * still wrapped, and a URL that will not parse answers false, which is the
 * fail-closed direction (manual mode, not follow mode).
 */
function usesFollowMode(href: string): boolean {
    if (RUNTIME_DESCRIBES_REDIRECTS) return false;

    let target: URL;
    try {
        target = new URL(href);
    } catch {
        return false;
    }

    return FOLLOW_MODE_HOSTS.has(target.hostname);
}

/**
 * Did a follow-mode response end up somewhere this transport accepts?
 *
 * checkUrl() first, so the landing gets every rule the outbound URL got — https,
 * the default port, no embedded credentials, the allow-list — and only then the
 * narrower FOLLOW_LANDING_HOSTS test. A response that will not say where it came
 * from fails checkUrl() as a malformed URL and is refused, which is the
 * fail-closed direction and the case this exists for.
 */
function landedWithinFollowScope(url: unknown): boolean {
    const checked = checkUrl(url);
    if (!checked.ok) return false;
    return FOLLOW_LANDING_HOSTS.has(new URL(checked.href).hostname);
}


type ShapedRequest =
    | { ok: true; method: "GET" | "POST"; body?: string; }
    | { ok: false; why: string; };

/**
 * Normalise and validate the request options, identically to native.ts and
 * browser/translationHost.js. Refuses rather than coerces; unknown keys are
 * rejected so an attempt to smuggle `headers` fails loudly rather than being
 * silently dropped.
 */
function shapeRequest(init: unknown): ShapedRequest {
    if (init === undefined || init === null) return { ok: true, method: "GET" };
    if (typeof init !== "object" || Array.isArray(init)) {
        return { ok: false, why: "malformed request options" };
    }

    const raw = init as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
        // The key itself is deliberately not echoed: it is attacker-supplied text
        // and this string is returned to the caller.
        if (!INIT_KEYS.includes(key)) return { ok: false, why: "unexpected request option" };
    }

    const method = raw.method === undefined ? "GET" : raw.method;
    if (method !== "GET" && method !== "POST") {
        return { ok: false, why: "only GET and POST requests are allowed" };
    }

    const { body } = raw;
    if (body === undefined) {
        if (method === "POST") return { ok: false, why: "a POST must carry a body" };
        return { ok: true, method };
    }

    if (typeof body !== "string") return { ok: false, why: "request body must be a string" };
    if (method !== "POST") return { ok: false, why: "only a POST may carry a body" };
    if (body.length > MAX_BODY_CHARS) return { ok: false, why: "request body is too large" };

    return { ok: true, method, body };
}

const REQUEST = "discordTranslator:fetch";
const RESPONSE = "discordTranslator:fetch:result";

/**
 * A request the background never answers must fail rather than hang: the plugin's
 * scheduler holds a slot open per in-flight translation, so a permanently pending
 * promise would stall the queue instead of erroring it.
 */
const TIMEOUT_MS = 20_000;

type UrlCheck =
    | { ok: true; href: string; }
    | { ok: false; why: string; };

/**
 * Decide whether this transport may reach the URL, and hand back the NORMALISED
 * form so that what was checked is what is sent.
 *
 * Returning the href rather than letting the caller re-use its own string closes
 * a validate-one-thing-send-another gap: `new URL()` is the parser the whole
 * check rests on, so the request has to be made against that parser's output
 * rather than against the raw text it was handed.
 *
 * Takes `unknown` because it is applied twice — once to the URL the plugin asked
 * for, and once to the URL that actually answered, which comes off a response
 * object and is not guaranteed to be a string.
 */
function checkUrl(url: unknown): UrlCheck {
    if (typeof url !== "string") return { ok: false, why: "malformed URL" };

    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return { ok: false, why: "malformed URL" };
    }

    // Exact hostname match only: endsWith would let evilgoogleapis.com through, and
    // a subdomain wildcard would trust anything Google's DNS ever delegates.
    //
    // The PORT is constrained as well, and only the empty string is accepted.
    // That is not a shortcut for "any port": a URL naming no port, or naming 443
    // explicitly, both parse with target.port === "" because the parser strips a
    // scheme's own default, so "" is exactly "the https port and nothing else".
    // Deliberate — every provider is reached on 443, and in the userscript build
    // this fetch escapes CORS, so an allowed hostname with a free choice of port
    // would be a POST primitive against any TCP port that name resolves to.
    if (target.protocol !== "https:" || target.port !== "" || !ALLOWED_HOSTS.has(target.hostname)) {
        // target.host, not target.hostname: it carries the port, which is the
        // whole point of the refusal when the port is what was wrong.
        return { ok: false, why: `${target.protocol}//${target.host} is not an allowed translation host` };
    }

    // USERINFO is refused as well, and checked after the host so that a refused
    // host is still reported as a host problem.
    //
    // The parser reads https://user:pass@translate.googleapis.com/x with
    // hostname === "translate.googleapis.com" and port === "", so every test
    // above accepts it — and target.href KEEPS the credentials, so normalising the
    // URL does not strip them either. What stops the request on the page's own
    // fetch today is fetch() itself, which refuses "a URL that includes
    // credentials". That is the RUNTIME closing the hole rather than this guard,
    // and nothing pinned it — which matters most HERE, because the userscript
    // build does not use the page's fetch at all: it uses GMPolyfill's GM_fetch
    // over GM_xmlhttpRequest, a different implementation with its own opinion
    // about credentials in a URL.
    //
    // Both halves are tested because they are set independently: "https://user@h/"
    // leaves password empty, "https://:pass@h/" leaves username empty. An empty
    // userinfo ("https://@h/") is NOT credentials — the parser drops it and href
    // comes back clean — so that one stays allowed.
    //
    // The values are deliberately not echoed: they are attacker-supplied, and this
    // string is both returned to the caller and written to the console.
    if (target.username !== "" || target.password !== "") {
        return { ok: false, why: "a translation URL must not carry embedded credentials" };
    }

    return { ok: true, href: target.href };
}

/**
 * Where the response actually came from, across the two fetches this module runs
 * on.
 *
 * The page's own fetch names it `url`. GMPolyfill's GM_fetch resolves the raw
 * GM_xmlhttpRequest response instead, which names it `finalUrl` (Tampermonkey,
 * Violentmonkey and Greasemonkey all spell it that way) and never sets `url` at
 * all; `responseURL` is the XHR spelling some managers pass through.
 *
 * Nothing is invented when none of them is present: undefined comes back, and
 * checkUrl() refuses it as a malformed URL. That is the fail-closed direction on
 * purpose — a response whose origin cannot be established is exactly the case
 * this check exists for, and translating must not proceed on a "probably fine".
 */
function landedUrl(res: unknown): unknown {
    const r = res as Record<string, unknown>;
    if (typeof r?.url === "string") return r.url;
    if (typeof r?.finalUrl === "string") return r.finalUrl;
    if (typeof r?.responseURL === "string") return r.responseURL;
    return undefined;
}

type RedirectKind = "none" | "replay" | "reissue" | "unreadable";

/**
 * What kind of redirect, if any, is this response?
 *
 * Both fetches below ask for `redirect: "manual"`, so a provider answering 3xx
 * should hand the redirect itself back instead of the runtime chasing it. Three
 * shapes have to be recognised because this one module runs on two different
 * fetches, and this same helper is copied into the other two transports:
 *
 *   Fetch standard in a page       an OPAQUE-REDIRECT filtered response:
 *                                  status 0, url "", type "opaqueredirect".
 *   Node / Electron main (undici)  the real response: status 300..399, url set,
 *                                  Location readable.
 *   GM_fetch                       resolves the raw GM_xmlhttpRequest response,
 *                                  which carries the 3xx status directly — when
 *                                  the manager honours `redirect` at all.
 *
 * All the tests are applied in all three copies rather than one each, because the
 * copies are compared to each other by the drift test and a helper that only
 * handled its own runtime would make that comparison meaningless.
 *
 * The opaque shape is tested FIRST and never falls through to the status test: its
 * status is 0, which is not in 3xx, so an order that read the status first would
 * classify a redirect as "none" and hand an empty body to the plugin as though the
 * provider had answered.
 */
function redirectKind(res: unknown): RedirectKind {
    const r = res as { status?: unknown; type?: unknown; };
    if (r?.type === "opaqueredirect") return "unreadable";
    const status = r?.status;
    if (typeof status !== "number" || status < 300 || status > 399) return "none";
    if (BODY_REPLAYING_REDIRECTS.includes(status)) return "replay";
    if (GET_REISSUING_REDIRECTS.includes(status)) return "reissue";
    // 300, 304-306, 309+: a 3xx whose semantics we have not reasoned about.
    return "unreadable";
}

/**
 * Is this response a redirect that must not be followed AT ALL?
 *
 * True for the body-replaying statuses and for anything unclassifiable. A
 * "reissue" redirect is deliberately NOT refused here — it is handed to
 * redirectTarget() below, which refuses it unless the Location passes the same
 * checkUrl() the original URL did.
 */
function refusedRedirect(res: unknown): boolean {
    const kind = redirectKind(res);
    return kind === "replay" || kind === "unreadable";
}

/** The reason string that goes with refusedRedirect() saying yes. */
function redirectRefusal(res: unknown): string {
    return redirectKind(res) === "replay" ? REDIRECT_REPLAY_REFUSAL : REDIRECT_OPAQUE_REFUSAL;
}

/**
 * Read one header off whatever the runtime resolved with, without assuming it is
 * a Response.
 *
 * This is where the two fetches diverge hardest. The page's fetch has a Headers
 * object; GM_fetch resolves the raw GM_xmlhttpRequest response, which carries
 * `responseHeaders` as one unparsed STRING and no `headers.get` at all. Nothing
 * is parsed out of that string here: a response this cannot read comes back null
 * and the caller refuses. That is the fail-closed direction, and on the GM path
 * it costs nothing, because a manager that ignores `redirect` has already
 * followed the redirect and never reaches this code.
 */
function headerValue(res: unknown, name: string): string | null {
    const headers = (res as { headers?: { get?: unknown; }; })?.headers;
    const get = headers?.get;
    if (typeof get !== "function") return null;
    const value = (get as (n: string) => unknown).call(headers, name);
    return typeof value === "string" ? value : null;
}

/**
 * Where a followable (301/302/303) redirect wants to send us, IF that is a place
 * this transport may go.
 *
 * The Location is third-party text: it is whatever the redirecting host chose to
 * put in the header. It therefore goes through the SAME checkUrl() the caller's
 * URL went through — https, an allow-listed hostname, the default port, no
 * embedded credentials — and the href that comes back out of that check is what
 * is fetched, not the raw header value.
 *
 * A relative Location is resolved against the URL that was requested, which is
 * already known-allowed; resolution cannot silently escape, because "//evil.test/x"
 * and "https://evil.test/x" both resolve to a host checkUrl() then refuses.
 *
 * The refusal never echoes the Location. It is attacker-supplied text and this
 * string is returned to the caller and written to the console.
 */
function redirectTarget(res: unknown, from: string): UrlCheck {
    const location = headerValue(res, "location");
    if (location === null || location === "") return { ok: false, why: REDIRECT_REFUSAL };

    let resolved: string;
    try {
        resolved = new URL(location, from).href;
    } catch {
        return { ok: false, why: REDIRECT_REFUSAL };
    }

    const checked = checkUrl(resolved);
    return checked.ok ? checked : { ok: false, why: REDIRECT_REFUSAL };
}

function shapeRetryAfter(header: string | null): number | undefined {
    const ms = header ? Number(header) * 1000 : undefined;
    return Number.isFinite(ms) ? ms : undefined;
}

let nextId = 1;
const pending = new Map<number, (res: HttpResponse) => void>();
let listening = false;

function listenForReplies() {
    if (listening) return;
    listening = true;

    window.addEventListener("message", event => {
        // Same-frame only. The content script posts back into this frame; anything
        // arriving from an iframe or opener is not ours.
        if (event.source !== window) return;

        const data = event.data;
        if (!data || data.type !== RESPONSE) return;

        const resolve = pending.get(data.id);
        if (!resolve) return;

        pending.delete(data.id);
        const res = data.response;
        resolve({
            status: typeof res?.status === "number" ? res.status : 0,
            body: typeof res?.body === "string" ? res.body : "",
            retryAfterMs: typeof res?.retryAfterMs === "number" ? res.retryAfterMs : undefined
        });
    });
}

function viaExtension(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    listenForReplies();

    const id = nextId++;

    return new Promise<HttpResponse>(resolve => {
        const timer = setTimeout(() => {
            // delete() reports whether it was still outstanding, so a reply that
            // races the timeout cannot resolve the promise twice.
            if (pending.delete(id)) {
                resolve({ status: 0, body: "translation request timed out" });
            }
        }, TIMEOUT_MS);

        pending.set(id, res => {
            clearTimeout(timer);
            resolve(res);
        });

        // init is forwarded rather than validated here: this side runs in a world
        // the page can already reach, so a check here would be advice. The control
        // is shapeRequest() in translationHost.js, which validates whatever
        // actually arrives. Only the two known keys are ever put on the wire.
        window.postMessage({
            type: REQUEST,
            id,
            url,
            init: init === undefined ? undefined : { method: init.method, body: init.body }
        }, location.origin);
    });
}

async function directFetch(url: string, init?: HttpRequestInit): Promise<HttpResponse> {
    const checked = checkUrl(url);
    if (!checked.ok) {
        console.warn("[Discord Translator] Blocked translation request:", checked.why);
        return { status: 0, body: `blocked: ${checked.why}` };
    }

    const shaped = shapeRequest(init);
    if (!shaped.ok) {
        console.warn("[Discord Translator] Blocked translation request:", shaped.why);
        return { status: 0, body: `blocked: ${shaped.why}` };
    }

    try {
        let res: Response;

        if (usesFollowMode(checked.href)) {
            // THE EXCEPTION, and the only branch in this file that does not ask for
            // `redirect: "manual"`. usesFollowMode() is the named predicate and the
            // sole gate: it answers true only for the exact host in FOLLOW_MODE_HOSTS,
            // and only in a transport whose runtime cannot describe a redirect. BOTH
            // BUILDS THIS FILE SERVES ARE SUCH RUNTIMES — the plain-web page fetch
            // answers "manual" with an opaque redirect, and GM_fetch's manager follows
            // redirects on its own whatever is asked — so this is the branch that makes
            // the Apps Script provider work in the plain web build at all, and the one
            // that makes the userscript build's behaviour deliberate rather than
            // accidental. Read the block above FOLLOW_MODE_HOSTS before touching it:
            // the hop is invisible here, which is what the residual risk is about.
            res = shaped.method === "POST"
                ? await fetch(checked.href, {
                    method: "POST",
                    headers: { "Content-Type": JSON_CONTENT_TYPE },
                    body: shaped.body,
                    redirect: "follow"
                })
                : await fetch(checked.href, { redirect: "follow" });

            // A runtime that hands back a 3xx while it was asked to FOLLOW one has
            // neither followed it nor been asked to describe it. Nothing here can
            // reason about that, so it fails closed under the existing refusals
            // rather than being read as an answer with an empty body.
            if (redirectKind(res) !== "none") {
                const why = redirectRefusal(res);
                console.warn("[Discord Translator] Blocked translation redirect:", why);
                return { status: 0, body: `blocked: ${why}` };
            }

            // WHERE IT LANDED is the only thing still observable, and this is the
            // check that makes the exception narrow: the response is refused unless
            // it ends on script.google.com or script.googleusercontent.com — not
            // merely somewhere on the general allow-list. landedUrl(), not res.url,
            // because on the userscript build the final URL is `finalUrl` and a check
            // that only knew `url` would refuse every request on that path.
            //
            // The refusal deliberately does not echo the landing URL. It is
            // third-party text, and this string is returned to the page and written
            // to the console.
            if (!landedWithinFollowScope(landedUrl(res))) {
                console.warn("[Discord Translator] Blocked translation response:", FOLLOW_LANDING_REFUSAL);
                return { status: 0, body: `blocked: ${FOLLOW_LANDING_REFUSAL}` };
            }
        } else {
            res = await manualFetch(checked.href, shaped);

            if (refusedRedirect(res)) {
                const why = redirectRefusal(res);
                console.warn("[Discord Translator] Blocked translation redirect:", why);
                return { status: 0, body: `blocked: ${why}` };
            }

            if (redirectKind(res) === "reissue") {
                // A 301/302/303 the runtime described to us. The original request is
                // NOT replayed here and could not be: what follows is a GET with no
                // body and no Content-Type, exactly as a client reissuing a 303 does.
                // A 307 or 308 never reaches this branch — refusedRedirect() above
                // stops it, because that is the pair that would replay the body.
                //
                // ⚠ NEITHER BUILD THIS FILE SERVES ARRIVES HERE TODAY, and that is no
                // longer a product gap — it is what the follow branch above is for.
                //   plain web   the page's fetch answers "manual" with an opaque
                //               redirect, refused above. Any host OTHER than the Apps
                //               Script one therefore still cannot be followed here,
                //               which is the fail-closed default and is intended.
                //   userscript  GM_fetch's manager follows the redirect itself and
                //               hands back a 200 from the far end.
                // The branch stays because the three transports are pinned identical
                // and because native.ts — whose runtime DOES describe a redirect —
                // takes exactly this path, including for the Apps Script host.
                const target = redirectTarget(res, checked.href);
                if (!target.ok) {
                    console.warn("[Discord Translator] Blocked translation redirect:", target.why);
                    return { status: 0, body: `blocked: ${target.why}` };
                }

                // NO body, NO Content-Type. The Content-Type belonged to the payload
                // that is deliberately not being sent again, and forwarding it would
                // describe a body that does not exist. target.href is the output of
                // checkUrl(), so what was validated is what is requested.
                res = await fetch(target.href, { redirect: "manual" });

                // ONE hop. A redirect from the redirect target is refused rather than
                // chased — including another 302 to somewhere allow-listed.
                if (redirectKind(res) !== "none") {
                    console.warn("[Discord Translator] Blocked translation redirect:", REDIRECT_HOP_REFUSAL);
                    return { status: 0, body: `blocked: ${REDIRECT_HOP_REFUSAL}` };
                }
            }
        }

        // Belt and braces, and it is NOT the control.
        //
        // On the page's own fetch, reaching here means the runtime ignored
        // `redirect: "manual"`. On the userscript build it means the manager did —
        // which, per the note above, is the NORMAL case for Violentmonkey and
        // Greasemonkey. Either way the request has already been handed to whatever
        // answered, and this check can only stop the RESPONSE reaching the plugin.
        // That is precisely the mistake the old post-hoc guard made and presented as
        // protection. It is kept because failing closed on a response of unknown
        // origin is still worth doing, and because a response that will not say
        // where it came from is refused here rather than trusted. The message says
        // "the response came from", not "blocked after redirect", so nobody reads it
        // as a promise that nothing left the machine.
        //
        // On the follow-mode branch it is strictly weaker than the landing check
        // that already ran, and it is kept anyway: two checks that disagree is a
        // bug worth failing on, and deleting it would leave the general path
        // depending on a rule written for the exception.
        const landed = checkUrl(landedUrl(res));
        if (!landed.ok) {
            console.warn("[Discord Translator] Blocked translation response:", landed.why);
            return { status: 0, body: `blocked response origin: ${landed.why}` };
        }

        const body = await res.text();

        return {
            status: res.status,
            body,
            retryAfterMs: shapeRetryAfter(res.headers.get("retry-after"))
        };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}

/**
 * The ordinary request: `redirect: "manual"` on BOTH verbs, which is the control
 * every host but the one in FOLLOW_MODE_HOSTS gets.
 *
 * Split out of directFetch() so the two branches of the redirect decision read as
 * two branches rather than as one nested ternary inside another. The GET is not
 * spelled with a single argument, for the reason it never was: leaving it bare would
 * put the free gtx provider on the default "follow", and that provider is the one
 * whose query string IS the message (see urlFor() in core/providers/google.ts).
 *
 * "manual" rather than "error": both stop the redirect being followed, but "error"
 * rejects the promise and lands in the caller's catch as an opaque network-failure
 * string, indistinguishable from the provider being unreachable. "manual" hands back
 * a response that can be recognised, so the refusal can say what actually happened.
 *
 * checked.href rather than the caller's url: the normalised form the guard actually
 * inspected, so what was validated is what is sent.
 *
 * ⚠ THE USERSCRIPT BUILD IS NOT COVERED BY THIS AND HAS NOT BEEN FIXED.
 *
 * In the userscript bundle `fetch` is not the page's fetch: it is GM_fetch from
 * browser/GMPolyfill.js, injected by scripts/build/buildWeb.mjs. GM_fetch does not
 * implement `redirect` — it assigns url/data/responseType onto the options object
 * and hands the whole thing to GM_xmlhttpRequest, so whether `redirect` means
 * anything is entirely the userscript manager's decision. Tampermonkey documents a
 * `redirect` option on GM_xmlhttpRequest; Violentmonkey and Greasemonkey document
 * none, and both ignore option keys they do not recognise rather than erroring.
 * Under those two the redirect IS followed and the request — POST body or query
 * string — HAS ALREADY REACHED THE OTHER ORIGIN by the time the caller's checks run.
 *
 * The key is passed anyway because it costs nothing and helps wherever it is
 * honoured, but it must not be read as coverage: no test in this repo drives a real
 * userscript manager, so for that build this is unverified mitigation and the
 * residual exposure is real. PRIVACY.md says the same thing to users, in the
 * redirect paragraph under "The Browser Extension". The honest fix is a
 * manager-agnostic way to suppress redirects, which GM_xmlhttpRequest does not offer.
 */
function manualFetch(href: string, shaped: { method: "GET" | "POST"; body?: string; }): Promise<Response> {
    return shaped.method === "POST"
        ? fetch(href, {
            method: "POST",
            headers: { "Content-Type": JSON_CONTENT_TYPE },
            body: shaped.body,
            redirect: "manual"
        })
        : fetch(href, { redirect: "manual" });
}

/**
 * The object the plugin looks for at VencordNative.pluginHelpers.ChannelTranslator.
 * Its shape is fixed by state.ts and selection.ts, which type it structurally — if
 * this drifts, they fall back to throwing "native bridge unavailable" rather than
 * failing at build time, so change both together.
 */
export const ChannelTranslatorHelper = {
    fetchTranslation: (url: string, init?: HttpRequestInit): Promise<HttpResponse> =>
        IS_EXTENSION ? viaExtension(url, init) : directFetch(url, init)
};
