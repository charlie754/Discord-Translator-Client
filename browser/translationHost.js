/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The browser twin of src/plugins/channelTranslator/native.ts.
 *
 * On the desktop the translation transport runs in the Electron main process; here
 * it runs in the extension's background context, which is the only place in the
 * extension that can fetch cross-origin without CORS. Both exist for the same
 * reason and both carry the same guard, so THE HOST LIST BELOW MUST STAY IN SYNC
 * WITH native.ts. scripts/checkHosts.mjs fails CI if either drifts from
 * scripts/allowed-hosts.txt.
 *
 * Loaded by both background targets, because MV2 and MV3 disagree about everything
 * except this:
 *   - Firefox MV2: listed in background.scripts, before background.js
 *   - Chrome MV3:  importScripts()'d at the top of service-worker.js
 * The listener is therefore registered at module top level, which MV3 requires —
 * a service worker is torn down when idle and a listener registered inside a
 * callback would not be there to wake it.
 */

/**
 * Exact hostnames this transport may reach.
 *
 * The relay that feeds it is reachable from Discord's own page world by design, so
 * without this list any script on the page would hold an unrestricted GET proxy
 * that ignores the page's CSP. Adding a provider means adding its host here.
 *
 * Every entry is a full hostname and is matched with Set.has(). Do not relax this
 * into a suffix or wildcard test to save two lines: endsWith("deepl.com") also
 * admits evil-deepl.com, and a subdomain wildcard trusts whatever DNS the vendor
 * ever delegates. DeepL needs two entries because it splits its API by plan.
 */
const ALLOWED_HOSTS = new Set([
    // core/providers/google.ts — the default, keyless gtx endpoint
    "translate.googleapis.com",
    // core/providers/deepl.ts — contacted only if the user configures a DeepL key
    "api-free.deepl.com",
    "api.deepl.com"
]);

/** A translation response is JSON; a megabyte of it is already absurd. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * @param {string} url
 * @returns {string | null} the reason it is refused, or null if it is allowed
 */
function refuse(url) {
    if (typeof url !== "string") return "malformed URL";

    let target;
    try {
        target = new URL(url);
    } catch {
        return "malformed URL";
    }

    // Exact hostname match only: endsWith would let evilgoogleapis.com through, and a
    // subdomain wildcard would trust anything Google's DNS ever delegates.
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
        return `${target.protocol}//${target.hostname} is not an allowed translation host`;
    }

    return null;
}

/**
 * Never throws. A rejected promise here would surface in the page as an opaque
 * "message port closed" and tell the user nothing, so every failure comes back as
 * a status the renderer can reason about — which is the same contract native.ts has.
 *
 * @param {string} url
 * @returns {Promise<{ status: number, body: string, retryAfterMs?: number }>}
 */
async function fetchTranslation(url) {
    const why = refuse(url);
    if (why) {
        console.warn("[Discord Translator] Blocked translation request:", why);
        return { status: 0, body: `blocked: ${why}` };
    }

    try {
        // credentials are omitted so no cookie for these hosts is ever attached;
        // the desktop main process has no cookie jar to leak, and this matches it.
        const res = await fetch(url, { credentials: "omit", cache: "no-store" });

        // Redirects are followed, as they are on the desktop, but the host that
        // actually answered is re-checked: without this, one 302 from an allowed
        // host would carry the message text to an arbitrary origin.
        const landed = refuse(res.url);
        if (landed) {
            console.warn("[Discord Translator] Blocked translation redirect:", landed);
            return { status: 0, body: `blocked after redirect: ${landed}` };
        }

        const body = (await res.text()).slice(0, MAX_BODY_BYTES);

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

// chrome.*, not browser.*, on purpose. Firefox exposes both, but browser.* is
// promise-style and treats a second argument as options rather than a callback;
// chrome.* is callback-style in every one of Chrome, Edge and Firefox, so this is
// the only spelling that behaves identically on all three.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== "discordTranslator:fetch") return;

    // Returning true keeps the channel open for the async reply. Firefox honours
    // this as well as Chrome, so one code path serves both.
    fetchTranslation(message.url).then(sendResponse);
    return true;
});
