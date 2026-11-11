/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BOOT_FAILURE_DELAY_MS, BOOT_GUARD_KEY, CHROME_STORE_URL, FIREFOX_STORE_URL, GITHUB_VERSION_URL, AMO_VERSION_URL, UPDATE_CACHE_KEY, UPDATE_DISMISS_KEY, decideBoot, getUpdateButton, getUpdateSource, isCheckDue, isDismissed, isVersionNewer, shouldFail } from "./updateGuardCore";
import { BannerKind, openLink, showBanner, updateBanner } from "./updateBanner";

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
const UPDATE_TIMEOUT_MS = 5_000;

interface GuardGlobal {
    safeMode: boolean;
    webpackSeen: () => void;
    fluxDispatcherFound: () => void;
}

interface MetaResult {
    isFirefox: boolean;
    installed: string;
}

interface ChromeCheckResult {
    status: string;
    version?: string;
    installType?: string | null;
}

interface UpdateResult {
    latest: string | null;
    source: "firefox" | "chrome-store" | "github";
    updateReady: boolean;
    isFirefox: boolean;
}

interface PendingUpdateRequest {
    resolve: (result: ChromeCheckResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

let updateCheck: Promise<UpdateResult | null> | null = null;
let lastUpdate: UpdateResult | null = null;
let bannerKind: BannerKind | null = null;
let nextRequestId = 1;
let updateListenerInstalled = false;
const pendingUpdateRequests = new Map<number, PendingUpdateRequest>();

const guardGlobal: GuardGlobal = {
    safeMode: false,
    webpackSeen: () => undefined,
    fluxDispatcherFound: () => undefined
};

export function startUpdateGuard(version: string): { safeMode: boolean } {
    if (!ls || window.top !== window) return { safeMode: false };

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

    const markHealthyIfReady = () => {
        if (healthy || !fluxFound) return;

        const appMount = document.getElementById("app-mount");
        if (!appMount?.children.length) return;

        healthy = true;
        observer?.disconnect();
        writeBootState("healthy", version);
    };

    const markFailedIfDue = () => {
        if (webpackSeenAt === null || healthy) return;

        if (!shouldFail(webpackSeenAt, Date.now(), healthy)) return;
        observer?.disconnect();
        writeBootState("failed", version);
        bannerKind = "failure";
        showFailureBanner();
    };

    guardGlobal.webpackSeen = () => {
        if (webpackSeenAt !== null) return;
        webpackSeenAt = Date.now();
        setTimeout(markFailedIfDue, BOOT_FAILURE_DELAY_MS);
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
        try {
            window.postMessage({ type: UPDATE_RELOAD_REQUEST, id: nextRequestId++ }, window.location.origin);
        } catch {
            // The store URL is the recovery path if the page relay is gone.
            openLink(CHROME_STORE_URL);
        }
        setTimeout(() => location.reload(), 2_500);
        return;
    }

    const meta = await getMeta();
    const source = current?.source ?? getUpdateSource(meta.isFirefox, null);
    openLink(source === "firefox" ? FIREFOX_STORE_URL : CHROME_STORE_URL);
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
    const meta = await getMeta();
    const cached = readCache();
    if (!isCheckDue(cached, Date.now())) {
        if (!cached) return null;
        return makeResult(cached.source, cached.latest, meta);
    }

    if (meta.isFirefox) {
        let granted = false;
        try {
            const { goatBannerGateFromExtension } = require("./translationBridge") as typeof import("./translationBridge");
            granted = await goatBannerGateFromExtension();
        } catch {
            granted = false;
        }
        if (!granted) return null;

        const latest = await fetchFirefoxVersion();
        saveCache({ checkedAt: Date.now(), latest, source: "firefox" });
        return makeResult("firefox", latest, meta);
    }

    const chrome = await requestChromeUpdateCheck();
    const source = getUpdateSource(false, chrome.installType ?? null);
    if (source === "chrome-store" && chrome.status === "update_available") {
        const latest = chrome.version ?? "newer version";
        saveCache({ checkedAt: Date.now(), latest, source: "chrome-store" });
        return makeResult("chrome-store", latest, meta, true);
    }

    if (source === "github") {
        const latest = await fetchGithubVersion();
        saveCache({ checkedAt: Date.now(), latest, source: "github" });
        return makeResult("github", latest, meta);
    }

    saveCache({ checkedAt: Date.now(), latest: null, source: "chrome-store" });
    return makeResult("chrome-store", null, meta);
}

function makeResult(source: UpdateResult["source"], latest: string | null, meta: MetaResult, updateReady = false): UpdateResult {
    return {
        source,
        latest,
        isFirefox: meta.isFirefox,
        updateReady: updateReady || isVersionNewer(latest, meta.installed)
    };
}

async function getMeta(): Promise<MetaResult> {
    try {
        const metadata = require("../src/utils/web-metadata") as typeof import("../src/utils/web-metadata");
        await Promise.race([
            metadata.metaReady,
            new Promise<void>(resolve => setTimeout(resolve, UPDATE_TIMEOUT_MS))
        ]);
        return {
            isFirefox: metadata.IS_FIREFOX === true,
            installed: typeof metadata.EXTENSION_VERSION === "string" ? metadata.EXTENSION_VERSION : VERSION
        };
    } catch {
        return { isFirefox: false, installed: VERSION };
    }
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

function installUpdateListener(): void {
    if (updateListenerInstalled) return;
    updateListenerInstalled = true;
    window.addEventListener("message", event => {
        if (event.source !== window || event.data?.type !== UPDATE_CHECK_RESULT) return;
        const pending = pendingUpdateRequests.get(event.data.id);
        if (!pending) return;
        pendingUpdateRequests.delete(event.data.id);
        clearTimeout(pending.timer);
        const response = event.data.response;
        pending.resolve({
            status: typeof response?.status === "string" ? response.status : "error",
            version: typeof response?.version === "string" ? response.version : undefined,
            installType: typeof response?.installType === "string" ? response.installType : null
        });
    });
}

function requestChromeUpdateCheck(): Promise<ChromeCheckResult> {
    installUpdateListener();
    const id = nextRequestId++;
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            pendingUpdateRequests.delete(id);
            resolve({ status: "error" });
        }, UPDATE_TIMEOUT_MS);
        pendingUpdateRequests.set(id, { resolve, timer });
        try {
            window.postMessage({ type: UPDATE_CHECK_REQUEST, id }, window.location.origin);
        } catch {
            clearTimeout(timer);
            pendingUpdateRequests.delete(id);
            resolve({ status: "error" });
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
