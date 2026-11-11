/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getReleaseInfo, isCompleteAsar, isReleaseAssetUrl } from "../src/main/updater/release";

const GIT_HASH = "a".repeat(40);
const RELEASE_HASH = "b".repeat(40);
const REPO = "charlie754/Discord-Translator-Client";

/** A minimal asar in the Chromium Pickle layout: 4, header size, payload size, JSON length, JSON. */
function asar(json: string): Uint8Array {
    const body = new TextEncoder().encode(json);
    const out = new Uint8Array(16 + body.length + 8);
    const view = new DataView(out.buffer);
    view.setUint32(0, 4, true);
    view.setUint32(4, body.length + 8, true);
    view.setUint32(8, body.length + 4, true);
    view.setUint32(12, body.length, true);
    out.set(body, 16);
    return out;
}

describe("desktop updater release metadata", () => {
    it("builds the compare path from the release SHA instead of HEAD", () => {
        expect(getReleaseInfo(GIT_HASH, `Discord Translator ${RELEASE_HASH}`)?.comparePath)
            .toBe(`/compare/${GIT_HASH}...${RELEASE_HASH}`);
    });

    it("rejects a release name without a 40-hex SHA", () => {
        expect(getReleaseInfo(GIT_HASH, "Discord Translator not-a-commit")).toBeNull();
    });

    it("detects when the release SHA equals the installed SHA", () => {
        expect(getReleaseInfo(GIT_HASH, `Discord Translator ${GIT_HASH}`)?.isCurrent).toBe(true);
    });
});

describe("desktop updater download guard", () => {
    it("accepts only this repository's own release assets", () => {
        expect(isReleaseAssetUrl(`https://github.com/${REPO}/releases/download/v0.2.19/desktop.asar`, REPO)).toBe(true);
        expect(isReleaseAssetUrl("https://evil.example/desktop.asar", REPO)).toBe(false);
        expect(isReleaseAssetUrl(`https://github.com/someone/else/releases/download/v1/desktop.asar`, REPO)).toBe(false);
        expect(isReleaseAssetUrl(`https://github.com/${REPO}/releases/download/../../../../evil/x`, REPO)).toBe(false);
        expect(isReleaseAssetUrl(`http://github.com/${REPO}/releases/download/v1/desktop.asar`, REPO)).toBe(false);
        expect(isReleaseAssetUrl(`https://github.com.evil.example/${REPO}/releases/download/v1/desktop.asar`, REPO)).toBe(false);
        expect(isReleaseAssetUrl(undefined, REPO)).toBe(false);
    });

    it("accepts a complete asar of the announced size and nothing else", () => {
        const good = asar(JSON.stringify({ files: { "index.js": { size: 1, offset: "0" } } }));
        expect(isCompleteAsar(good, good.byteLength)).toBe(true);

        // Truncated download: fewer bytes than GitHub announced.
        expect(isCompleteAsar(good.subarray(0, good.byteLength - 1), good.byteLength)).toBe(false);
        // An HTML error page served with status 200.
        const html = new TextEncoder().encode("<!DOCTYPE html><html><body>rate limited</body></html>");
        expect(isCompleteAsar(html, html.byteLength)).toBe(false);
        // Right magic, broken header JSON.
        const broken = asar("{\"files\":");
        expect(isCompleteAsar(broken, broken.byteLength)).toBe(false);
        // No size from the API at all.
        expect(isCompleteAsar(good, undefined)).toBe(false);
    });

    // The parser must agree with a REAL archive, not only with the fixture above. dist/desktop.asar
    // exists after `pnpm build`; release.yml runs the unit tests before building, so there it skips.
    const built = join(process.cwd(), "dist", "desktop.asar");
    (existsSync(built) ? it : it.skip)("recognises the built desktop.asar", () => {
        const data = readFileSync(built);
        expect(isCompleteAsar(data, data.byteLength)).toBe(true);
    });
});
