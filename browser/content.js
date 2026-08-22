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

window.addEventListener("message", event => {
    // Only this frame's own page script. Without this, any embedded iframe could
    // drive the relay.
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.type !== REQUEST || typeof data.id !== "number") return;

    chrome.runtime.sendMessage(
        { action: REQUEST, url: data.url },
        response => {
            // A dead background, a torn-down service worker, or an extension reload
            // all land here with no response. Answer anyway: the page is awaiting a
            // promise and silence would hang the translation queue forever.
            const error = chrome.runtime.lastError;
            window.postMessage({
                type: RESPONSE,
                id: data.id,
                response: response || {
                    status: 0,
                    body: error ? `extension error: ${error.message}` : "extension gave no response"
                }
            }, window.location.origin);
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
