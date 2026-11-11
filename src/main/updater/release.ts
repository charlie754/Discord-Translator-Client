/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const RELEASE_SHA = /([0-9a-f]{40})$/i;

export function getComparePath(gitHash: string, releaseSha: string) {
    return `/compare/${gitHash}...${releaseSha}`;
}

export function getReleaseInfo(gitHash: string, releaseName: string) {
    const sha = releaseName.match(RELEASE_SHA)?.[1];
    if (!sha) return null;

    return {
        sha,
        comparePath: getComparePath(gitHash, sha),
        isCurrent: sha.toLowerCase() === gitHash.toLowerCase()
    };
}

/** The download must be one of this repository's own release assets - nothing the API names elsewhere. */
export function isReleaseAssetUrl(url: unknown, repo: string): url is string {
    if (typeof url !== "string") return false;
    try {
        // Parsed, so "../" segments and look-alike hosts are normalised before the comparison.
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.host === "github.com"
            && parsed.pathname.startsWith(`/${repo}/releases/download/`);
    } catch {
        return false;
    }
}

/**
 * Whether `data` is a complete asar archive of the size GitHub announced for the asset.
 *
 * Checked BEFORE the bytes overwrite the installed archive: Discord's startup stub require()s that
 * file, so a truncated download or an error page written over it would stop Discord from starting at
 * all, not just the mod. Layout (Chromium Pickle): UInt32LE 4, header size, payload size, JSON length,
 * then the JSON file table.
 */
export function isCompleteAsar(data: Uint8Array, expectedSize: unknown): boolean {
    if (typeof expectedSize !== "number" || data.byteLength !== expectedSize || data.byteLength < 16) return false;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(0, true) !== 4) return false;

    const jsonLength = view.getUint32(12, true);
    if (jsonLength === 0 || 16 + jsonLength > data.byteLength) return false;

    try {
        const header = JSON.parse(new TextDecoder().decode(data.subarray(16, 16 + jsonLength)));
        return typeof header?.files === "object" && header.files !== null;
    } catch {
        return false;
    }
}
