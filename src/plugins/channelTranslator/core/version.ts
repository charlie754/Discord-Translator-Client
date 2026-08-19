/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Semver-ish comparison, deliberately minimal: our versions are always
 * MAJOR.MINOR.PATCH with no pre-release tags.
 */

function parts(v: string): number[] {
    return v.split(".").map(p => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
}

/** True when `remote` is strictly newer than `local`. Never throws. */
export function isNewer(remote: string, local: string): boolean {
    if (typeof remote !== "string" || typeof local !== "string") return false;
    const a = parts(remote);
    const b = parts(local);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

/** Parse a remote package.json body and return its version, or null. */
export function versionFromPackageJson(body: string): string | null {
    try {
        const parsed = JSON.parse(body);
        const v = parsed?.version;
        return typeof v === "string" ? v : null;
    } catch {
        return null;
    }
}
