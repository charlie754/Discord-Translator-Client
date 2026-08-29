/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PanelState, ToggleState, toggleShowsOn } from "../src/plugins/channelTranslator/core/modes";

/**
 * THE PANEL MAY NOT SAY "ON" WHILE IT SAYS TRANSLATION IS PAUSED.
 *
 * WHAT SHIPPED. In the `unavailable` state — the one `patchesOk()` returns
 * false for, i.e. Discord changed underneath us — the panel showed three
 * signals at once:
 *
 *   - the pill:   "Discord updated"
 *   - the footer: "Discord changed. Translation is paused; double-click still
 *                  works."
 *   - the switch: GREEN, thumb slid across, `aria-checked="true"`.
 *
 * The third contradicted the other two. It rendered `toggle.isOn(guildId)`
 * directly, and that value is the user's own choice for this session, which
 * outlives the outage on purpose. `.track[aria-checked="true"]` in
 * panel/styles.ts is the only rule that paints the track with the accent colour
 * and moves the thumb, so one attribute drove both the picture and what a
 * screen reader announced.
 *
 * NOT TO BE CONFUSED WITH RESTART BEHAVIOUR, which is a different decision in a
 * different file. The toggle does not survive a client restart at all — see
 * test/toggleDoesNotSurviveRestart.test.ts. What must survive is an OUTAGE
 * WITHIN one session, and that is what half 2 below is about.
 *
 * BOTH HALVES ARE PINNED HERE, and the second is the one that makes this a fix
 * rather than a new bug:
 *
 *   1. The switch does not read ON while the state is `unavailable`.
 *   2. NOTHING IS CLEARED. Asking what the switch shows must not touch the
 *      toggle, so when Discord is patched and the state leaves `unavailable`,
 *      every server the user had enabled is still enabled and the switch reads
 *      ON again by itself, in the same sitting, with nothing to re-do. The
 *      obvious "fix" — calling setOn(guildId, false) when the patches stop
 *      matching — passes half of this file and silently forgets the user's
 *      servers, which is worse than the defect it replaces and invisible until
 *      the outage ends.
 *
 * WHY THE DECISION LIVES IN core/modes.ts. Panel.tsx imports @webpack/common,
 * which does not resolve under vitest — the reason recorded at length in
 * test/core-isolation.test.ts and test/panelRateLimitEscape.test.ts. So the
 * BEHAVIOUR is exercised against the pure function below, and the WIRING (that
 * the panel actually renders it, and that flip() was left alone) is the source
 * scan in the second describe. Neither half is sufficient on its own: a correct
 * function nothing calls is not a fixed panel, and a source scan cannot tell
 * whether the function it found is right.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const PANEL = join(PLUGIN, "panel", "Panel.tsx");
const MODES = join(PLUGIN, "core", "modes.ts");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

/** Every panel state except the one under test. */
const OTHER_STATES: PanelState[] = ["off", "translating", "on", "degraded"];

/** A server that is switched ON, which is the only interesting fixture here. */
function enabled(): ToggleState {
    const toggle = new ToggleState();
    toggle.setOn("g1", true);
    // The control for every "shows off" assertion below. Without it they would
    // all pass on a toggle that was never switched on in the first place.
    expect(toggle.isOn("g1"), "fixture is not actually on — the assertions below are vacuous").toBe(true);
    return toggle;
}

describe("the panel's switch while Discord is unavailable", () => {
    it("the state under test is one the panel can really reach (control)", () => {
        // Derived from panelState() rather than asserted as a literal, so this
        // file cannot end up guarding a state the panel never enters. patchesOk
        // false is what produces it, and it outranks everything else.
        const toggle = enabled();
        expect(toggle.panelState({
            guildId: "g1", patchesOk: false, breakerOpen: false, pending: 0
        })).toBe("unavailable");
    });

    it("does NOT read ON, even though the server is switched on", () => {
        expect(toggleShowsOn(enabled(), "g1", "unavailable")).toBe(false);
    });

    it("leaves the session's toggle exactly as it was", () => {
        const toggle = enabled();
        const before = toggle.serialise();

        toggleShowsOn(toggle, "g1", "unavailable");

        expect(toggle.isOn("g1"), "the outage cleared the user's own choice").toBe(true);
        expect(toggle.serialise(), "the toggle's own server list was rewritten").toBe(before);
        expect(before).toBe(JSON.stringify(["g1"]));
    });

    it("so the switch comes back ON by itself once Discord is patched again", () => {
        // The whole point of half 2, end to end: ask in the broken state, then
        // ask in the working one, on the SAME toggle.
        const toggle = enabled();
        expect(toggleShowsOn(toggle, "g1", "unavailable")).toBe(false);
        expect(toggleShowsOn(toggle, "g1", "on")).toBe(true);
    });

    it("every other state still shows the real toggle (negative control)", () => {
        // Without this, "shows off" would be satisfied by a switch that is off
        // in every state, which is a different and much larger defect.
        const toggle = enabled();
        for (const state of OTHER_STATES) {
            expect(toggleShowsOn(toggle, "g1", state), `${state} stopped showing ON`).toBe(true);
        }
    });

    it("a server that is OFF reads off in every state, unavailable included", () => {
        const toggle = new ToggleState();
        for (const state of [...OTHER_STATES, "unavailable" as PanelState]) {
            expect(toggleShowsOn(toggle, "g1", state), `${state} invented an ON server`).toBe(false);
        }
    });

    it("a DM has no guild and is off in every state, as it always was", () => {
        const toggle = enabled();
        for (const state of [...OTHER_STATES, "unavailable" as PanelState]) {
            expect(toggleShowsOn(toggle, null, state), `${state} switched a DM on`).toBe(false);
        }
    });
});

describe("the panel is actually wired to it", () => {
    it("the files this scan reads exist and are not empty", () => {
        for (const file of [PANEL, MODES]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("Panel.tsx imports the decision rather than repeating it", () => {
        const source = read(PANEL);
        expect(source).toMatch(/^import\s*\{[^}]*\btoggleShowsOn\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
    });

    it("the track's aria-checked renders that decision, and nothing else", () => {
        const source = read(PANEL);
        expect(source).toContain("aria-checked={switchShowsOn}");
        // The exact expression that shipped. `isOn` is still computed and still
        // correct — it is the input to flip() — so a revert here is one
        // character short of invisible.
        expect(
            source,
            "the track is back on the raw toggle value — it will read ON while the " +
            "panel says translation is paused"
        ).not.toContain("aria-checked={isOn}");
    });

    it("flip() still writes the real toggle, not the displayed value", () => {
        // The cosmetic value must not reach the writer. If flip() ever reads
        // switchShowsOn, then a click in a state where the switch is forced off
        // writes the WRONG side of the flip.
        const source = read(PANEL);
        const flip = source.slice(source.indexOf("const flip = () => {"));
        const body = flip.slice(0, flip.indexOf("};"));
        expect(body, "flip() was not found in the shape this scan expects").toContain("toggle.setOn(");
        expect(body).toContain("toggle.setOn(guildId, !isOn);");
        expect(body, "flip() now writes what the switch DISPLAYS").not.toContain("switchShowsOn");
    });

    it("nothing in the panel clears the stored state when the patches stop matching", () => {
        // The defect the doc-block above warns about, pinned as source: there is
        // exactly one setOn call site in this file and it is the user's click.
        const source = read(PANEL);
        const calls = source.match(/\btoggle\.setOn\(/g) ?? [];
        expect(calls, "a second setOn appeared in Panel.tsx — see half 2 above").toHaveLength(1);
        expect(source).not.toMatch(/setOn\([^)]*,\s*false\s*\)/);
    });

    it("the guard is in the shared decision, not spelled out again in the panel (control)", () => {
        // If the state test were inlined into the JSX the two copies would drift,
        // and the behaviour tests above would be measuring a function the panel
        // does not use.
        expect(read(MODES)).toContain("export function toggleShowsOn(");
        expect(read(MODES)).toMatch(/if \(state === "unavailable"\) return false;/);
    });
});
