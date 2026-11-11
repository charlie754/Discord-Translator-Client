/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BOOT_FAILURE_DELAY_MS, BOOT_GUARD_KEY, CHROME_STORE_URL, FIREFOX_STORE_URL, GITHUB_VERSION_URL, AMO_VERSION_URL, UPDATE_CACHE_KEY, UPDATE_DISMISS_KEY, decideBoot, getUpdateButton, getUpdateSource, isCheckDue, isDismissed, isVersionNewer, shouldFail } from "./updateGuardCore";
import { BannerKind, openLink, showBanner, updateBanner } from "../src/utils/updateBanner";

// Discord removes window.localStorage during startup. Capture the object before
// the native stub and Discord itself have a chance to replace it.
const ls = (() => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
})();

const GUARD_GLOBAL = "__discordTranslatorBootGuard";
const UPDATE_CHECK_REQUEST = "discordTranslator:update:check";
const UPDATE_CHECK_RESULT = "discordTranslator:update:check:result";
const UPDATE_RELOAD_REQUEST = "discordTranslator:update:reload";
const UPDATE_RELOAD_RESULT = "discordTranslator:update:reload:result";
const UPDATE_TIMEOUT_MS = 5_000;
const RELOAD_TIMEOUT_MS = 3_000;
const DISCORD_HOSTNAMES = new Set(["discord.com", "ptb.discord.com", "canary.discord.com"]);

interface GuardGlobal {
    safeMode: boolean;
    webpackSeen: () => void;
    fluxDispatcherFound: () => void;
}

/**
 * What the extension's own content script (isolated world) reports. The browser and the Firefox
 * permission are decided THERE, not here. The page-world `vencord:meta` that web-metadata reads is
 * first-writer-wins, and the real Vencord extension posts one too (without IS_FIREFOX): trusting it let
 * a Firefox page take the Chrome path and query GitHub without the optional data permission.
 */
interface ExtensionInfo {
    browser: "firefox" | "chrome";
    installed: string;
    /** Firefox: whether the optional technicalAndInteraction data permission is granted. */
    allowed?: boolean;
    /** Chrome: requestUpdateCheck status, version and install type, from the service worker. */
    status?: string;
    version?: string;
    installType?: string | null;
}

interface UpdateResult {
    latest: string | null;
    source: "firefox" | "chrome-store" | "github";
    updateReady: boolean;
}

interface PendingReply {
    resolve: (data: any) => void;
    timer: ReturnType<typeof setTimeout>;
}

let updateCheck: Promise<UpdateResult | null> | null = null;
let lastUpdate: UpdateResult | null = null;
let extensionInfo: ExtensionInfo | null = null;
let bannerKind: BannerKind | null = null;
let nextRequestId = 1;
let replyListenerInstalled = false;
const pendingReplies = new Map<number, PendingReply>();

const guardGlobal: GuardGlobal = {
    safeMode: false,
    webpackSeen: () => undefined,
    fluxDispatcherFound: () => undefined
};

export function startUpdateGuard(version: string): { safeMode: boolean } {
    if (!ls || window.top !== window || !DISCORD_HOSTNAMES.has(location.hostname)) return { safeMode: false };

    const stored = readBootRecord();
    const safeMode = decideBoot(stored, version) === "safe";
    guardGlobal.safeMode = safeMode;
    (window as Window & Record<string, unknown>)[GUARD_GLOBAL] = guardGlobal;

    if (safeMode) {
        writeBootState("safe", version);
        bannerKind = "safe";
        showSafeBanner();
    } else {
        writeBootState("booting", version);
        installHealthSignals(version);
    }

    void runVersionCheck(version);
    return { safeMode };
}

function installHealthSignals(version: string): void {
    let webpackSeenAt: number | null = null;
    let fluxFound = false;
    let healthy = false;
    let observer: MutationObserver | null = null;
    let failureTimer: ReturnType<typeof setTimeout> | null = null;
    let visibilityListenerInstalled = false;
    let waitingForVisible = false;

    const stopFailureWait = () => {
        if (failureTimer !== null) {
            clearTimeout(failureTimer);
            failureTimer = null;
        }
        if (visibilityListenerInstalled) {
            document.removeEventListener("visibilitychange", restartFailureWait);
            visibilityListenerInstalled = false;
            waitingForVisible = false;
        }
    };

    const scheduleFailure = () => {
        failureTimer = setTimeout(markFailedIfDue, BOOT_FAILURE_DELAY_MS);
    };

    const restartFailureWait = () => {
        if (document.hidden) {
            if (failureTimer !== null) {
                clearTimeout(failureTimer);
                failureTimer = null;
            }
            waitingForVisible = true;
            return;
        }

        if (!waitingForVisible) return;
        waitingForVisible = false;
        if (webpackSeenAt === null || healthy) return;

        webpackSeenAt = Date.now();
        scheduleFailure();
    };

    const markHealthyIfReady = () => {
        if (healthy || !fluxFound) return;

        const appMount = document.getElementById("app-mount");
        if (!appMount?.children.length) return;

        healthy = true;
        observer?.disconnect();
        stopFailureWait();
        writeBootState("healthy", version);
    };

    const markFailedIfDue = () => {
        failureTimer = null;
        if (webpackSeenAt === null || healthy) return;

        if (!shouldFail(webpackSeenAt, Date.now(), healthy, !document.hidden)) {
            if (document.hidden && !waitingForVisible) {
                waitingForVisible = true;
            }
            return;
        }
        stopFailureWait();
        observer?.disconnect();
        writeBootState("failed", version);
        bannerKind = "failure";
        showFailureBanner();
    };

    guardGlobal.webpackSeen = () => {
        if (webpackSeenAt !== null) return;
        webpackSeenAt = Date.now();
        document.addEventListener("visibilitychange", restartFailureWait);
        visibilityListenerInstalled = true;
        if (document.hidden) waitingForVisible = true;
        scheduleFailure();
    };

    guardGlobal.fluxDispatcherFound = () => {
        fluxFound = true;
        markHealthyIfReady();
        if (observer || healthy) return;

        observer = new MutationObserver(markHealthyIfReady);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    };
}

function showSafeBanner(): void {
    showBanner({
        kind: "safe",
        message: "Discord Translator paused itself because it could not start on this version of Discord. Discord is running without it.",
        updateAction: makeUpdateAction(),
        actions: [{
            label: "Try again",
            onClick: () => {
                writeBootState("retry", VERSION);
                location.reload();
            }
        }]
    });
}

function showFailureBanner(): void {
    showBanner({
        kind: "failure",
        message: "Discord Translator could not start on this version of Discord.",
        updateAction: makeUpdateAction(),
        actions: [{
            label: "Reload without it",
            onClick: () => {
                writeBootState("failed", VERSION);
                location.reload();
            }
        }]
    });
    if (lastUpdate) applyGuardBannerUpdate(lastUpdate);
    void runVersionCheck(VERSION);
}

async function runVersionCheck(version: string): Promise<void> {
    const result = await getUpdateResult(version);
    if (!result) return;

    if (bannerKind === "safe" || bannerKind === "failure") {
        applyGuardBannerUpdate(result);
        return;
    }

    if (!result.updateReady || !result.latest || isDismissed(readDismissed(), result.latest, Date.now())) return;

    const label = result.source === "chrome-store" ? "Update now" : "Update";
    showBanner({
        kind: "update",
        message: `Discord Translator ${result.latest} is ${result.source === "chrome-store" ? "ready" : "available"}.`,
        updateAction: { label, onClick: () => performUpdate(result) },
        onDismiss: () => writeDismissed(result.latest!)
    });
}

function applyGuardBannerUpdate(result: UpdateResult): void {
    if (!result.latest || !result.updateReady) return;
    updateBanner({
        detail: `Version ${result.latest} is available.`,
        updateAction: makeUpdateAction(result)
    });
}

function makeUpdateAction(result?: UpdateResult) {
    const button = getUpdateButton(result?.source ?? "github", result?.updateReady === true);
    return {
        label: button === "reload" ? "Update now" : "Update",
        onClick: () => performUpdate(result)
    };
}

async function performUpdate(result?: UpdateResult | null): Promise<void> {
    const current = result ?? lastUpdate ?? await getUpdateResult(VERSION);
    if (current && getUpdateButton(current.source, current.updateReady) === "reload") {
        // The service worker restarts the extension only if IT saw the update arrive. If it was
        // stopped and restarted since, it no longer knows, and Chrome applies the update on the
        // next browser start instead.
        const reply = await askExtension(UPDATE_RELOAD_REQUEST, {}, RELOAD_TIMEOUT_MS);
        if (reply?.reloaded === false) {
            updateBanner({ detail: "Restart your browser to finish the update." });
            return;
        }
        // reloaded === true, or no reply because the extension is already restarting.
        setTimeout(() => location.reload(), 2_500);
        return;
    }

    const browser = current ? (current.source === "firefox" ? "firefox" : "chrome") : extensionInfo?.browser;
    if (!browser) return;
    openLink(browser === "firefox" ? FIREFOX_STORE_URL : CHROME_STORE_URL);
}

async function getUpdateResult(version: string): Promise<UpdateResult | null> {
    if (updateCheck) return updateCheck;

    updateCheck = getUpdateResultOnce(version).then(result => {
        lastUpdate = result;
        return result;
    });
    return updateCheck;
}

async function getUpdateResultOnce(version: string): Promise<UpdateResult | null> {
    const cached = readCache();
    const due = isCheckDue(cached, Date.now());

    // A probe only asks the content script who we are (no network); a full check also runs the
    // per-browser gate: the Firefox data permission, or Chrome's own update check.
    const info = parseExtensionInfo(await askExtension(UPDATE_CHECK_REQUEST, { probe: !due }, UPDATE_TIMEOUT_MS));
    if (!info) return null; // no answer from our own content script: never guess, never fetch
    extensionInfo = info;

    if (!due) return cached ? makeResult(cached.source, cached.latest, info.installed) : null;

    if (info.browser === "firefox") {
        if (info.allowed !== true) return null;

        const latest = await fetchFirefoxVersion();
        saveCache({ checkedAt: Date.now(), latest, source: "firefox" });
        return makeResult("firefox", latest, info.installed);
    }

    const source = getUpdateSource(false, info.installType ?? null);
    if (source === "chrome-store" && info.status === "update_available") {
        const latest = info.version ?? "newer version";
        saveCache({ checkedAt: Date.now(), latest, source: "chrome-store" });
        return makeResult("chrome-store", latest, info.installed, true);
    }

    if (source === "github") {
        const latest = await fetchGithubVersion();
        saveCache({ checkedAt: Date.now(), latest, source: "github" });
        return makeResult("github", latest, info.installed);
    }

    saveCache({ checkedAt: Date.now(), latest: null, source: "chrome-store" });
    return makeResult("chrome-store", null, info.installed);
}

function makeResult(source: UpdateResult["source"], latest: string | null, installed: string, updateReady = false): UpdateResult {
    return {
        source,
        latest,
        updateReady: updateReady || isVersionNewer(latest, installed)
    };
}

function parseExtensionInfo(data: any): ExtensionInfo | null {
    const response = data?.response;
    if (response?.browser !== "firefox" && response?.browser !== "chrome") return null;
    return {
        browser: response.browser,
        installed: typeof response.installed === "string" ? response.installed : VERSION,
        allowed: response.allowed === true,
        status: typeof response.status === "string" ? response.status : undefined,
        version: typeof response.version === "string" ? response.version : undefined,
        installType: typeof response.installType === "string" ? response.installType : null
    };
}

async function fetchFirefoxVersion(): Promise<string | null> {
    try {
        const response = await fetch(AMO_VERSION_URL);
        if (response.status !== 200) return null;
        const data = await response.json() as { current_version?: { version?: unknown } };
        return typeof data.current_version?.version === "string" ? data.current_version.version : null;
    } catch {
        return null;
    }
}

async function fetchGithubVersion(): Promise<string | null> {
    try {
        const response = await fetch(GITHUB_VERSION_URL);
        if (response.status !== 200) return null;
        const data = await response.json() as { tag_name?: unknown };
        if (typeof data.tag_name !== "string") return null;
        return data.tag_name.replace(/^v/, "");
    } catch {
        return null;
    }
}

function installReplyListener(): void {
    if (replyListenerInstalled) return;
    replyListenerInstalled = true;
    window.addEventListener("message", event => {
        const type = event.data?.type;
        if (event.source !== window || (type !== UPDATE_CHECK_RESULT && type !== UPDATE_RELOAD_RESULT)) return;
        const pending = pendingReplies.get(event.data.id);
        if (!pending) return;
        pendingReplies.delete(event.data.id);
        clearTimeout(pending.timer);
        pending.resolve(event.data);
    });
}

/** Ask our content script and wait for its reply; null on timeout or if the relay is gone. */
function askExtension(type: string, extra: Record<string, unknown>, timeoutMs: number): Promise<any | null> {
    installReplyListener();
    const id = nextRequestId++;
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            pendingReplies.delete(id);
            resolve(null);
        }, timeoutMs);
        pendingReplies.set(id, { resolve, timer });
        try {
            window.postMessage({ ...extra, type, id }, window.location.origin);
        } catch {
            clearTimeout(timer);
            pendingReplies.delete(id);
            resolve(null);
        }
    });
}

function readBootRecord(): import("./updateGuardCore").BootRecord | null {
    try {
        const raw = ls?.getItem(BOOT_GUARD_KEY);
        if (!raw) return null;
        const record = JSON.parse(raw) as Partial<import("./updateGuardCore").BootRecord>;
        if (typeof record.version !== "string" || typeof record.at !== "number") return null;
        if (!["booting", "healthy", "failed", "safe", "retry"].includes(record.state ?? "")) return null;
        return record as import("./updateGuardCore").BootRecord;
    } catch {
        return null;
    }
}

function writeBootState(state: import("./updateGuardCore").BootState, version: string): void {
    try {
        ls?.setItem(BOOT_GUARD_KEY, JSON.stringify({ state, version, at: Date.now() }));
    } catch {
        // Storage failures leave the normal boot path untouched.
    }
}

function readCache(): import("./updateGuardCore").UpdateCache | null {
    try {
        const raw = ls?.getItem(UPDATE_CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw) as Partial<import("./updateGuardCore").UpdateCache>;
        if (typeof cache.checkedAt !== "number" || (cache.latest !== null && typeof cache.latest !== "string")) return null;
        if (!["firefox", "chrome-store", "github"].includes(cache.source ?? "")) return null;
        return cache as import("./updateGuardCore").UpdateCache;
    } catch {
        return null;
    }
}

function saveCache(cache: import("./updateGuardCore").UpdateCache): void {
    try {
        ls?.setItem(UPDATE_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // An unavailable cache only forfeits throttling; it does not affect boot.
    }
}

function readDismissed(): import("./updateGuardCore").DismissedUpdate | null {
    try {
        const raw = ls?.getItem(UPDATE_DISMISS_KEY);
        if (!raw) return null;
        const dismissed = JSON.parse(raw) as Partial<import("./updateGuardCore").DismissedUpdate>;
        return typeof dismissed.latest === "string" && typeof dismissed.dismissedAt === "number"
            ? dismissed as import("./updateGuardCore").DismissedUpdate
            : null;
    } catch {
        return null;
    }
}

function writeDismissed(latest: string): void {
    try {
        ls?.setItem(UPDATE_DISMISS_KEY, JSON.stringify({ latest, dismissedAt: Date.now() }));
    } catch {
        // Dismissal is best effort and never blocks the banner or boot.
    }
}
