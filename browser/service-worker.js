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

/*
 * Set ONLY by this worker's own evidence that a store update is downloaded and waiting - its own
 * requestUpdateCheck() answering "update_available", or Chrome's onUpdateAvailable - and never by a
 * message. Any script on discord.com can post the reload request through content.js; without this
 * flag it could restart the extension at will, in a loop, for every Discord tab at once.
 *
 * Lost when Chrome stops this idle worker; the page then tells the user to restart the browser,
 * which is also when Chrome applies a waiting update by itself.
 */
let updateReady = false;
chrome.runtime.onUpdateAvailable?.addListener(() => {
    updateReady = true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;

    if (message.action === UPDATE_RELOAD_REQUEST) {
        if (!updateReady || sender?.frameId !== 0) {
            sendResponse({ reloaded: false });
            return;
        }
        sendResponse({ reloaded: true });
        setTimeout(() => chrome.runtime.reload(), 100);
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
            if (status === "update_available") updateReady = true;
            sendResponse({ status, version: details?.version, installType: self.installType });
        });
    });
    return true;
});
