/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    PanelState,
    selectionGate,
    ToggleState,
    toggleShowsOn,
    UNAVAILABLE_FOOTER,
    unavailableFooter
} from "../src/plugins/channelTranslator/core/modes";

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

/**
 * THE FOOTER MAY NOT PROMISE A PATH THAT WILL REFUSE.
 *
 * WHAT SHIPPED, and it is the other half of the contradiction pinned above. In
 * the `unavailable` state the footer rendered one fixed sentence for everybody:
 *
 *     "Discord changed. Translation is paused; double-click still works."
 *
 * The second clause is a claim about the selection path, and that path is
 * governed by selectionGate(), which refuses with SELECTION_REFUSAL.serverOff
 * whenever this server's toggle is off. So a user who had never switched this
 * server on was told a manual route still worked, tried it, and was told
 * "translation is off for this server. Turn it on from the translator panel."
 * The panel was open in front of them and its switch is `disabled` in exactly
 * this state, so the instruction they were given could not be carried out.
 *
 * PRE-EXISTING, AND MADE MORE VISIBLE BY THE FIX ABOVE. Forcing the switch to
 * read OFF is what puts a user in front of a control that looks switchable,
 * reads off, and cannot be moved — with a sentence underneath promising the
 * fallback still works.
 *
 * WHAT IS ASSERTED. The wording is chosen by unavailableFooter() in core/modes,
 * which asks selectionGate() rather than re-deciding, so this file can pin the
 * two things that matter as BEHAVIOUR: the promise is made only when the gate
 * really allows, and the off wording points at no control at all. The wiring —
 * that Panel.tsx renders the function rather than a literal — is the source scan
 * at the end, for the reason the doc-block at the top of this file gives.
 */
describe("the panel's footer while Discord is unavailable", () => {
    it("says double-click still works when this server IS switched on", () => {
        expect(unavailableFooter(enabled(), "g1", false)).toBe(UNAVAILABLE_FOOTER.doubleClickWorks);
    });

    it("does NOT say it when this server was never switched on", () => {
        expect(unavailableFooter(new ToggleState(), "g1", false)).toBe(UNAVAILABLE_FOOTER.serverOff);
    });

    it("the promise is made exactly when the double-click path would allow it", () => {
        // The property, rather than the two cases: whatever the footer claims, it
        // agrees with the function that actually decides the click. A second copy
        // of the condition would pass the two tests above and drift the first time
        // either side was reworded.
        for (const toggle of [enabled(), new ToggleState()]) {
            for (const includeDMs of [true, false, undefined]) {
                for (const guildId of ["g1", null]) {
                    const allowed = selectionGate(toggle, { guildId }, includeDMs).allowed;
                    expect(
                        unavailableFooter(toggle, guildId, includeDMs) === UNAVAILABLE_FOOTER.doubleClickWorks,
                        `footer and gate disagree for guildId=${String(guildId)} includeDMs=${String(includeDMs)}`
                    ).toBe(allowed);
                }
            }
        }
    });

    it("the two sentences are genuinely different (control)", () => {
        // Without this, every assertion above is satisfied by one string under two
        // names, and the footer would be as unconditional as it ever was.
        expect(UNAVAILABLE_FOOTER.serverOff).not.toBe(UNAVAILABLE_FOOTER.doubleClickWorks);
    });

    it("both still say translation is paused (control)", () => {
        // The half of the original sentence that was always true must survive the
        // fix. Losing it would leave a user in the outage with no explanation.
        for (const sentence of Object.values(UNAVAILABLE_FOOTER)) {
            expect(sentence, "a footer stopped saying translation is paused")
                .toContain("Translation is paused");
        }
    });

    it("the off wording points at no control, because there is none to point at", () => {
        // SELECTION_REFUSAL.serverOff CAN say "turn it on from the translator
        // panel" — the double-click path is reachable in states where the switch
        // works. This footer cannot: it is rendered only while the state is
        // `unavailable`, and the scan below pins that the switch is disabled
        // there. Repeating the refusal's advice here would move the lie rather
        // than remove it.
        const off = UNAVAILABLE_FOOTER.serverOff.toLowerCase();
        expect(off, "the footer tells the user to use a switch it has disabled").not.toContain("turn it on");
        expect(off, "the footer still promises the double-click works").not.toContain("still works");
        // …and it does say the two true things.
        expect(off).toContain("not switched on");
        expect(off).toContain("unavailable");
    });

    it("the switch really is unusable in this state, which is what makes it a lie (control)", () => {
        // The premise of the test above, read off the panel rather than assumed.
        expect(
            read(PANEL),
            "the switch is no longer disabled while unavailable — re-read the off wording, " +
            "because pointing at the switch may now be honest"
        ).toContain('disabled={state === "unavailable"}');
    });

    it("the panel renders the chosen sentence, not a literal one (wiring)", () => {
        const source = read(PANEL);
        expect(source).toMatch(/^import\s*\{[^}]*\bunavailableFooter\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
        expect(source).toContain("{unavailableFooter(toggle, guildId, settings.store.includeDMs)}");
        // The exact JSX text node that shipped, as its own line. The doc-comment
        // beside the fix quotes the same sentence across two lines on purpose, so
        // this matches the rendered copy coming back and not the note explaining
        // why it went.
        expect(
            source,
            "the fixed sentence is back in the JSX — the footer promises double-click to " +
            "users whose server is off again"
        ).not.toMatch(/^\s+Discord changed\. Translation is paused; double-click still works\.\s*$/m);
    });

    it("the wording lives in core/, where it can be exercised (control)", () => {
        // Same reason as toggleShowsOn() above: a sentence built inline in the JSX
        // is a sentence this suite cannot reach, and the behaviour tests would be
        // measuring a function the panel does not use.
        const modes = read(MODES);
        expect(modes).toContain("export function unavailableFooter(");
        expect(modes, "the footer stopped asking the gate and decided for itself")
            .toMatch(/return selectionGate\(toggle, \{ guildId \}, includeDMs\)\.allowed/);
    });
});
