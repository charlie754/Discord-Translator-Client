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
