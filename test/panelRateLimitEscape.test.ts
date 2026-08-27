/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The panel's "Rate limited" state used to be a dead end: it named the failure
 * and offered nothing. The remedy — point the plugin at a free endpoint of your
 * own — lives in this plugin's settings modal, which a user staring at a stuck
 * panel has no reason to open. Panel.tsx now renders one button that opens it.
 *
 * Two things have to stay true and neither is checked by the compiler:
 *
 *   1. The button appears ONLY in the degraded state. A button offering to fix
 *      a rate limit, shown while nothing is rate limited, is noise in a panel
 *      that already carries a Ko-fi button and a banner.
 *   2. PLUGIN_NAME in Panel.tsx matches the `name` given to definePlugin. That
 *      string is the key into the plugin registry; if it drifts, the lookup
 *      returns undefined, the guard swallows it, and the button silently does
 *      nothing. That failure is invisible at build time.
 *
 * A SOURCE SCAN rather than a render test, for the reason recorded in
 * test/core-isolation.test.ts: Panel.tsx imports @webpack/common, @api/* and
 * @components/*, none of which resolve under vitest — they need a running
 * Discord client. Importing it here would fail on the import, not on the
 * behaviour, so the assertions are made against the file's text instead.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const PANEL = join(PLUGIN, "panel", "Panel.tsx");
const STYLES = join(PLUGIN, "panel", "styles.ts");
const INDEX = join(PLUGIN, "index.tsx");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

function countOccurrences(source: string, needle: string): number {
    let n = 0;
    for (let i = source.indexOf(needle); i !== -1; i = source.indexOf(needle, i + needle.length)) n++;
    return n;
}

const DEGRADED_GUARD = 'state === "degraded" && (';

/**
 * The character range spanned by `{state === "degraded" && ( … )}` in Panel.tsx,
 * found by balancing parentheses from the guard's own opening one.
 *
 * Parenthesis counting is only sound because nothing inside that block contains
 * a parenthesis in a string or in JSX text — the test below that requires the
 * Ko-fi button to fall OUTSIDE this range is what catches a miscount, since any
 * runaway match swallows the rest of the render.
 */
function degradedBlock(source: string): { start: number; end: number; } {
    const idx = source.indexOf(DEGRADED_GUARD);
    if (idx === -1) throw new Error(`no \`${DEGRADED_GUARD}\` guard found in ${PANEL}`);
    if (source.indexOf(DEGRADED_GUARD, idx + 1) !== -1) {
        throw new Error("more than one degraded guard — this scan only measures the first");
    }

    const open = idx + DEGRADED_GUARD.length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") {
            depth--;
            if (depth === 0) return { start: open, end: i };
        }
    }
    throw new Error("unbalanced parentheses after the degraded guard");
}

function inDegradedBlock(source: string, needle: string): boolean {
    const { start, end } = degradedBlock(source);
    const at = source.indexOf(needle);
    return at > start && at < end;
}

describe("the rate-limited panel offers a way out", () => {
    it("the files it claims to scan exist and are not empty", () => {
        for (const file of [PANEL, STYLES, INDEX]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("the panel still calls the degraded state 'Rate limited'", () => {
        // If this label moves, the button below is answering a question the
        // panel no longer asks.
        expect(read(PANEL)).toContain('degraded: "Rate limited"');
    });

    it("renders exactly one escape button", () => {
        expect(countOccurrences(read(PANEL), 'className="escape"')).toBe(1);
    });

    it("the escape button is inside the degraded guard", () => {
        expect(inDegradedBlock(read(PANEL), 'className="escape"')).toBe(true);
    });

    /**
     * The control for the test above. degradedBlock() would happily return a
     * range covering the whole render if the parenthesis balance ran away, and
     * then "is it inside the guard?" would pass for every element on the panel.
     * These three are unconditional and must fall OUTSIDE it.
     */
    it("the guard's range excludes the panel's unconditional elements", () => {
        const source = read(PANEL);
        for (const needle of ['className="kofi"', 'className="gh"', "<GoatBanner"]) {
            expect(inDegradedBlock(source, needle), `${needle} fell inside the degraded guard`).toBe(false);
        }
    });

    it("the button opens this plugin's own settings modal", () => {
        const source = read(PANEL);
        expect(source).toMatch(/^import\s*\{[^}]*\bopenPluginModal\b[^}]*\}\s*from\s*"@components\/settings";$/m);
        expect(source).toMatch(/^import\s*\{[^}]*\bplugins\b[^}]*\}\s*from\s*"@api\/PluginManager";$/m);
        expect(source).toContain("openPluginModal(self)");
        expect(source).toContain("onClick={openOwnSettings}");
    });

    it("PLUGIN_NAME matches the name definePlugin actually registers", () => {
        const panelName = /const PLUGIN_NAME = "([^"]+)"/.exec(read(PANEL))?.[1];
        const registered = /\bname:\s*"([^"]+)"/.exec(read(INDEX))?.[1];

        expect(panelName, "no PLUGIN_NAME constant in Panel.tsx").toBeTruthy();
        expect(registered, "no name: \"…\" in the plugin's index.tsx").toBeTruthy();
        expect(panelName).toBe(registered);
    });

    it("the escape button is styled and is not a bare unstyled element", () => {
        const css = read(STYLES);
        for (const selector of [".escape {", ".escape__icon", ".escape__title", ".escape__sub"]) {
            expect(css, `missing rule for ${selector}`).toContain(selector);
        }
        // Keyboard users get a focus ring, like every other button in the panel.
        expect(css).toContain(".escape:focus-visible");
    });

    it("the other panel states were not disturbed", () => {
        const source = read(PANEL);
        // The pre-existing "Discord updated" note still has its own guard, and
        // the toggle, mode switch and language row are all still unconditional.
        expect(source).toContain('state === "unavailable" && (');
        expect(inDegradedBlock(source, 'className="modeswitch"')).toBe(false);
        expect(inDegradedBlock(source, 'aria-label="Translate this server"')).toBe(false);
    });
});
