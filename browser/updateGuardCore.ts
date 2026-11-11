/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const BOOT_GUARD_KEY = "discordTranslator:bootGuard";
export const UPDATE_STORAGE_PREFIX = "discordTranslator:update:";
export const UPDATE_CACHE_KEY = `${UPDATE_STORAGE_PREFIX}cache`;
export const UPDATE_DISMISS_KEY = `${UPDATE_STORAGE_PREFIX}dismissed`;

export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/discord-translator-web/jlofhkaokcnpkkhnalkldnnpilghjgaa";
export const FIREFOX_STORE_URL = "https://addons.mozilla.org/en-US/firefox/addon/discord-translator/";
// The version-check URLs live in browser/content.js: the request is made there, in the isolated world.

export const UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const UPDATE_DISMISS_MS = 24 * 60 * 60 * 1000;
export const BOOT_FAILURE_DELAY_MS = 8_000;

export type BootState = "booting" | "healthy" | "failed" | "safe" | "retry";

export interface BootRecord {
    state: BootState;
    version: string;
    at: number;
}

export interface UpdateCache {
    checkedAt: number;
    latest: string | null;
    source: UpdateSource;
}

export interface DismissedUpdate {
    latest: string;
    dismissedAt: number;
}

export type UpdateSource = "firefox" | "chrome-store" | "github";
export type UpdateButton = "reload" | "open-store";

export function decideBoot(record: BootRecord | null, version: string): "normal" | "safe" {
    return record?.version === version && (record.state === "failed" || record.state === "safe")
        ? "safe"
        : "normal";
}

export function shouldFail(webpackSeenAt: number | null, now: number, healthy: boolean, visible: boolean): boolean {
    return webpackSeenAt !== null && !healthy && visible && now - webpackSeenAt >= BOOT_FAILURE_DELAY_MS;
}

export function compareVersions(left: string, right: string): number {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return 0;

    const length = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < length; i++) {
        const difference = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
        if (difference !== 0) return difference > 0 ? 1 : -1;
    }

    return 0;
}

export function isVersionNewer(latest: string | null, installed: string): boolean {
    return latest !== null && compareVersions(latest, installed) > 0;
}

export function getUpdateSource(isFirefox: boolean, installType: string | null): UpdateSource {
    if (isFirefox) return "firefox";
    return installType === "normal" ? "chrome-store" : "github";
}

export function getUpdateButton(source: UpdateSource, updateReady: boolean): UpdateButton {
    return source === "chrome-store" && updateReady ? "reload" : "open-store";
}

export function isCheckDue(cache: UpdateCache | null, now: number): boolean {
    return cache === null || now < cache.checkedAt || now - cache.checkedAt >= UPDATE_INTERVAL_MS;
}

export function isDismissed(dismissed: DismissedUpdate | null, latest: string, now: number): boolean {
    return dismissed?.latest === latest
        && now >= dismissed.dismissedAt
        && now - dismissed.dismissedAt < UPDATE_DISMISS_MS;
}

function parseVersion(version: string): number[] | null {
    if (!/^\d+(?:\.\d+)*$/.test(version)) return null;
    return version.split(".").map(Number);
}
