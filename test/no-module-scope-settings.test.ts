/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against the bug that took down the entire mod in a live client:
 *
 *   Uncaught Error: Cannot access settings before plugin is initialized
 *       at get store (Settings.ts:359)
 *       at state.ts:21
 *       at import-plugins:~plugins:379
 *
 * Reading `settings.store` in a module-level initializer throws during module
 * evaluation. Because every plugin is imported into one `~plugins` module, that
 * throw does not just disable this plugin — it kills all of them, leaves
 * `Vencord.Api` undefined, and removes Equicord from Discord's settings
 * entirely. One line, whole mod.
 *
 * Settings may only be read inside a function body, which runs after start().
 *
 * Nothing else in the suite can catch this: it typechecks, it builds, and it
 * only fails inside a real client. Hence a static guard.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");

/**
 * Files that must be in the scanned set. `state.ts` is where the crash happened
 * and `settings.ts` is where the settings object is defined — if either drops
 * out of the scan, the guard is measuring nothing and must go red.
 */
const EXPECTED_SCANNED = ["state.ts", "settings.ts", "index.tsx"];

/** `export const x = ... settings.store ...` at column 0 — i.e. module scope. */
const MODULE_SCOPE_SETTINGS = /^(?:export\s+)?(?:const|let|var)\s+[^\n]*settings\.store/m;

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

function sourceFiles(): string[] {
    return walk(PLUGIN).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
}

describe("no module-scope settings access", () => {
    it("the plugin directory it claims to scan actually exists", () => {
        expect(existsSync(PLUGIN), `plugin directory not found at ${PLUGIN}`).toBe(true);
    });

    it("scans a non-empty set of source files — a zero-file scan is a failure, not a pass", () => {
        const files = sourceFiles();
        expect(files.length, `no .ts/.tsx files found under ${PLUGIN}`).toBeGreaterThan(0);
        expect(files.length).toBeGreaterThanOrEqual(EXPECTED_SCANNED.length);
    });

    it("scans the files the guard exists to protect", () => {
        const names = new Set(sourceFiles().map(f => basename(f)));
        const missing = EXPECTED_SCANNED.filter(f => !names.has(f));
        expect(missing, `guarded files were not scanned: ${missing.join(", ")}`).toEqual([]);
    });

    it("no plugin file reads settings.store at module scope", () => {
        const files = sourceFiles();
        expect(files.length).toBeGreaterThan(0);
        const offenders = files.filter(file =>
            MODULE_SCOPE_SETTINGS.test(readFileSync(file, "utf8"))
        );
        expect(offenders).toEqual([]);
    });

    it("detects the real regression when it is reintroduced (positive control)", () => {
        // Verbatim shape of the line that crashed the client.
        const reintroduced =
            'export const cache = TranslationCache.deserialise(settings.store.cacheBlob, 5000);';
        expect(MODULE_SCOPE_SETTINGS.test(reintroduced)).toBe(true);
    });

    it("does not flag settings.store read inside a function body", () => {
        const legitimate = [
            "export function hydrate(): void {",
            "    cache.loadFrom(settings.store.cacheBlob);",
            "}"
        ].join("\n");
        expect(MODULE_SCOPE_SETTINGS.test(legitimate)).toBe(false);
    });
});
