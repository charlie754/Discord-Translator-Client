/*
 * Registers the translation transport. MV3 requires every message listener to be
 * registered synchronously at worker startup — the worker is torn down when idle,
 * and a listener added later would not be there to wake it for the next request.
 *
 * Firefox loads the same file through manifestv2.json's background.scripts instead.
 */
importScripts("translationHost.js");

const UPDATE_CHECK_REQUEST = "discordTranslator:update:check";
const UPDATE_RELOAD_REQUEST = "discordTranslator:update:reload";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.action === UPDATE_RELOAD_REQUEST) {
        try {
            chrome.runtime.reload();
        } catch {
            // The page has a store-link fallback if the worker cannot reload.
        }
        return;
    }

    if (message.action !== UPDATE_CHECK_REQUEST) return;

    if (typeof chrome.management?.getSelf !== "function") {
        sendResponse({ status: "unavailable", installType: null });
        return;
    }

    chrome.management.getSelf(self => {
        if (chrome.runtime.lastError) {
            sendResponse({ status: "getSelf_error", installType: null });
            return;
        }

        if (self?.installType !== "normal") {
            sendResponse({ status: "development", installType: self?.installType ?? null });
            return;
        }

        if (typeof chrome.runtime.requestUpdateCheck !== "function") {
            sendResponse({ status: "error", installType: self.installType });
            return;
        }

        chrome.runtime.requestUpdateCheck((status, details) => {
            if (chrome.runtime.lastError) {
                sendResponse({ status: "error", installType: self.installType });
                return;
            }
            sendResponse({ status, version: details?.version, installType: self.installType });
        });
    });
    return true;
});
