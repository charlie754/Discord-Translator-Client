/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Chromium now treats `app-region` as the inherited `window-drag` property, so a
// `no-drag` on a document-level element is inherited by the whole app and makes
// the Discord window impossible to move (reported on v0.2.17, Discord host
// 1.0.9267 / Chrome 152). No shipped stylesheet may set it on a root element.
const ROOT_SELECTOR = /(^|[\s,}])(html|body|:root|#app-mount)\s*(,[^{]*)?\{[^}]*app-region\s*:\s*no-drag/i;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(css|ts|tsx)$/.test(name)) out.push(path);
    }
    return out;
}

describe("window drag region", () => {
    it("fixWeirdAppRegionBug.css neutralises body without no-drag", () => {
        const css = readFileSync(join(process.cwd(), "src", "fixWeirdAppRegionBug.css"), "utf8");
        expect(css).toMatch(/body\s*\{[^}]*app-region\s*:\s*unset/);
        expect(css).not.toMatch(/body\s*\{[^}]*app-region\s*:\s*no-drag/);
    });

    it("no source stylesheet sets app-region: no-drag on a root element", () => {
        const offenders = walk(join(process.cwd(), "src"))
            .filter(file => ROOT_SELECTOR.test(readFileSync(file, "utf8")));
        expect(offenders).toEqual([]);
    });
});
