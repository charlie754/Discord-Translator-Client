/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * The only two things a caller may vary beyond the URL. Kept structurally
 * identical to HttpRequestInit in core/providers/types.ts and to the shaping in
 * browser/translationHost.js and browser/translationBridge.ts — the value is
 * duplicated rather than imported because the main process must not depend on
 * core/, exactly as HttpResponse above already is.
 */
export interface HttpRequestInit {
    method?: "GET" | "POST";
    body?: string;
}

/**
 * Exact hostnames this transport may reach. Main-process fetch is not subject to
 * renderer CSP, and this handler is reachable from Discord's own world via
 * VencordNative, so without this list any page script would hold an unrestricted
 * proxy onto localhost and the LAN. Adding a provider means adding its host here.
 *
 * Every entry is a full hostname and is matched with ===. Do not relax this into a
 * suffix or wildcard test to save two lines: `endsWith("googleapis.com")` also
 * admits evil-googleapis.com, and a subdomain wildcard trusts whatever DNS the
 * vendor ever delegates.
 *
 * Both surviving providers are free and keyless-or-self-hosted. Nothing here can
 * bill the user, and there is deliberately no entry that requires a paid account.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
    // core/providers/google.ts — the default, keyless gtx endpoint
    "translate.googleapis.com",
    // core/providers/appsScript.ts — a Web App the USER deployed on their OWN
    // Google account, contacted only if they paste its deployment URL. Unlike the
    // gtx endpoint above it is not a vendor endpoint: the path names one
    // deployment, and the path is exactly what this guard does not check. That is not a gap being
    // waved through — checkDeploymentUrl() in appsScript.ts refuses any path that
    // is not /macros/s/<id>/exec and rebuilds the URL from what it parsed, so the
    // string reaching this transport is the shape that was validated. What is
    // being accepted here is the HOST, and the host is shared with every other
    // Apps Script deployment on the internet.
    "script.google.com",
    // Where Apps Script actually SERVES the result of a Web App call. A POST to
    // /exec on script.google.com answers 302 to this host every single time —
    // measured against a live deployment — and the JSON is served from here, so
    // without this entry the Apps Script provider cannot complete a single
    // request. It is reached only as the target of that 302, and only after the
    // Location has been through checkUrl() like any other URL.
    "script.googleusercontent.com"
]);

/**
 * Longest request body this transport will send, matching the response cap in
 * browser/translationHost.js. A Discord message is at most 4000 characters, so
 * a megabyte is already three orders of magnitude past anything legitimate — the
 * cap exists so that a page script cannot use the proxy to push bulk data out,
 * not because a real translation could reach it.
 */
const MAX_BODY_CHARS = 1024 * 1024;

/**
 * Fixed, never caller-supplied. The whole reason HttpRequestInit has no headers
 * field is that this handler is reachable from the page world; letting a caller
 * name a header would reinstate the injection channel the host allow-list exists
 * to close.
 */
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
 * ⚠ NOT A THEORETICAL BRANCH. It is exactly what the extension background and the
 * plain-web page fetch see for EVERY 3xx, so on those runtimes nothing can be
 * classified here at all. Node/undici — what this file runs on in the Electron
 * main process — hands back the real 302 with its headers, so the desktop can.
 *
 * That difference used to be written down as a product gap: the Apps Script
 * provider worked on the desktop and could not work in the browser builds. IT IS
 * NO LONGER ONE, and the correction matters more than the refusal does. Asking
 * for "manual" is what produces the opaque response; a browser asked to FOLLOW
 * the same 302 follows it perfectly well. The browser transports therefore take a
 * follow branch for exactly one host — see FOLLOW_MODE_HOSTS below, which carries
 * the measurement and the residual risk. This refusal keeps its job for every
 * OTHER host on those runtimes, where it is still the only fail-closed answer.
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
 * The difference is not academic here. A Google Apps Script Web App ALWAYS
 * answers /exec with a 302 to script.googleusercontent.com, which is where the
 * result is actually served — measured against a live deployment. Refusing every
 * 3xx made core/providers/appsScript.ts a provider that could not succeed once.
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
 * TRUE here and FALSE in the two browser transports — the one line that differs
 * between the three copies, and the reason is in the block above. It is a constant
 * rather than a feature test because the mode has to be chosen before the request
 * is issued, and because a feature test would be a second request.
 */
const RUNTIME_DESCRIBES_REDIRECTS = true;

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
 * Normalise and validate the request options.
 *
 * Refuses rather than coerces: a message from the page carrying a verb we do not
 * expect, a non-string body, or a key we have never heard of is a sign of
 * something trying its luck, and silently downgrading it to a GET would hide
 * that. Unknown keys are rejected specifically so an attempt to smuggle
 * `headers` fails loudly instead of being quietly dropped.
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

type UrlCheck =
    | { ok: true; href: string; }
    | { ok: false; why: string; };

/**
 * Decide whether this transport may reach the URL, and hand back the NORMALISED
 * form so that what was checked is what is sent.
 *
 * Returning the href rather than letting the caller re-use its own string closes
 * a validate-one-thing-send-another gap: `new URL()` is the parser whose opinion
 * the whole check rests on, so the request has to be made against that parser's
 * output rather than against the raw text it was handed.
 *
 * Takes `unknown` because it is applied twice — once to the URL the renderer
 * asked for, and once to the URL that actually answered, which comes off a
 * Response and is not guaranteed to be a string.
 */
function checkUrl(url: unknown): UrlCheck {
    if (typeof url !== "string") return { ok: false, why: "malformed URL" };

    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return { ok: false, why: "malformed URL" };
    }

    // Exact hostname match only: endsWith would let evilgoogleapis.com through, and a
    // subdomain wildcard would trust anything Google's DNS ever delegates.
    //
    // The PORT is constrained as well, and only the empty string is accepted.
    // That is not a shortcut for "any port": a URL naming no port, or naming 443
    // explicitly, both parse with target.port === "" because the parser strips a
    // scheme's own default, so "" is exactly "the https port and nothing else".
    // Deliberate — every provider is reached on 443, and this handler is reachable
    // from the page world, so an allowed hostname with a free choice of port would
    // be a POST primitive against any TCP port that name resolves to, localhost
    // and the LAN included by way of whatever DNS answers for it.
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
    // URL does not strip them either. What stops the request today is fetch()
    // itself, which refuses "a URL that includes credentials". That is the RUNTIME
    // closing the hole rather than this guard, and nothing pinned it: a runtime, a
    // polyfill, or GMPolyfill's GM_fetch that chose to send it instead of throwing
    // would turn a hard failure into a request carrying attacker-chosen
    // credentials to a provider, with no code change here to notice.
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

type RedirectKind = "none" | "replay" | "reissue" | "unreadable";

/**
 * What kind of redirect, if any, is this response?
 *
 * Every fetch below is made with `redirect: "manual"`, so a provider answering 3xx
 * hands the redirect itself back instead of the runtime chasing it. Two shapes have
 * to be recognised because the runtimes disagree, and this same helper is copied
 * into the two browser transports:
 *
 *   Node / Electron main (undici)  the real response: status 300..399, url set,
 *                                  Location readable.
 *   Fetch standard in a page       an OPAQUE-REDIRECT filtered response: status 0,
 *                                  url "", type "opaqueredirect", no headers.
 *
 * Both are checked in all three copies rather than one each, because which runtime
 * a transport ends up on is not something this file gets to assume — Electron's
 * main-process fetch has been both Chromium's and Node's across versions.
 *
 * The opaque shape is tested FIRST and never falls through to the status test: its
 * status is 0, which is not in 3xx, so an order that read the status first would
 * classify a redirect as "none" and hand an empty body to the plugin as though the
 * provider had answered.
 *
 * Takes `unknown` for the same reason checkUrl() does: it is handed whatever the
 * runtime's fetch resolved with, which on the userscript path is not a Response.
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
 * a Response. GM_fetch resolves the raw GM_xmlhttpRequest object, which has no
 * Headers at all; a missing or non-string value comes back as null and the
 * caller refuses, which is the fail-closed direction.
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

/**
 * Main-process transport for translation requests. Never throws — a thrown error
 * crosses ipcMain.handle only as a mangled string, so failures come back as a status
 * the renderer can reason about.
 */
export async function fetchTranslation(
    _: IpcMainInvokeEvent,
    url: string,
    init?: HttpRequestInit
): Promise<HttpResponse> {
    const checked = checkUrl(url);
    if (!checked.ok) {
        console.warn("[Discord Translator] Blocked translation request:", checked.why);
        return { status: 0, body: `blocked: ${checked.why}` };
    }

    // Shape is checked AFTER the host, so a refused host is still reported as a
    // host problem no matter what else the message carried.
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
            // and only in a transport whose runtime cannot describe a redirect. In
            // THIS file RUNTIME_DESCRIBES_REDIRECTS is true, so this branch never runs
            // on the desktop — it is kept identical to the two browser transports on
            // purpose. Read the block above FOLLOW_MODE_HOSTS before touching it: the
            // hop is invisible here, which is what the residual risk is about.
            res = shaped.method === "POST"
                ? await fetch(checked.href, {
                    method: "POST",
                    headers: { "User-Agent": "Mozilla/5.0", "Content-Type": JSON_CONTENT_TYPE },
                    body: shaped.body,
                    redirect: "follow"
                })
                : await fetch(checked.href, {
                    headers: { "User-Agent": "Mozilla/5.0" },
                    redirect: "follow"
                });

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
            // merely somewhere on the general allow-list.
            //
            // The refusal deliberately does not echo the landing URL. It is
            // third-party text, and this string is returned to the page and written
            // to the console.
            if (!landedWithinFollowScope(res.url)) {
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
                // This is the branch the Apps Script provider lives on ON THE DESKTOP.
                // /exec answers 302 to script.googleusercontent.com every single time,
                // and this runtime can read that 302, so the desktop keeps the strong
                // path: the hop is INSPECTED before anything is sent onward, and a 307
                // is refused before the body flies. The browser transports cannot do
                // this, which is why they take the follow branch above instead.
                const target = redirectTarget(res, checked.href);
                if (!target.ok) {
                    console.warn("[Discord Translator] Blocked translation redirect:", target.why);
                    return { status: 0, body: `blocked: ${target.why}` };
                }

                // NO body, NO Content-Type. The Content-Type belonged to the payload
                // that is deliberately not being sent again, and forwarding it would
                // describe a body that does not exist. target.href is the output of
                // checkUrl(), so what was validated is what is requested.
                res = await fetch(target.href, {
                    headers: { "User-Agent": "Mozilla/5.0" },
                    redirect: "manual"
                });

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
        // If a runtime ever ignored `redirect: "manual"` above, execution reaches
        // here having already handed the request to whatever answered — this check
        // can then only stop the RESPONSE reaching the plugin, which is precisely
        // the mistake the old post-hoc guard made. It is kept because failing closed
        // on a response of unknown origin is still worth doing, and because a
        // response that will not say where it came from (no url at all) is refused
        // here rather than trusted. The message says "the response came from", not
        // "blocked after redirect", so nobody reads it as a promise that nothing
        // left the machine.
        //
        // On the follow-mode branch it is strictly weaker than the landing check
        // that already ran, and it is kept anyway: two checks that disagree is a
        // bug worth failing on, and deleting it would leave the general path
        // depending on a rule written for the exception.
        const landed = checkUrl(res.url);
        if (!landed.ok) {
            console.warn("[Discord Translator] Blocked translation response:", landed.why);
            return { status: 0, body: `blocked response origin: ${landed.why}` };
        }

        const body = await res.text();

        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;

        return {
            status: res.status,
            body,
            retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined
        };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}

/**
 * The ordinary request: `redirect: "manual"` on BOTH verbs, which is the control
 * every host but the one in FOLLOW_MODE_HOSTS gets.
 *
 * Split out of fetchTranslation() so the two branches of the redirect decision read
 * as two branches rather than as one nested ternary inside another.
 *
 * checked.href, not the caller's url: the normalised form the guard actually
 * inspected, so the string that was validated is the string that is sent.
 *
 * The default is "follow", and a followed redirect has already delivered the
 * request to the new origin before any code here can look at it. That is not only a
 * POST problem — see REDIRECT_REFUSAL above for why the free gtx provider's GET,
 * whose query string IS the message, is exposed too.
 *
 * "manual" rather than "error": both stop the RUNTIME chasing the redirect, but
 * "error" rejects the promise and lands in the caller's catch as an opaque
 * network-failure string, indistinguishable from the provider being unreachable.
 * "manual" hands back a response that can be INSPECTED, which is what makes the
 * status branch possible at all.
 */
function manualFetch(href: string, shaped: { method: "GET" | "POST"; body?: string; }): Promise<Response> {
    return shaped.method === "POST"
        ? fetch(href, {
            method: "POST",
            headers: { "User-Agent": "Mozilla/5.0", "Content-Type": JSON_CONTENT_TYPE },
            body: shaped.body,
            redirect: "manual"
        })
        : fetch(href, {
            headers: { "User-Agent": "Mozilla/5.0" },
            redirect: "manual"
        });
}
