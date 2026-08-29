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
    UNAVAILABLE_FOOTER,
    unavailableFooter
} from "../src/plugins/channelTranslator/core/modes";

/**
 * THE PANEL'S SWITCH IS A PREFERENCE, NOT A STATUS, AND IT IS NEVER DISABLED.
 *
 * WHAT SHIPPED, AND IT WAS A LOCKOUT. Three separate decisions met in the
 * `unavailable` state — the one `patchesOk()` returns false for, i.e. Discord
 * changed underneath us:
 *
 *   1. Panel.tsx carried `disabled={state === "unavailable"}` on the track.
 *   2. core/modes.ts carried toggleShowsOn(), which forced the track to render
 *      OFF in that state whatever the user had chosen.
 *   3. state.ts's hydrate() stopped restoring the toggle, so every start begins
 *      with translation off — see test/toggleDoesNotSurviveRestart.test.ts.
 *
 * Start the client while Discord is unpatched and all three are true at once:
 * translation is off, the switch reads off, and THE ONLY CONTROL THAT COULD
 * TURN IT ON REFUSES THE CLICK. There is no route in. While the on-state still
 * persisted, a server enabled in an earlier session stayed enabled and resumed
 * by itself, which is the only reason (1) and (2) had looked survivable.
 *
 * WHY UNLOCKING IT IS THE FIX AND NOT A WORKAROUND. selectionGate() does not
 * consult `patchesOk` — only panelState() does, and only to choose the pill's
 * label. So double-click translation genuinely works during the outage for a
 * server whose toggle is on, which is exactly what
 * UNAVAILABLE_FOOTER.doubleClickWorks promises. Disabling the switch withheld
 * the one path that still worked, and withheld pre-arming the rendered path for
 * the moment the patches match again.
 *
 * SO THE THREE SIGNALS DIVIDE THE WORK. The pill carries the status ("Discord
 * updated"), the footer explains it and says what to do, and the switch says
 * what the USER WANTS. That is why toggleShowsOn() is gone rather than merely
 * unused: once the control is operable, a track that renders anything but the
 * stored preference goes grey under a click that had just switched the server
 * ON, and flip() writes `!isOn`, so the next click would appear to do nothing.
 *
 * WHAT MUST STILL NOT HAPPEN, and it is the half that makes this a fix rather
 * than a new bug: NOTHING MAY CLEAR THE TOGGLE WHEN THE PATCHES STOP MATCHING.
 * Asking what the panel should show must not write to the toggle, so when
 * Discord is patched and the state leaves `unavailable`, every server the user
 * enabled is still enabled with nothing to re-do. The obvious "fix" — calling
 * setOn(guildId, false) when the patches stop matching — would silently forget
 * the user's servers and stay invisible until the outage ended.
 *
 * WHY HALF OF THIS FILE IS A SOURCE SCAN. Panel.tsx imports @webpack/common,
 * which does not resolve under vitest — the reason recorded at length in
 * test/core-isolation.test.ts and test/panelRateLimitEscape.test.ts. So the
 * BEHAVIOUR is exercised against the pure functions in core/modes.ts, and the
 * MARKUP — that no `disabled` reaches the track, that the track renders the
 * stored preference, that flip() writes it — is read off the source. Neither
 * half is sufficient alone: a correct function nothing calls is not a fixed
 * panel, and a source scan cannot tell whether what it found is right. Every
 * source assertion below therefore carries a control proving the scanner can
 * see the defect it is claiming is absent.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const PANEL = join(PLUGIN, "panel", "Panel.tsx");
const MODES = join(PLUGIN, "core", "modes.ts");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

/**
 * The opening tag of the first element carrying `marker`, e.g. the track button.
 *
 * Scanned rather than regexed because the question this file asks is "what
 * attributes does THE TRACK have", and an attribute is only absent if it is
 * absent from that one element — a `disabled=` on a control further down the
 * panel must not be mistaken for one on the switch. Quotes and JSX braces are
 * tracked so a `>` inside an expression cannot end the tag early.
 */
function openingTag(source: string, marker: string): string {
    const at = source.indexOf(marker);
    if (at === -1) throw new Error(`marker not found in source: ${marker}`);
    const start = source.lastIndexOf("<", at);
    if (start === -1) throw new Error(`no element opens before: ${marker}`);

    let quote: string | null = null;
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quote !== null) {
            if (c === quote) quote = null;
            continue;
        }
        if (c === "\"" || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") { depth++; continue; }
        if (c === "}") { depth--; continue; }
        if (c === ">" && depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated opening tag for: ${marker}`);
}

/**
 * The body of a top-level exported function, from its signature to the closing
 * brace in column 1.
 *
 * Bounded on purpose. Slicing from a signature to end-of-file swept in every
 * doc-comment that follows — including the ones that DISCUSS `patchesOk` by
 * name — so "the gate does not read patchesOk" failed on the prose explaining
 * that it does not.
 */
function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    if (start === -1) throw new Error(`signature not found: ${signature}`);
    const end = source.indexOf("\n}\n", start);
    if (end === -1) throw new Error(`unterminated function: ${signature}`);
    return source.slice(start, end + 3);
}

/** Whether an opening tag carries a `disabled` attribute, valued or bare. */
function hasDisabledAttribute(tag: string): boolean {
    return /[\s{]disabled(\s*=|\s|\/|>)/.test(tag);
}

/** Every state panelState() can return, each proved reachable below. */
const ALL_STATES: PanelState[] = ["off", "translating", "on", "degraded", "unavailable"];

/**
 * The states a switched-ON server can be in, and the states a switched-OFF one
 * can be in. They are not the same list and cannot be, because `off` IS "this
 * server is not switched on" — panelState() tests `isOn` before it looks at the
 * breaker or the pending count, so an enabled server never reports `off` and a
 * disabled one never reports anything but `off` or `unavailable`. Splitting the
 * list keeps every loop below asserting a state the fixture can really be in;
 * one flat list would have quietly asserted an impossible pair.
 */
const STATES_WITH_SERVER_ON: PanelState[] = ["translating", "on", "degraded", "unavailable"];
const STATES_WITH_SERVER_OFF: PanelState[] = ["off", "unavailable"];

interface PanelCtx { guildId: string; patchesOk: boolean; breakerOpen: boolean; pending: number; }

/** The context that really produces each state, so the list above cannot be fiction. */
function contextFor(state: PanelState): PanelCtx {
    switch (state) {
        case "unavailable": return { guildId: "g1", patchesOk: false, breakerOpen: false, pending: 0 };
        case "off": return { guildId: "g1", patchesOk: true, breakerOpen: false, pending: 0 };
        case "degraded": return { guildId: "g1", patchesOk: true, breakerOpen: true, pending: 0 };
        case "translating": return { guildId: "g1", patchesOk: true, breakerOpen: false, pending: 3 };
        case "on": return { guildId: "g1", patchesOk: true, breakerOpen: false, pending: 0 };
    }
}

/** A server that is switched ON. */
function enabled(): ToggleState {
    const toggle = new ToggleState();
    toggle.setOn("g1", true);
    // The control for every assertion below. Without it they would all pass on a
    // toggle that was never switched on in the first place.
    expect(toggle.isOn("g1"), "fixture is not actually on — the assertions below are vacuous").toBe(true);
    return toggle;
}

describe("every panel state is real, and this file knows all of them", () => {
    it("each state in the list is one panelState() actually returns (control)", () => {
        // Derived rather than asserted as literals, so this file cannot end up
        // guarding states the panel never enters. `off` is the only one that
        // needs the server switched off, which is what makes it `off`.
        for (const state of ALL_STATES) {
            const toggle = state === "off" ? new ToggleState() : enabled();
            expect(toggle.panelState(contextFor(state)), `${state} is not reachable`).toBe(state);
        }
    });

    it("the on/off sub-lists cover every state and overlap only where they must (control)", () => {
        // A state missing from both lists is a state no loop below exercises.
        expect([...new Set([...STATES_WITH_SERVER_ON, ...STATES_WITH_SERVER_OFF])].sort())
            .toEqual(ALL_STATES.slice().sort());
        // `unavailable` outranks the toggle, so it is the one state both can be in.
        expect(STATES_WITH_SERVER_ON.filter(s => STATES_WITH_SERVER_OFF.includes(s)))
            .toEqual(["unavailable"]);
        // And the exclusion is real, not a convention: the context that yields
        // `off` for an empty toggle yields `on` for an enabled one.
        expect(enabled().panelState(contextFor("off"))).toBe("on");
        expect(new ToggleState().panelState(contextFor("on"))).toBe("off");
    });

    it("the list is not missing one the panel can show (control)", () => {
        // STATE_LABEL is Record<PanelState, string>, so its keys ARE the union and
        // TypeScript will not let it be short. Reading them off the panel means a
        // sixth state cannot be added without this file failing.
        const source = read(PANEL);
        const from = source.indexOf("const STATE_LABEL");
        const block = source.slice(from, source.indexOf("};", from));
        expect(block, "STATE_LABEL was not found in the shape this scan expects").toContain("Discord updated");
        const keys = [...block.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
        expect(keys.slice().sort()).toEqual(ALL_STATES.slice().sort());
    });
});

describe("the switch is operable in every state", () => {
    it("the track carries no `disabled` attribute at all", () => {
        // THE REGRESSION THIS FILE EXISTS FOR. `disabled={state === "unavailable"}`
        // sat on this element and locked the user out of their own plugin.
        const tag = openingTag(read(PANEL), "className=\"track\"");
        expect(tag, "the wrong element was extracted").toContain("<button");
        expect(tag, "the wrong element was extracted").toContain("role=\"switch\"");
        expect(
            hasDisabledAttribute(tag),
            "the track is disabled again — with translation off at every start that is a " +
            "lockout: the only control that can turn translation on refuses the click"
        ).toBe(false);
    });

    it("the scan can see a disabled switch when there is one (positive control)", () => {
        // Without this, the assertion above passes on a scanner that finds nothing
        // — which is exactly how the lockout would ship past it a second time.
        const withDisabled = `
                <button
                    className="track"
                    role="switch"
                    aria-checked={isOn}
                    disabled={state === "unavailable"}
                    onClick={flip}
                >`;
        expect(hasDisabledAttribute(openingTag(withDisabled, "className=\"track\""))).toBe(true);

        // …and the bare form, which is the same defect written shorter.
        const bare = "<button className=\"track\" role=\"switch\" disabled onClick={flip}>";
        expect(hasDisabledAttribute(openingTag(bare, "className=\"track\""))).toBe(true);

        // …and it does not fire on an attribute that merely contains the word.
        const lookalike = "<button className=\"track\" role=\"switch\" aria-disabledish={x} onClick={flip}>";
        expect(hasDisabledAttribute(openingTag(lookalike, "className=\"track\""))).toBe(false);
    });

    it("the scan reads the track and not some other disabled control (control)", () => {
        // A `disabled=` elsewhere in Panel.tsx must neither satisfy the assertion
        // above nor break it.
        const two = `
            <button className="other" disabled={true}>x</button>
            <button className="track" role="switch" onClick={flip}>y</button>`;
        expect(hasDisabledAttribute(openingTag(two, "className=\"track\""))).toBe(false);
        expect(hasDisabledAttribute(openingTag(two, "className=\"other\""))).toBe(true);
    });

    it("the click is actually wired, so \"not disabled\" means something", () => {
        // A control that is enabled and has no handler is locked out just as
        // completely. Asserted on the same extracted tag.
        expect(openingTag(read(PANEL), "className=\"track\"")).toContain("onClick={flip}");
    });
});

describe("the switch renders the stored preference, in every state", () => {
    it("a server that is ON reads on in every state it can reach, `unavailable` included", () => {
        const toggle = enabled();
        for (const state of STATES_WITH_SERVER_ON) {
            // Passed through panelState() first, so this is the value the panel
            // really has in hand at the moment it renders that state.
            expect(toggle.panelState(contextFor(state))).toBe(state);
            expect(toggle.isOn("g1"), `${state} stopped showing the user's choice`).toBe(true);
        }
    });

    it("a server that is OFF reads off in every state it can reach, and none is invented", () => {
        const toggle = new ToggleState();
        for (const state of STATES_WITH_SERVER_OFF) {
            expect(toggle.panelState(contextFor(state)), `${state} is not reachable while off`).toBe(state);
            expect(toggle.isOn("g1"), `${state} invented an ON server`).toBe(false);
        }
    });

    it("a DM has no guild and is off in every state, as it always was", () => {
        // The panel returns null before it renders for a DM, but ToggleState is
        // shared with the double-click path, which does not — so this is asserted
        // against every state the surrounding server can be in.
        const toggle = enabled();
        for (const state of STATES_WITH_SERVER_ON) {
            expect(toggle.panelState(contextFor(state))).toBe(state);
            expect(toggle.isOn(null), `${state} switched a DM on`).toBe(false);
        }
    });

    it("the track renders that value and nothing derived from the state", () => {
        const tag = openingTag(read(PANEL), "className=\"track\"");
        expect(tag).toContain("aria-checked={isOn}");
        // The cosmetic override that used to sit here. `.track[aria-checked="true"]`
        // in panel/styles.ts is the only rule that paints the track and slides the
        // thumb, so this one attribute drives the picture AND what a screen reader
        // announces.
        expect(
            tag,
            "the track renders a display-only value again — a click that switches the " +
            "server on leaves it grey, and flip() writes !isOn, so the next click " +
            "appears to do nothing"
        ).not.toContain("switchShowsOn");
        expect(tag).not.toMatch(/aria-checked=\{[^}]*state[^}]*\}/);
    });

    it("`isOn` is the stored preference, read straight off the toggle (wiring)", () => {
        // Ties the behaviour assertions above to the expression the markup
        // renders. Without it they would be testing ToggleState while the panel
        // showed something else entirely.
        expect(read(PANEL)).toContain("const isOn = toggle.isOn(guildId);");
    });
});

describe("the display-only wrapper is gone and must not come back", () => {
    it("the files this scan reads exist and are not empty", () => {
        for (const file of [PANEL, MODES]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("core/modes.ts no longer exports toggleShowsOn()", () => {
        const modes = read(MODES);
        expect(
            modes,
            "toggleShowsOn() is back — the switch will render off in the one state the " +
            "user most needs to change it"
        ).not.toContain("export function toggleShowsOn");
        expect(modes).not.toMatch(/if \(state === "unavailable"\) return false;/);
    });

    it("Panel.tsx does not import or call it", () => {
        const source = read(PANEL);
        expect(source).not.toMatch(/^import\s*\{[^}]*\btoggleShowsOn\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
        expect(source).not.toContain("= toggleShowsOn(");
        // The import that IS still needed, so this is not passing on a file that
        // stopped importing from core/modes altogether.
        expect(source).toMatch(/^import\s*\{[^}]*\bunavailableFooter\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
    });

    it("the scan would notice either of them coming back (positive control)", () => {
        // The assertions above are `not.toContain`, which pass on an empty string.
        // This proves the patterns match the thing they are forbidding.
        const reverted =
            "export function toggleShowsOn(\n" +
            "    toggle: ToggleState\n" +
            "): boolean {\n" +
            "    if (state === \"unavailable\") return false;\n" +
            "}\n" +
            "import { PanelState, toggleShowsOn, unavailableFooter } from \"../core/modes\";\n" +
            "    const switchShowsOn = toggleShowsOn(toggle, guildId, state);";
        expect(reverted).toContain("export function toggleShowsOn");
        expect(reverted).toMatch(/if \(state === "unavailable"\) return false;/);
        expect(reverted).toMatch(/^import\s*\{[^}]*\btoggleShowsOn\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
        expect(reverted).toContain("= toggleShowsOn(");
    });
});

describe("nothing clears the user's servers when the patches stop matching", () => {
    it("asking what the panel should say does not touch the toggle", () => {
        const toggle = enabled();
        const before = toggle.serialise();

        unavailableFooter(toggle, "g1", false);
        toggle.panelState(contextFor("unavailable"));

        expect(toggle.isOn("g1"), "the outage cleared the user's own choice").toBe(true);
        expect(toggle.serialise(), "the toggle's own server list was rewritten").toBe(before);
        expect(before).toBe(JSON.stringify(["g1"]));
    });

    it("so the switch is still on by itself once Discord is patched again", () => {
        // End to end on ONE toggle: ask in the broken state, then in the working
        // one. Nothing in between re-enables anything.
        const toggle = enabled();
        expect(toggle.panelState(contextFor("unavailable"))).toBe("unavailable");
        expect(toggle.isOn("g1")).toBe(true);
        expect(toggle.panelState(contextFor("on"))).toBe("on");
        expect(toggle.isOn("g1")).toBe(true);
    });

    it("flip() writes the real toggle, and it is the only writer in the panel", () => {
        const source = read(PANEL);
        const flip = source.slice(source.indexOf("const flip = () => {"));
        const body = flip.slice(0, flip.indexOf("};"));
        expect(body, "flip() was not found in the shape this scan expects").toContain("toggle.setOn(");
        expect(body).toContain("toggle.setOn(guildId, !isOn);");
        expect(body, "flip() now writes what the switch DISPLAYS").not.toContain("switchShowsOn");

        // Exactly one setOn call site in the whole file, and it is the user's
        // click — see the doc-block above for what a second one would cost.
        const calls = source.match(/\btoggle\.setOn\(/g) ?? [];
        expect(calls, "a second setOn appeared in Panel.tsx").toHaveLength(1);
        expect(source).not.toMatch(/setOn\([^)]*,\s*false\s*\)/);
    });
});

/**
 * THE OPERATOR'S COMPLAINT, PINNED END TO END: "it can't turn on now."
 *
 * Panel.tsx cannot be imported under vitest, so this is deliberately built in
 * two halves that meet. The SOURCE half proves the click is deliverable — the
 * track is enabled and wired to flip(). The BEHAVIOUR half performs what flip()
 * does, the exact `toggle.setOn(guildId, !isOn)` line asserted above, and shows
 * the double-click path opens as a result while the state stays `unavailable`
 * throughout.
 *
 * Reverting the fix breaks this: put `disabled={state === "unavailable"}` back
 * on the track and the first half fails, because the click the second half
 * performs can no longer reach the panel.
 */
describe("the lockout: switched off, Discord unavailable", () => {
    it("the user can still switch it on, and double-click then works", () => {
        const toggle = new ToggleState();
        const ctx = contextFor("unavailable");

        // Where the operator was: fresh start, nothing switched on, patches gone.
        expect(toggle.panelState(ctx), "the state under test is not the one reported").toBe("unavailable");
        expect(toggle.isOn("g1"), "the fixture is already on — the test proves nothing").toBe(false);
        expect(
            selectionGate(toggle, { guildId: "g1" }, false).allowed,
            "the double-click path was already open, so there was nothing to be locked out of"
        ).toBe(false);

        // The click is deliverable: the control is enabled and has a handler.
        const tag = openingTag(read(PANEL), "className=\"track\"");
        expect(
            hasDisabledAttribute(tag),
            "THE LOCKOUT IS BACK: translation is off at every start, the panel is " +
            "`unavailable`, and the only control that could turn it on refuses the click"
        ).toBe(false);
        expect(tag, "the track has no click handler, which locks the user out just as well")
            .toContain("onClick={flip}");

        // What that click does, verbatim from flip(): toggle.setOn(guildId, !isOn).
        toggle.setOn("g1", true);

        // The state has NOT changed — Discord is still unpatched — and the manual
        // route is open anyway, which is the whole point of unlocking the switch.
        expect(toggle.panelState(ctx), "switching on pretended to fix the patches").toBe("unavailable");
        expect(toggle.isOn("g1"), "the click did not stick").toBe(true);
        expect(
            selectionGate(toggle, { guildId: "g1" }, false).allowed,
            "the server is switched on and double-click is still refused"
        ).toBe(true);
    });

    it("and the footer stops withholding it at the same moment (end to end)", () => {
        // The sentence the user reads follows the same flip, because
        // unavailableFooter() asks the same gate.
        const toggle = new ToggleState();
        expect(unavailableFooter(toggle, "g1", false)).toBe(UNAVAILABLE_FOOTER.serverOff);
        toggle.setOn("g1", true);
        expect(unavailableFooter(toggle, "g1", false)).toBe(UNAVAILABLE_FOOTER.doubleClickWorks);
    });

    it("the gate that opened never asked about the patches (control)", () => {
        // Why the test above is a fix and not a coincidence: patchesOk is not an
        // input to selectionGate() at all, so the same answer comes back whatever
        // the panel state is.
        const toggle = enabled();
        for (const state of STATES_WITH_SERVER_ON) {
            expect(toggle.panelState(contextFor(state))).toBe(state);
            expect(
                selectionGate(toggle, { guildId: "g1" }, false).allowed,
                `the double-click path closed in the ${state} state`
            ).toBe(true);
        }
        // Read off the two functions that make the decision, bounded to their
        // own bodies. selectionGate() chooses the wording; translationEnabled()
        // is the allow/deny answer it delegates to, so both must be clean.
        const modes = read(MODES);
        const gate = functionBody(modes, "export function selectionGate(");
        const allowed = functionBody(modes, "export function translationEnabled(");
        // Controls: the slices really are those functions, and are not empty.
        expect(gate, "selectionGate() was not extracted").toContain("SELECTION_REFUSAL.unknownChannel");
        expect(allowed, "translationEnabled() was not extracted").toContain("includeDMs === true");
        // …and the extractor stops at the function, rather than running to EOF.
        expect(gate).not.toContain("export const UNAVAILABLE_FOOTER");
        expect(gate, "the double-click gate started consulting the patches").not.toContain("patchesOk");
        expect(allowed, "the allow/deny answer started consulting the patches").not.toContain("patchesOk");
        // The contrast that makes it a finding: panelState() DOES read it, and is
        // the only thing that does.
        expect(functionBody(modes, "export class ToggleState")).toContain("if (!ctx.patchesOk) return \"unavailable\";");
    });
});

/**
 * THE FOOTER MAY NOT PROMISE A PATH THAT WILL REFUSE, AND MAY NOT WITHHOLD ONE
 * THAT WORKS.
 *
 * WHAT SHIPPED FIRST. In the `unavailable` state the footer rendered one fixed
 * sentence for everybody:
 *
 *     "Discord changed. Translation is paused; double-click still works."
 *
 * The second clause is a claim about the selection path, and that path is
 * governed by selectionGate(), which refuses with SELECTION_REFUSAL.serverOff
 * whenever this server's toggle is off. So a user who had never switched this
 * server on was told a manual route still worked, tried it, and was refused.
 *
 * WHAT SHIPPED SECOND, and it is the half this turn rewrites. The off branch
 * ended "The switch is unavailable until translation works again." — an accurate
 * description of the disabled track, and the only guidance the panel offered in
 * the one state where the user was locked out. It told them their situation
 * could not be repaired while a working route existed. With the track operable
 * the sentence is simply false, so it now names the control and says what
 * switching it on buys: double-click straight away, and the rendered path once
 * the patches match again.
 *
 * WHAT IS ASSERTED. The wording is chosen by unavailableFooter(), which asks
 * selectionGate() rather than re-deciding, so the promise is pinned as BEHAVIOUR
 * against the function that actually answers the click.
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
        // The half of the original sentence that was always true must survive
        // every rewrite. Losing it would leave a user in the outage with no
        // explanation of the pill above.
        for (const sentence of Object.values(UNAVAILABLE_FOOTER)) {
            expect(sentence, "a footer stopped saying translation is paused")
                .toContain("Translation is paused");
        }
    });

    it("the off wording points at the switch, which is now honest", () => {
        const off = UNAVAILABLE_FOOTER.serverOff.toLowerCase();
        // It says what is wrong…
        expect(off, "the footer no longer says why nothing is translating").toContain("not switched on");
        // …names the control that fixes it, which it could not honestly do while
        // the track was disabled…
        expect(off, "the footer names no way out of the state it describes").toContain("switch");
        expect(off).toMatch(/turn it on|switch it on/);
        // …and says what that buys.
        expect(off, "the footer does not say double-click becomes available").toContain("double-click");
        // The sentence it replaced, which described the disabled track.
        expect(
            off,
            "the footer says the switch is unavailable again — either the wording is stale " +
            "or `disabled` is back on the track"
        ).not.toContain("unavailable");
    });

    it("the off wording still promises nothing about right now (control)", () => {
        // The original defect in a new place: this branch is rendered precisely
        // when selectionGate() REFUSES, so it must not claim the manual route
        // currently works. Everything it offers is conditional on the switch.
        const off = UNAVAILABLE_FOOTER.serverOff;
        expect(off, "the off branch promises the double-click path it is refusing")
            .not.toContain("still works");
        expect(off, "the house voice does not shout").not.toContain("!");
        // Two sentences, as the on branch is.
        expect(off.split(". ").length, "the off footer grew past two sentences").toBe(2);
        expect(UNAVAILABLE_FOOTER.doubleClickWorks.split(". ").length).toBe(2);
    });

    it("the switch really is operable, which is what makes pointing at it honest (control)", () => {
        // The premise of the two tests above, read off the panel rather than
        // assumed. This assertion INVERTED this turn: it used to require
        // `disabled={state === "unavailable"}` to be PRESENT, because the wording
        // then said the switch was unavailable.
        expect(
            hasDisabledAttribute(openingTag(read(PANEL), "className=\"track\"")),
            "the footer tells the user to use a switch the panel has disabled"
        ).toBe(false);
    });

    it("the panel renders the chosen sentence, not a literal one (wiring)", () => {
        const source = read(PANEL);
        expect(source).toMatch(/^import\s*\{[^}]*\bunavailableFooter\b[^}]*\}\s*from\s*"\.\.\/core\/modes";$/m);
        expect(source).toContain("{unavailableFooter(toggle, guildId, settings.store.includeDMs)}");
        // The exact JSX text node that shipped, as its own line. The doc-comments
        // beside the fix quote the same sentence across two lines on purpose, so
        // this matches the rendered copy coming back and not the note explaining
        // why it went.
        expect(
            source,
            "the fixed sentence is back in the JSX — the footer promises double-click to " +
            "users whose server is off again"
        ).not.toMatch(/^\s+Discord changed\. Translation is paused; double-click still works\.\s*$/m);
    });

    it("the wording lives in core/, where it can be exercised (control)", () => {
        // A sentence built inline in the JSX is a sentence this suite cannot
        // reach, and the behaviour tests would be measuring a function the panel
        // does not use.
        const modes = read(MODES);
        expect(modes).toContain("export function unavailableFooter(");
        expect(modes, "the footer stopped asking the gate and decided for itself")
            .toMatch(/return selectionGate\(toggle, \{ guildId \}, includeDMs\)\.allowed/);
    });
});
