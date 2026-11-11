// Firefox exposes the promise-style `browser` API; Chrome exposes `chrome`. Reading
// through globalThis keeps the distinction intact in this classic content script.
const extensionApi = globalThis.browser ?? globalThis.chrome;
// Chrome 151 also defines `browser` in extension contexts, so namespace presence is not
// a Firefox test. Neither is runtime.getBrowserInfo: measured 2026-11-11 on Firefox Developer
// Edition 160, a CONTENT SCRIPT does not have it (only background and extension pages do), so that
// test reported Firefox as Chrome and the GOAT Cam permission gate below answered "granted"
// without asking - shipped in v0.2.17 and v0.2.18. The extension's own URL scheme is the test:
// moz-extension:// in Firefox, chrome-extension:// in Chrome and Edge, and runtime.getURL is
// available to content scripts in all of them.
const isFirefox = typeof extensionApi?.runtime?.getURL === "function"
    && extensionApi.runtime.getURL("").startsWith("moz-extension://");

/*
 * Translation relay.
 *
 * The bundle runs in the MAIN world, because patching Discord's webpack requires
 * being in the page's own realm before Discord loads. Nothing in the MAIN world can
 * see chrome.runtime, so the transport has to hop:
 *
 *   MAIN world  --window.postMessage-->  this content script
 *               --runtime.sendMessage-->  translationHost.js (background)
 *
 * and the reply comes back the same way. The host, not this file, holds the
 * hostname allow-list: this side runs in a world the page can reach, so a guard
 * here would be advice rather than a control.
 *
 * Registered at top level rather than inside DOMContentLoaded — the bundle runs at
 * document_start and may ask before the document parses.
 *
 * chrome.* is used rather than browser.* because Firefox's browser.* is
 * promise-style and would read the callback below as an options object.
 */
const REQUEST = "discordTranslator:fetch";
const RESPONSE = "discordTranslator:fetch:result";
const GATE_REQUEST = "goatcamBanner:gate";
const GATE_RESPONSE = "goatcamBanner:gate:result";
const UPDATE_CHECK_REQUEST = "discordTranslator:update:check";
const UPDATE_CHECK_RESPONSE = "discordTranslator:update:check:result";
const UPDATE_RELOAD_REQUEST = "discordTranslator:update:reload";
const UPDATE_RELOAD_RESPONSE = "discordTranslator:update:reload:result";

/** Matches MAX_BODY_CHARS in translationHost.js, which is where the real cap lives. */
const MAX_BODY_CHARS = 1024 * 1024;

function reply(id, response) {
    window.postMessage({ type: RESPONSE, id, response }, window.location.origin);
}

function replyGate(id, granted) {
    window.postMessage({ type: GATE_RESPONSE, id, granted }, window.location.origin);
}

function replyUpdateCheck(id, response) {
    window.postMessage({ type: UPDATE_CHECK_RESPONSE, id, response }, window.location.origin);
}

const AMO_VERSION_URL = "https://addons.mozilla.org/api/v5/addons/addon/discord-translator-web@charlie754.github.io/";
const GITHUB_VERSION_URL = "https://api.github.com/repos/charlie754/Discord-Translator-Client/releases/latest";

/*
 * The update check is decided AND MADE here, in the isolated world - page scripts cannot reach this
 * code. The page only receives the answer, which a hostile page script could fake to change the banner
 * text, but it cannot make the extension send a request the permission forbids (Council round 2).
 * Before this, the page decided from a `vencord:meta` message that any page script - or the real
 * Vencord extension, which posts the same type without IS_FIREFOX - can post first.
 *
 * `probe` answers only who we are (browser and installed version) and touches no network: the page
 * sends it while its 12-hour cache is still fresh. A full check runs at most once per page load.
 */
let fullUpdateCheckDone = false;

function checkForExtensionUpdate(data) {
    const installed = extensionApi.runtime.getManifest().version;

    if (data.probe === true || fullUpdateCheckDone) {
        replyUpdateCheck(data.id, { browser: isFirefox ? "firefox" : "chrome", installed, probe: true });
        return;
    }
    fullUpdateCheckDone = true;

    if (isFirefox) {
        // Operator ruling: Firefox checks AMO only with the optional technicalAndInteraction data
        // permission - the same gate as the GOAT Cam banner, answered by the MV2 background page.
        Promise.resolve(extensionApi.runtime.sendMessage({ action: GATE_REQUEST }))
            .then(response => response?.granted === true, () => false)
            .then(async allowed => {
                const latest = allowed ? await fetchLatestVersion(AMO_VERSION_URL, json => json?.current_version?.version) : null;
                replyUpdateCheck(data.id, { browser: "firefox", installed, allowed, latest });
            });
        return;
    }

    chrome.runtime.sendMessage({ action: UPDATE_CHECK_REQUEST }, async response => {
        const error = chrome.runtime.lastError;
        if (error) {
            replyUpdateCheck(data.id, { browser: "chrome", installed, status: "unavailable" });
            return;
        }
        // An unpacked install has no store to ask, so it compares with the latest GitHub release.
        const latest = response?.installType === "normal"
            ? null
            : await fetchLatestVersion(GITHUB_VERSION_URL, json => typeof json?.tag_name === "string" ? json.tag_name.replace(/^v/, "") : null);
        replyUpdateCheck(data.id, { browser: "chrome", installed, status: response?.status, version: response?.version, installType: response?.installType, latest });
    });
}

/*
 * A plain GET with nothing of ours in it. Firefox content scripts get `content.fetch`, which sends the
 * request as the page (Origin https://discord.com) instead of with the add-on's per-install
 * moz-extension origin; Chrome content scripts already fetch with the page's origin.
 */
async function fetchLatestVersion(url, pick) {
    try {
        const doFetch = typeof globalThis.content?.fetch === "function" ? globalThis.content.fetch.bind(globalThis.content) : fetch;
        const response = await doFetch(url, { credentials: "omit" });
        if (response.status !== 200) return null;
        const version = pick(await response.json());
        return typeof version === "string" && /^\d+(?:\.\d+)*$/.test(version) ? version : null;
    } catch {
        return null;
    }
}

function reloadExtension(data) {
    const replyReload = reloaded => window.postMessage({ type: UPDATE_RELOAD_RESPONSE, id: data.id, reloaded }, window.location.origin);

    // Firefox has no restart-onto-update path here; the banner links to the add-on page instead.
    if (isFirefox) {
        replyReload(false);
        return;
    }

    try {
        chrome.runtime.sendMessage({ action: UPDATE_RELOAD_REQUEST }, response => {
            // Reading lastError also stops Chrome logging an unhandled error when the reload
            // tears the worker down before it answers.
            const error = chrome.runtime.lastError;
            replyReload(error ? true : response?.reloaded === true);
        });
    } catch {
        // The extension context is gone - typically because it already restarted onto the update.
        replyReload(true);
    }
}

function gate(data) {
    // Chrome exposes only chrome; Firefox exposes the browser namespace. The
    // Chrome package is allowed without a permission check. Firefox content
    // scripts cannot access the permissions API, so ask the Firefox MV2
    // background page instead.
    if (!isFirefox) {
        replyGate(data.id, true);
        return;
    }

    Promise.resolve(extensionApi.runtime.sendMessage({ action: GATE_REQUEST }))
        .then(response => replyGate(data.id, response?.granted === true), () => replyGate(data.id, false));
}

/**
 * Rebuild the request options as a fresh object holding only the two keys the
 * transport understands, or refuse.
 *
 * Refusing rather than forwarding-and-letting-the-host-decide matters because
 * this is the hop out of the page's world: a message carrying `headers`, a verb
 * that is not GET or POST, or a non-string body is something trying its luck and
 * must not travel any further. shapeRequest() in translationHost.js re-checks
 * all of it — that one is the control, this one is defence in depth — but a
 * relay that passed anything through unread would make the host's check the
 * only thing between the page and the network.
 *
 * The object is REBUILT rather than passed along so that no key we have not
 * named can ride to the background, whatever the page put on it.
 */
function shapeInit(init) {
    if (init === undefined || init === null) return { ok: true, init: undefined };
    if (typeof init !== "object" || Array.isArray(init)) return { ok: false };

    for (const key of Object.keys(init)) {
        if (key !== "method" && key !== "body") return { ok: false };
    }

    const method = init.method === undefined ? "GET" : init.method;
    if (method !== "GET" && method !== "POST") return { ok: false };

    // The same cross-checks shapeRequest() applies in the transports, so the two
    // halves of the relay agree about what a legal request is. A rule enforced on
    // only one side is a rule that drifts.
    if (init.body === undefined) {
        if (method === "POST") return { ok: false };
    } else {
        if (typeof init.body !== "string") return { ok: false };
        if (method !== "POST") return { ok: false };
        if (init.body.length > MAX_BODY_CHARS) return { ok: false };
    }

    return { ok: true, init: { method: init.method, body: init.body } };
}

window.addEventListener("message", event => {
    // Only this frame's own page script. Without this, any embedded iframe could
    // drive the relay.
    if (event.source !== window) return;

    const data = event.data;
    if (!data || typeof data.id !== "number") return;

    if (data.type === GATE_REQUEST && typeof data.id === "number") {
        gate(data);
        return;
    }

    // Update messages are honoured only in the top frame: that is the only frame the update banner
    // runs in, and a discord.com sub-frame must not be able to drive the update relay.
    if (data.type === UPDATE_CHECK_REQUEST) {
        if (window.top === window) checkForExtensionUpdate(data);
        return;
    }

    if (data.type === UPDATE_RELOAD_REQUEST) {
        if (window.top === window) reloadExtension(data);
        return;
    }

    if (data.type !== REQUEST) return;

    const shaped = shapeInit(data.init);
    if (!shaped.ok) {
        // Answered rather than dropped: the page holds a promise with a 20s
        // timeout, and an honest refusal beats a stalled translation queue.
        reply(data.id, { status: 0, body: "blocked: malformed translation request" });
        return;
    }

    chrome.runtime.sendMessage(
        { action: REQUEST, url: data.url, init: shaped.init },
        response => {
            // A dead background, a torn-down service worker, or an extension reload
            // all land here with no response. Answer anyway: the page is awaiting a
            // promise and silence would hang the translation queue forever.
            const error = chrome.runtime.lastError;
            reply(data.id, response || {
                status: 0,
                body: error ? `extension error: ${error.message}` : "extension gave no response"
            });
        }
    );
});

document.addEventListener(
    "DOMContentLoaded",
    () => {
        window.postMessage({
            type: "vencord:meta",
            meta: {
                EXTENSION_VERSION: extensionApi.runtime.getManifest().version,
                EXTENSION_BASE_URL: extensionApi.runtime.getURL(""),
                RENDERER_CSS_URL: extensionApi.runtime.getURL("dist/DiscordTranslator.css"),
                IS_FIREFOX: isFirefox,
            }
        });
    },
    { once: true }
);
