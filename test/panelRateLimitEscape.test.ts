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
 * own — is two screens away, and a user staring at a stuck panel has no reason
 * to go looking for it. Panel.tsx renders one button that opens it directly.
 *
 * Two things have to stay true and neither is checked by the compiler:
 *
 *   1. The button appears ONLY in the degraded state. A button offering to fix
 *      a rate limit, shown while nothing is rate limited, is noise in a panel
 *      that already carries a Ko-fi button and a banner.
 *   2. It opens the FOCUSED window, not the plugin cog. It used to call
 *      openPluginModal(plugins["ChannelTranslator"]) — the whole settings sheet,
 *      every control the plugin has, in a screen the user did not ask for.
 *      Operator: the button should "pop-up a window ONLY SHOW Provider … and
 *      provide a fill box". panel/EndpointModal.tsx is that window, and what is
 *      INSIDE it is pinned by test/panelEndpointModal.test.ts; this file pins
 *      only that the button reaches it and reaches nothing else.
 *
 * WHAT ITEM 2 REPLACED, AND WHY THE OLD ASSERTION IS GONE RATHER THAN MOVED.
 * This file used to assert that PLUGIN_NAME in Panel.tsx matched the `name`
 * given to definePlugin, because that string was the key into the plugin
 * registry: if it drifted, the lookup returned undefined, the guard swallowed
 * it, and the button silently did nothing — invisible at build time. Panel.tsx
 * no longer looks a plugin up by name at all, so there is no longer a second
 * copy of that name to keep in step. The failure is designed out, not merely
 * untested, and the assertion below that Panel.tsx contains no plugin-registry
 * lookup is what keeps it that way.
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
const MODAL = join(PLUGIN, "panel", "EndpointModal.tsx");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

/**
 * The file with every comment removed — both block comments (a JSX comment is
 * one of those) and `//` line comments.
 *
 * NEEDED BECAUSE ONE ASSERTION BELOW FORBIDS TOKENS THIS FILE'S OWN COMMENTS
 * QUOTE, which is the same problem test/panelSettingsOverlap.test.ts records for
 * its own comment filter: a source file must stay free to explain the mistake it
 * no longer makes.
 *
 * DELIBERATELY DUMB, AND ITS LIMITS ARE CHECKED RATHER THAN ASSUMED. It does not
 * understand string literals, so a `/*` inside one would confuse it; the `://`
 * case DOES occur in Panel.tsx (two https URLs) and is the reason the line-comment
 * pattern refuses a `//` preceded by a colon. The controls in the describe below
 * exercise it on text that must survive and text that must not.
 */
function strippedCode(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
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
        for (const file of [PANEL, STYLES, INDEX, MODAL]) {
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

    it("the button opens the focused endpoint window", () => {
        const source = read(PANEL);
        expect(source).toMatch(/^import\s*\{[^}]*\bopenEndpointModal\b[^}]*\}\s*from\s*"\.\/EndpointModal";$/m);
        expect(source).toContain("onClick={openEndpointModal}");
    });

    it("the endpoint window exports the opener the panel imports", () => {
        // The import above is satisfied by a file that exports nothing of that
        // name only at runtime, and this suite never runs Panel.tsx. Checked
        // here so a rename on one side is a red test rather than a dead button.
        expect(read(MODAL)).toContain("export function openEndpointModal()");
    });

    /**
     * THE DELETION, pinned.
     *
     * The escape button used to open the entire plugin cog through the plugin
     * registry — `plugins[PLUGIN_NAME]` handed to openPluginModal(). That is the
     * defect the operator asked to have removed ("pop-up a window ONLY SHOW
     * Provider…"), and it is the kind of thing a future reader would reasonably
     * add back while wiring up "let the user see the rest of the settings too".
     * A test that only checks the NEW call site cannot notice the old one coming
     * back beside it.
     *
     * Measured against the CODE, not the comments: Panel.tsx explains what the
     * button used to open and names openPluginModal while doing it, and a
     * matcher that cannot tell an explanation from an instruction would forbid
     * the source from warning the next reader off the mistake.
     */
    it("the panel no longer reaches the plugin registry or the whole settings sheet", () => {
        const code = strippedCode(read(PANEL));
        for (const gone of ["openPluginModal", "@api/PluginManager", "@components/settings", "PLUGIN_NAME"]) {
            expect(code, `Panel.tsx still uses ${gone} in code`).not.toContain(gone);
        }
    });

    it("the comment stripper removes comments and keeps code (controls)", () => {
        // Without these two the assertion above could pass because the stripper
        // deleted the whole file, or fail because it deleted nothing.
        expect(strippedCode("/* openPluginModal is gone */\nconst a = 1;")).not.toContain("openPluginModal");
        expect(strippedCode("// openPluginModal is gone\nconst a = 1;")).not.toContain("openPluginModal");
        expect(strippedCode("const x = openPluginModal(self);")).toContain("openPluginModal");
        // A URL is not a line comment. Panel.tsx has two of them, and a stripper
        // that ate everything after "https:" would silently shorten the file.
        expect(strippedCode('const KOFI = "https://ko-fi.com/irp_hongkong";')).toContain("ko-fi.com");
        expect(strippedCode(read(PANEL)).length).toBeGreaterThan(1000);
    });

    it("the plugin still registers the name the panel used to look up (control)", () => {
        // Not a requirement on Panel.tsx any more — it is the evidence that the
        // assertion above measures a real deletion rather than a renamed plugin.
        // definePlugin still registers a name; Panel.tsx simply no longer wants it.
        const registered = /\bname:\s*"([^"]+)"/.exec(read(INDEX))?.[1];
        expect(registered, "no name: \"…\" in the plugin's index.tsx").toBe("ChannelTranslator");
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
