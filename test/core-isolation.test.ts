/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(process.cwd(), "src", "plugins", "channelTranslator", "core");

/** Files that must be present. If the layout moves, the scan must fail loudly, not silently. */
const EXPECTED_CORE_FILES = [
    "cache.ts", "detect.ts", "hash.ts", "modes.ts",
    "protect.ts", "scheduler.ts", "types.ts", "version.ts"
];

const FORBIDDEN = [
    "@webpack", "@api", "@components", "@utils", "@shared",
    "discord-types", "react", "@equicordplugins", "@plugins"
];

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** The exact set the isolation assertion iterates over. Anything else is a different measurement. */
function scannedFiles(): string[] {
    return walk(CORE).filter(f => f.endsWith(".ts"));
}

describe("core isolation", () => {
    it("the core directory it claims to scan actually exists", () => {
        expect(existsSync(CORE), `core directory not found at ${CORE}`).toBe(true);
    });

    it("scans a non-empty set of .ts files — a zero-file scan is a failure, not a pass", () => {
        const files = scannedFiles();
        expect(files.length, `no .ts files found under ${CORE}`).toBeGreaterThan(0);
        // Guard against a partial or wrong directory being scanned.
        expect(files.length).toBeGreaterThanOrEqual(EXPECTED_CORE_FILES.length);
    });

    it("scans every file the core is known to contain", () => {
        const names = new Set(scannedFiles().map(f => basename(f)));
        const missing = EXPECTED_CORE_FILES.filter(f => !names.has(f));
        expect(missing, `expected core files were not scanned: ${missing.join(", ")}`).toEqual([]);
    });

    it("no core file imports anything Discord-related", () => {
        const files = scannedFiles();
        expect(files.length).toBeGreaterThan(0);
        const offenders: string[] = [];
        for (const file of files) {
            const src = readFileSync(file, "utf8");
            for (const bad of FORBIDDEN) {
                if (new RegExp(`from\\s+["'][^"']*${bad}`).test(src)) {
                    offenders.push(`${file} imports ${bad}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("detects a violation when one exists (positive control)", () => {
        const fake = `import { Foo } from "@webpack/common";`;
        const hit = FORBIDDEN.some(bad => new RegExp(`from\\s+["'][^"']*${bad}`).test(fake));
        expect(hit).toBe(true);
    });
});
