/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE DEFECT THIS FILE EXISTS TO PREVENT: A VERSION NUMBER THAT LIES.
 *
 * The Discord Translator settings tab now prints the build it is running —
 * `Version 0.2.9 (a81a554)` — so the operator can compare it against what the
 * installer's GUI shows. That line is only worth having if it is IMPOSSIBLE for
 * it to go stale. The failure mode is not hypothetical and it is silent: someone
 * types the current version as a string literal, the release after that bumps
 * package.json, and the settings tab confidently reports the old number forever.
 * Nothing crashes, no test that merely checks "a version is rendered" goes red,
 * and the one person relying on the line is the person it misleads.
 *
 * So the assertions below are not "does it render a version". They are "does it
 * render the BUILD-TIME CONSTANT, and is there provably no literal".
 *
 * WHY THIS READS SOURCE TEXT RATHER THAN RENDERING. The tab is TSX and resolves
 * Vencord build aliases (@api/Settings, @webpack/common, @plugins/*, ~git-hash)
 * that do not exist under vitest, and `VERSION` is an esbuild `define` that only
 * exists inside a bundle. Static reading is the only way to assert on this file
 * from this suite at all — the same reason test/vencordTabApiKeyRow.test.ts,
 * test/settingsCopy.test.ts and test/buildBanner.test.ts read source.
 *
 * A NOTE ON THE MECHANISM, BECAUSE THE OBVIOUS GUESS IS WRONG. `VERSION` needs
 * no `~version` virtual module and no new esbuild plugin: it is ALREADY a global
 * define in every renderer build target (`defines` in scripts/build/build.mjs,
 * `commonOptions.define` in scripts/build/buildWeb.mjs), declared for TypeScript
 * at src/globals.d.ts. The third describe block below is what keeps that true —
 * a build target that stopped defining VERSION would compile the tab into a
 * bundle with a free variable, and only the artifact would show it.
 *
 * tsconfig.json does NOT cover test/, so `tsc --noEmit` never typechecks this
 * file. Everything here is asserted at runtime by vitest and nowhere else.
 */

const REPO = process.cwd();
const TAB = join(REPO, "src", "components", "settings", "tabs", "vencord", "index.tsx");
const PACKAGE_JSON = join(REPO, "package.json");
const BUILD_MJS = join(REPO, "scripts", "build", "build.mjs");
const BUILD_WEB_MJS = join(REPO, "scripts", "build", "buildWeb.mjs");
const COMMON_MJS = join(REPO, "scripts", "build", "common.mjs");
const GLOBALS_DTS = join(REPO, "src", "globals.d.ts");

function read(path: string): string {
    if (!existsSync(path)) throw new Error(`missing file: ${path}`);
    return readFileSync(path, "utf8");
}

/** The version the shipped build will actually carry. */
const packageVersion: string = JSON.parse(read(PACKAGE_JSON)).version;

/**
 * The tab with every block comment removed.
 *
 * THIS IS THE INSTRUMENT, AND IT IS THE WHOLE REASON THE LITERAL CHECK MEANS
 * ANYTHING. The doc comment above BuildIdentity() explains the format by quoting
 * the example string `0.2.9 (a81a554)`. A naive `expect(src).not.toContain(...)`
 * would match that prose and fail on a correct file — and the obvious "fix",
 * deleting the assertion, is exactly how this guard would be lost. Stripping
 * comments first means the assertion only ever sees code.
 *
 * Line comments are stripped too, but only after block comments, so a `//`
 * inside a URL in a block comment cannot swallow the rest of a line of code.
 */
function strippedTabSource(): string {
    return read(TAB)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * The body of the exported tab component, so "is it mounted" can be asked
 * separately from "does it exist".
 *
 * FOUND BY MUTATION, NOT BY DESIGN. Every other assertion in this file scans the
 * whole file, and an earlier draft of it passed 25/25 against a mutant that
 * deleted `<BuildIdentity />` from the tab body while leaving the component
 * defined above it. That is the exact "presence is not end-to-end" failure: the
 * code is all there, it compiles, it lints, and the user sees nothing. The
 * assertion below is the only one in this file that would have caught it.
 */
function equicordSettingsBody(): string {
    const src = strippedTabSource();
    const start = src.indexOf("function EquicordSettings()");
    if (start === -1) throw new Error("could not locate function EquicordSettings() in the tab");
    const end = src.indexOf("\n}", start);
    if (end === -1) throw new Error("could not locate the end of EquicordSettings()");
    return src.slice(start, end);
}

describe("settings tab build identity — the version reaches the screen", () => {
    it("is actually MOUNTED in the tab, not merely defined above it", () => {
        expect(equicordSettingsBody()).toMatch(/<BuildIdentity\s*\/>/);
    });

    it("CONTROL: the body slice really is a slice, and really is the tab body", () => {
        const body = equicordSettingsBody();
        expect(body.length).toBeLessThan(strippedTabSource().length);
        expect(body).toContain("Quick Actions");
        // It must NOT contain the component's own definition, or the assertion
        // above would pass on an unmounted component again.
        expect(body).not.toContain("function BuildIdentity");
    });

    it("sits above Quick Actions, where someone asking 'what am I running' looks first", () => {
        const body = equicordSettingsBody();
        expect(body.indexOf("<BuildIdentity")).toBeLessThan(body.indexOf("Quick Actions"));
    });

    it("renders the VERSION build-time global", () => {
        expect(strippedTabSource()).toMatch(/\$\{VERSION\}/);
    });

    it("renders the git hash beside it, sliced to the installer's seven characters", () => {
        expect(strippedTabSource()).toMatch(/\$\{gitHash\.slice\(0, 7\)\}/);
    });

    it("imports gitHash from the shared user-agent module rather than re-deriving it", () => {
        expect(strippedTabSource()).toMatch(
            /import \{[^}]*\bgitHash\b[^}]*\} from "@shared\/vencordUserAgent";/
        );
    });

    it("emits the installer's own `<semver> (<hash>)` shape, so the two are comparable by eye", () => {
        // The parens and the single space between the two constants ARE the
        // contract with the installer GUI. A format drift here does not break
        // anything, it just makes the comparison the operator asked for stop
        // being a comparison.
        expect(strippedTabSource()).toMatch(/\$\{VERSION\} \(\$\{gitHash\.slice\(0, 7\)\}\)/);
    });

    it("is selectable, so the string can be copied into a bug report", () => {
        // BaseText's own prop (.vc-text-selectable -> user-select: text).
        expect(strippedTabSource()).toMatch(/\n\s*selectable\n/);
    });

    it("names the two builds whose bare version number would mislead", () => {
        const src = strippedTabSource();
        expect(src).toContain("Dev Build");
        expect(src).toContain("Local Build");
        expect(src).toMatch(/\bIS_DEV\b/);
        expect(src).toMatch(/\bIS_STANDALONE\b/);
    });
});

describe("settings tab build identity — and it CANNOT be a literal", () => {
    it("carries no copy of package.json's version anywhere in its code", () => {
        // THE ASSERTION THAT MATTERS MOST. A hardcoded "0.2.9" would satisfy a
        // human reading the screen today and be wrong at the next release.
        expect(strippedTabSource()).not.toContain(packageVersion);
    });

    it("carries no bare semver string literal at all", () => {
        // Broader than the check above: catches someone pinning a DIFFERENT
        // version by hand, which package.json's current value would not match.
        const literals = strippedTabSource().match(/["'`]\d+\.\d+\.\d+["'`]/g) ?? [];
        expect(literals).toEqual([]);
    });

    it("carries no hardcoded 7-or-more-character hex hash literal", () => {
        const literals = strippedTabSource().match(/["'`][0-9a-f]{7,40}["'`]/g) ?? [];
        expect(literals).toEqual([]);
    });

    // ---- INSTRUMENT CONTROLS -------------------------------------------------
    // The three assertions above are all NEGATIVE. A negative assertion on a
    // broken matcher passes forever and reports nothing. These two prove the
    // matchers can actually see what they claim to look for.

    it("POSITIVE CONTROL: the literal matchers do fire on text that contains a literal", () => {
        const mutant = `const v = "${packageVersion}"; const h = "a81a554";`;
        expect(mutant).toContain(packageVersion);
        expect(mutant.match(/["'`]\d+\.\d+\.\d+["'`]/g) ?? []).toHaveLength(1);
        expect(mutant.match(/["'`][0-9a-f]{7,40}["'`]/g) ?? []).toHaveLength(1);
    });

    it("NEGATIVE CONTROL: they do not fire on the interpolated form the tab uses", () => {
        const good = "`Version ${VERSION} (${gitHash.slice(0, 7)})`";
        expect(good).not.toContain(packageVersion);
        expect(good.match(/["'`]\d+\.\d+\.\d+["'`]/g) ?? []).toEqual([]);
        expect(good.match(/["'`][0-9a-f]{7,40}["'`]/g) ?? []).toEqual([]);
    });

    it("CONTROL: the comment stripper removes prose without removing code", () => {
        const sample = "/* version 9.9.9 here */\nconst x = VERSION; // 8.8.8\n";
        const stripped = sample
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^[ \t]*\/\/.*$/gm, "");
        expect(stripped).not.toContain("9.9.9");
        expect(stripped).toContain("VERSION");
    });

    it("CONTROL: the stripper is actually doing work on the real file", () => {
        // If TAB ever stopped having block comments, the literal assertions
        // would be trivially satisfiable and this control would say so.
        expect(read(TAB).length).toBeGreaterThan(strippedTabSource().length);
        // And the doc comment's example string is present in the raw file but
        // gone from the stripped one — i.e. the strip is what makes the negative
        // assertions honest rather than lucky.
        expect(read(TAB)).toContain("0.2.9 (a81a554)");
        expect(strippedTabSource()).not.toContain("0.2.9 (a81a554)");
    });
});

describe("every renderer build target defines VERSION", () => {
    /*
     * The tab compiles against a GLOBAL. If a build target's `define` map ever
     * drops VERSION, esbuild leaves the identifier alone and the settings tab
     * throws a ReferenceError at render time — in that target only. The desktop
     * build would be fine and the browser extension would be broken, or the
     * reverse. Source review cannot see it; this can.
     *
     * This is the check that replaces "every gitHashPlugin registration site
     * also registers the version plugin". There is no version plugin, because
     * VERSION was already a define; and there is exactly ONE gitHashPlugin
     * registration site — commonOpts.plugins in common.mjs, which both build
     * scripts spread. The last `it` below pins that count so this reasoning
     * cannot silently stop being true.
     */

    const targets: [string, string][] = [
        ["scripts/build/build.mjs", BUILD_MJS],
        ["scripts/build/buildWeb.mjs", BUILD_WEB_MJS]
    ];

    for (const [label, path] of targets) {
        it(`${label} imports VERSION from common.mjs`, () => {
            expect(read(path)).toMatch(/import \{[^}]*\bVERSION\b[^}]*\} from "\.\/common\.mjs"/);
        });

        it(`${label} puts VERSION into a stringifyValues define block`, () => {
            const src = read(path);
            const blocks = src.match(/stringifyValues\(\{[\s\S]*?\}\)/g) ?? [];
            expect(blocks.length).toBeGreaterThan(0);
            expect(blocks.some(b => /^\s*VERSION,?\s*$/m.test(b))).toBe(true);
        });

        it(`${label} puts BUILD_TIMESTAMP into the same define block`, () => {
            // The dev-build line renders a date from it; a build target that
            // defines VERSION but not BUILD_TIMESTAMP breaks dev builds only.
            const blocks = read(path).match(/stringifyValues\(\{[\s\S]*?\}\)/g) ?? [];
            expect(blocks.some(b => /^\s*BUILD_TIMESTAMP,?\s*$/m.test(b))).toBe(true);
        });

        it(`${label} defines IS_DEV and IS_STANDALONE, which the line branches on`, () => {
            const blocks = read(path).match(/stringifyValues\(\{[\s\S]*?\}\)/g) ?? [];
            expect(blocks.some(b => /^\s*IS_DEV,?\s*$/m.test(b))).toBe(true);
            expect(blocks.some(b => /^\s*IS_STANDALONE(:.*)?,?\s*$/m.test(b))).toBe(true);
        });
    }

    it("NEGATIVE CONTROL: the define-block matcher rejects a block without VERSION", () => {
        const mutant = "stringifyValues({\n    IS_DEV,\n    BUILD_TIMESTAMP\n})";
        const blocks = mutant.match(/stringifyValues\(\{[\s\S]*?\}\)/g) ?? [];
        expect(blocks).toHaveLength(1);
        expect(blocks.some(b => /^\s*VERSION,?\s*$/m.test(b))).toBe(false);
    });

    it("VERSION is declared for TypeScript in src/globals.d.ts", () => {
        expect(read(GLOBALS_DTS)).toMatch(/export var VERSION: string;/);
        expect(read(GLOBALS_DTS)).toMatch(/export var BUILD_TIMESTAMP: number;/);
    });

    it("VERSION still comes from package.json in common.mjs", () => {
        expect(read(COMMON_MJS)).toMatch(/export const VERSION = PackageJSON\.version;/);
    });

    it("gitHashPlugin still has exactly one registration site, in commonOpts", () => {
        // If a build script ever grows its own `plugins:` list that replaces
        // commonOpts.plugins instead of spreading it, ~git-hash stops resolving
        // in that target and this count changes.
        const sources = [read(COMMON_MJS), read(BUILD_MJS), read(BUILD_WEB_MJS)].join("\n");
        const registrations = sources.match(/(?<!export const )\bgitHashPlugin\b/g) ?? [];
        expect(registrations).toHaveLength(1);
        expect(read(COMMON_MJS)).toMatch(/plugins: \[[^\]]*gitHashPlugin[^\]]*\]/);
    });
});
