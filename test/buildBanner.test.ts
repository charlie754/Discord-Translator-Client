/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The build banner is a cross-repository contract. The Discord Translator
 * Installer (a separate Go program) opens the installed asar and scrapes it.
 *
 * Two markers live there and they do different jobs:
 *
 *   `// Discord Translator <sha>`          drives the UPDATE MECHANISM. The
 *       installer compares this against the SHA sliced out of the latest
 *       release's name, and redownloads when the two differ. If its shape ever
 *       drifts, an up-to-date install reports itself permanently outdated and
 *       re-downloads the build on every run.
 *
 *   `// DiscordTranslatorVersion: <semver>`  is DISPLAY ONLY, so the installer
 *       can print "0.2.8" instead of a 40-character hash.
 *
 * The trap this file exists to hold shut: the installer's hash regex is
 * `// Discord Translator (\w+)`. A version marker written the obvious way —
 * "// Discord Translator Version: 0.2.8" — matches it and captures the word
 * "Version". Since the installer reads the whole asar and takes the LEFTMOST
 * match, such a marker could feed the update comparison a string that can never
 * equal a SHA. Hence the run-together token, which cannot match that regex at
 * all, in any order.
 */

const REPO = process.cwd();
const COMMON_MJS = join(REPO, "scripts", "build", "common.mjs");
const PACKAGE_JSON = join(REPO, "package.json");

/** Byte-for-byte the regex compiled at github_downloader.go's `regexp.MustCompile`. */
const INSTALLER_HASH_RE = /\/\/ Discord Translator (\w+)/;
/** What the installer must use to read the display version out of the same banner. */
const INSTALLER_VERSION_RE = /\/\/ DiscordTranslatorVersion: ([0-9][\w.+-]*)/;

/** The banner template literal, exactly as written in the build script. */
function bannerTemplate(): string {
    const src = readFileSync(COMMON_MJS, "utf8");
    const m = /export const banner = \{\s*js: `([\s\S]*?)`\.trim\(\)/.exec(src);
    if (!m) throw new Error(`could not locate the banner template in ${COMMON_MJS}`);
    return m[1].trim();
}

function packageVersion(): string {
    return JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version;
}

/** The banner as a real build emits it, with the placeholders filled in. */
function renderedBanner(sha: string, version: string): string {
    return bannerTemplate()
        .replace("${gitHash}", sha)
        .replace("${VERSION}", version)
        .replace("${IS_STANDALONE}", "true")
        .replace(/\$\{IS_STANDALONE === false [^}]*\}/, "Universal")
        .replace("${IS_UPDATER_DISABLED}", "false");
}

const SHA = "0c9dd4eaf871cec2b6e602952f0f6a31c9c91609";

describe("build banner", () => {
    it("reads the build script it claims to inspect", () => {
        expect(existsSync(COMMON_MJS), `not found: ${COMMON_MJS}`).toBe(true);
        expect(bannerTemplate().length).toBeGreaterThan(0);
    });

    it("keeps the installer's hash marker as the banner's first line, unchanged", () => {
        expect(bannerTemplate().split("\n")[0]).toBe("// Discord Translator ${gitHash}");
    });

    it("carries the version marker on its own line, fed from package.json", () => {
        expect(bannerTemplate().split("\n")).toContain("// DiscordTranslatorVersion: ${VERSION}");
    });

    it("still yields the git SHA to the installer's existing hash regex", () => {
        const match = INSTALLER_HASH_RE.exec(renderedBanner(SHA, packageVersion()));
        expect(match, "the installer would find no hash at all").not.toBeNull();
        expect(match![1]).toBe(SHA);
    });

    it("yields the real package.json version to the version regex", () => {
        const version = packageVersion();
        const match = INSTALLER_VERSION_RE.exec(renderedBanner(SHA, version));
        expect(match, "the installer would find no version at all").not.toBeNull();
        expect(match![1]).toBe(version);
        // A hash is not a version: catches the two markers being wired to the same value.
        expect(match![1]).not.toBe(SHA);
    });

    it("the version marker cannot be mistaken for the hash marker", () => {
        // Derived from the build script, not from a literal: a test that spells the
        // marker itself would keep passing after the build script changed.
        const line = renderedBanner(SHA, packageVersion())
            .split("\n")
            .find(l => l.includes(packageVersion()));
        expect(line, "no banner line carries the version").toBeDefined();
        expect(INSTALLER_HASH_RE.test(line!)).toBe(false);
    });

    it("a colliding marker WOULD be mistaken for it (positive control)", () => {
        // This is the spelling that must never be adopted. If this control ever
        // stops failing the regex above, the assertion it guards is vacuous.
        const bad = "// Discord Translator Version: 0.2.8";
        expect(INSTALLER_HASH_RE.exec(bad)![1]).toBe("Version");
    });

    it("survives the installer's leftmost-match rule whatever the line order", () => {
        // The installer regexes the entire asar, so ordering across files is not
        // something this repository controls. The hash must win regardless.
        const lines = renderedBanner(SHA, packageVersion()).split("\n");
        expect(INSTALLER_HASH_RE.exec(lines.slice().reverse().join("\n"))![1]).toBe(SHA);
    });

    it("adds exactly one hash-regex match to the banner", () => {
        const hits = renderedBanner(SHA, packageVersion())
            .match(new RegExp(INSTALLER_HASH_RE.source, "g")) ?? [];
        expect(hits).toHaveLength(1);
    });
});
