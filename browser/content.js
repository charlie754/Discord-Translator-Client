if (typeof browser === "undefined") {
    var browser = chrome;
}

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

/** Matches MAX_BODY_CHARS in translationHost.js, which is where the real cap lives. */
const MAX_BODY_CHARS = 1024 * 1024;

function reply(id, response) {
    window.postMessage({ type: RESPONSE, id, response }, window.location.origin);
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
    if (!data || data.type !== REQUEST || typeof data.id !== "number") return;

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
                EXTENSION_VERSION: browser.runtime.getManifest().version,
                EXTENSION_BASE_URL: browser.runtime.getURL(""),
                RENDERER_CSS_URL: browser.runtime.getURL("dist/DiscordTranslator.css"),
            }
        });
    },
    { once: true }
);
