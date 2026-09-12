/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
    SELECTION_REFUSAL,
    type SelectionContext,
    selectionAction,
    selectionGate,
    ToggleState,
    translationEnabled
} from "../src/plugins/channelTranslator/core/modes";

const ctx = (over: Partial<Parameters<ToggleState["panelState"]>[0]> = {}) => ({
    guildId: "g1", patchesOk: true, breakerOpen: false, pending: 0, ...over
});

describe("ToggleState", () => {
    it("is off for an unknown server", () => {
        expect(new ToggleState().isOn("g1")).toBe(false);
    });

    it("remembers per server, not per channel", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.isOn("g1")).toBe(true);
        expect(t.isOn("g2")).toBe(false);
    });

    it("treats a null guild (DM) as always off", () => {
        const t = new ToggleState();
        t.setOn(null, true);
        expect(t.isOn(null)).toBe(false);
    });

    it("reports unavailable when patches did not match, whatever else is true", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ patchesOk: false }))).toBe("unavailable");
    });

    it("reports off when the server is not toggled on", () => {
        expect(new ToggleState().panelState(ctx())).toBe("off");
    });

    it("reports translating while work is pending", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ pending: 3 }))).toBe("translating");
    });

    it("reports degraded when the breaker is open", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ breakerOpen: true }))).toBe("degraded");
    });

    it("degraded outranks translating", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ breakerOpen: true, pending: 5 }))).toBe("degraded");
    });

    it("reports on when toggled on with nothing pending", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx())).toBe("on");
    });

    it("round-trips through serialise and deserialise", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(ToggleState.deserialise(t.serialise()).isOn("g1")).toBe(true);
    });

    it("loadFrom repopulates an existing instance", () => {
        const t = new ToggleState();
        t.setOn("old", true);
        const other = new ToggleState();
        other.setOn("new", true);
        t.loadFrom(other.serialise());
        expect(t.isOn("new")).toBe(true);
        expect(t.isOn("old")).toBe(false);
    });

    it("loadFrom on garbage clears state rather than throwing", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        t.loadFrom("not json");
        expect(t.isOn("g1")).toBe(false);
    });
});

/**
 * `includeDMs` was a control that governed nothing.
 *
 * It had exactly two mentions in the whole tree: its own definition in
 * settings.ts, and one line of the since-deleted test/usage.test.ts that
 * located it with
 * `src.indexOf("includeDMs: {")` to assert the ORDER settings appear in. Nothing
 * read the value. Meanwhile index.tsx's first-run notice told every new user
 * "Direct messages are excluded unless you opt in" and PRIVACY.md described the
 * setting as working — so the promise was false in both directions at once: a
 * user who opted in got nothing, and a user who never did was protected by an
 * unrelated accident (a DM has no guild id, so the per-server toggle happened to
 * refuse it).
 *
 * These are BEHAVIOUR tests, not a source scan. They fail if the parameter stops
 * changing the answer, whatever the source still looks like.
 */
describe("translationEnabled — the one DM/server decision", () => {
    const on = (guildId: string) => {
        const t = new ToggleState();
        t.setOn(guildId, true);
        return t;
    };

    it("translates a DM when the user opted in", () => {
        expect(translationEnabled(new ToggleState(), null, true)).toBe(true);
    });

    it("refuses a DM when the user did not", () => {
        expect(translationEnabled(new ToggleState(), null, false)).toBe(false);
    });

    it("fails CLOSED on an unset setting — undefined is not consent", () => {
        // A settings store read before hydration yields undefined. It must not
        // be read as "no objection".
        expect(translationEnabled(new ToggleState(), null, undefined)).toBe(false);
    });

    it("opting into DMs does not switch any server on", () => {
        // The two decisions are separate. A DM opt-in that quietly enabled every
        // server would be a far larger change than the one the user made.
        expect(translationEnabled(new ToggleState(), "g1", true)).toBe(false);
    });

    it("declining DMs does not switch a server off", () => {
        expect(translationEnabled(on("g1"), "g1", false)).toBe(true);
    });

    it("still answers per server, not globally", () => {
        expect(translationEnabled(on("g1"), "g2", false)).toBe(false);
    });

    it("the DM answer is decided ONLY by the setting, never by the toggle", () => {
        // setOn(null) is a no-op, so if the DM branch consulted the toggle at all
        // this would be false and opting in could never work.
        const t = new ToggleState();
        t.setOn(null, true);
        expect(t.isOn(null)).toBe(false);
        expect(translationEnabled(t, null, true)).toBe(true);
    });
});

/**
 * THE DOUBLE-CLICK / TRIPLE-CLICK GATE, AND WHAT IT DELIBERATELY STOPPED ASKING.
 *
 * WHERE IT STARTED. The path had no guard whatsoever: translateSelection()
 * checked that the selection was non-empty and that the click was inside message
 * content, and then sent the text. Not the per-server toggle, not DMs. With a
 * billed provider selected, a double-click inside a private message — or inside a
 * server the user had deliberately switched off — was a paid disclosure, and this
 * gate was built to close it.
 *
 * WHERE IT IS NOW, AND IT IS AN OPERATOR DECISION RATHER THAN A REGRESSION.
 * Ruling 2026-09-11: "make double-click/triple-click translation available
 * whether translate toggle is off", and, asked directly whether DMs were in
 * scope, "Yes - always translate". The two refusals that asked "did the user
 * permit this conversation?" are therefore gone, and the assertions that pinned
 * them are INVERTED here rather than deleted: each now states that the case is
 * allowed, deliberately, and names the decision that allows it. A deleted
 * assertion leaves no record that the behaviour was ever the other way.
 *
 * WHAT IS STILL REFUSED is text that cannot be traced to a conversation at all,
 * and that reasoning did not change: with no answer to "WHICH conversation is
 * this?", there is nothing true the plugin can say about the text.
 *
 * BOTH GESTURES ARE THIS ONE DECISION. A triple-click fires `dblclick` on its
 * second click and `click` with `detail === 3` on its third, and selection.ts
 * routes both into selectionAction(), which asks this function. There is no
 * second gate to test.
 */
describe("selectionGate — a deliberate gesture, in any identified conversation", () => {
    const server = (guildId: string) => ({ guildId });
    const dm = { guildId: null };

    const withServerOn = (guildId: string) => {
        const t = new ToggleState();
        t.setOn(guildId, true);
        return t;
    };

    it("ALLOWS in a server the user switched off — INVERTED by the 2026-09-11 ruling", () => {
        // This assertion used to require SELECTION_REFUSAL.serverOff. The operator
        // asked for the gesture to work "whether translate toggle is off", so what
        // it now guarantees is that a switched-off server does not refuse a
        // deliberate selection. The switch governs CHANNEL translation; this does
        // not go through it.
        const toggle = new ToggleState();
        expect(toggle.isOn("g1"), "the fixture is already on — the assertion is vacuous").toBe(false);
        expect(selectionGate(toggle, server("g1"), false).allowed).toBe(true);
    });

    it("allows in a server the user switched on", () => {
        expect(selectionGate(withServerOn("g1"), server("g1"), false).allowed).toBe(true);
    });

    it("ALLOWS in a DM with the opt-in off — INVERTED, and the operator chose it explicitly", () => {
        // This used to require SELECTION_REFUSAL.directMessage. Asked whether DMs
        // should be covered, the operator answered "Yes - always translate", so
        // what it now guarantees is that a DM refuses nothing on this path. The
        // consequence is written into PRIVACY.md rather than left to be found.
        expect(selectionGate(new ToggleState(), dm, false).allowed).toBe(true);
    });

    it("allows in a DM once the user opted in — the decision was theirs either way", () => {
        expect(selectionGate(new ToggleState(), dm, true).allowed).toBe(true);
    });

    it("ALLOWS an unset includeDMs too — INVERTED, because the gate no longer reads it", () => {
        // It used to fail closed here, matching the rendered path, because a
        // settings store read before hydration yields undefined. The gate does not
        // consult the value at all now, so there is no open/closed to fail either
        // way — and translationEnabled(), which DOES consult it, still fails closed
        // on undefined. That assertion is above and is untouched.
        expect(selectionGate(new ToggleState(), dm, undefined).allowed).toBe(true);
    });

    it("refuses when the conversation cannot be identified at all — KEPT", () => {
        // A search result or a pinned popout is not a message row. Unknown is NOT
        // a DM and NOT a server; it is its own refusal, and it is the only one
        // left. The reasoning survived the ruling because it is not about
        // permission: with no conversation identified there is nothing true to say.
        const gate = selectionGate(withServerOn("g1"), null, true);
        expect(gate.allowed).toBe(false);
        expect(gate.allowed === false && gate.reason).toBe(SELECTION_REFUSAL.unknownChannel);
    });

    it("an unknown conversation is still not treated as a DM", () => {
        // The two used to differ because a DM was refused for its own reason and an
        // unknown surface for another. They differ for a sharper reason now: one is
        // allowed and the other is not.
        const unknown = selectionGate(new ToggleState(), null, true);
        const inDm = selectionGate(new ToggleState(), dm, true);
        expect(unknown.allowed).toBe(false);
        expect(inDm.allowed).toBe(true);
    });

    it("the toggle and the DM setting are NOT inputs to this gate (the ruling, swept)", () => {
        // The ruling is "whatever the toggle says, whatever includeDMs says", which
        // is a statement about INVARIANCE and cannot be made by any single case.
        // This is also why selectionGate() still takes both arguments: a function
        // that could not be handed them could not be shown to ignore them.
        const off = new ToggleState();
        const on = withServerOn("g1");
        for (const toggle of [off, on]) {
            for (const includeDMs of [true, false, undefined]) {
                for (const channel of [server("g1"), server("g2"), dm]) {
                    expect(
                        selectionGate(toggle, channel, includeDMs).allowed,
                        `refused guildId=${String(channel.guildId)} ` +
                        `toggledOn=${String(toggle.isOn("g1"))} includeDMs=${String(includeDMs)}`
                    ).toBe(true);
                }
                // …and the one refusal is equally invariant in the other direction.
                expect(
                    selectionGate(toggle, null, includeDMs).allowed,
                    "an unidentifiable conversation was allowed through"
                ).toBe(false);
            }
        }
        // Control: the sweep really did vary the toggle, so "invariant" is a
        // finding and not an artefact of two identical fixtures.
        expect(off.isOn("g1")).toBe(false);
        expect(on.isOn("g1")).toBe(true);
    });

    it("there is exactly ONE refusal left, and it is the unknown-conversation one", () => {
        // The two that went are unreachable, so leaving the constants behind would
        // be dead wording a future change could wire back up by accident. This
        // fails if either returns.
        expect(Object.keys(SELECTION_REFUSAL)).toEqual(["unknownChannel"]);
        expect(SELECTION_REFUSAL).not.toHaveProperty("serverOff");
        expect(SELECTION_REFUSAL).not.toHaveProperty("directMessage");
    });

    it("every refusal actually says something — silence reads as a broken plugin", () => {
        const reasons = Object.values(SELECTION_REFUSAL);
        expect(reasons.length, "there are no refusals at all to check").toBeGreaterThan(0);
        for (const reason of reasons) expect(reason.length).toBeGreaterThan(20);
        expect(new Set(reasons).size).toBe(reasons.length);
    });
});

/**
 * render.tsx renders `Translated to XX — double-click to see the original`, and
 * index.tsx repeats the promise in its patch-failure notice. Following that
 * instruction used to reach a BILLED reverse round-trip that reconstructed an
 * approximation of text the plugin still held: render.tsx's Mode A hands the
 * renderer a clone and leaves Discord's own store untouched.
 */
describe("selectionAction — what a double-click actually does", () => {
    const base: SelectionContext = {
        channel: { guildId: "g1" },
        includeDMs: false,
        heldOriginal: null,
        reverseTo: null,
        targetLanguage: "en"
    };

    const serverOn = () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        return t;
    };

    it("shows a held original instead of translating it back", () => {
        const action = selectionAction(serverOn(), {
            ...base,
            heldOriginal: "das Original",
            reverseTo: "de"
        });
        expect(action.kind).toBe("showHeldOriginal");
        expect(action.kind === "showHeldOriginal" && action.text).toBe("das Original");
    });

    it("a held original is served even where a translation would be refused", () => {
        // Nothing leaves the client on this branch, so the gate has nothing to
        // protect. The refusing fixture is now an UNIDENTIFIABLE conversation
        // rather than an opted-out DM, because since the 2026-09-11 ruling a DM is
        // allowed and would no longer have demonstrated the ordering at all. A
        // user must still be able to read back text this plugin already holds even
        // where it cannot tell which conversation the click landed in.
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: null,
            includeDMs: false,
            heldOriginal: "das Original"
        });
        expect(action.kind).toBe("showHeldOriginal");
    });

    it("falls through to a real request only when the original is genuinely gone", () => {
        const action = selectionAction(serverOn(), { ...base, reverseTo: "de" });
        expect(action.kind).toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("de");
    });

    it("translates forward into the target language when nothing is reversed", () => {
        const action = selectionAction(serverOn(), base);
        expect(action.kind).toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("en");
    });

    it("TRANSLATES in a DM the user never opted into — INVERTED by the ruling", () => {
        // It used to refuse with SELECTION_REFUSAL.directMessage. What this now
        // guarantees is the operator's answer to "should DMs also be covered?",
        // which was "Yes - always translate": the gesture is the permission, and
        // the selection goes to the provider in a DM with includeDMs false.
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: { guildId: null }
        });
        expect(action.kind).toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("en");
    });

    it("a reverse target does NOT carry the request past the gate", () => {
        // reverseTo is a language, not a permission. If the fallback branch were
        // reachable before the gate, a translated message on an unidentifiable
        // surface would be the easiest way in. The refusing fixture changed from a
        // DM to an unidentifiable conversation for the reason above — a DM is
        // allowed now, so it can no longer prove an ordering.
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: null,
            reverseTo: "de"
        });
        expect(action.kind).toBe("refuse");
        expect(action.kind === "refuse" && action.reason).toBe(SELECTION_REFUSAL.unknownChannel);
    });

    it("TRANSLATES in a server that is switched off — INVERTED by the ruling", () => {
        // It used to refuse with SELECTION_REFUSAL.serverOff. What this now
        // guarantees is the operator's instruction verbatim — the gesture works
        // "whether translate toggle is off" — including the reverse direction,
        // which is the case a user hits most: they translated a channel, switched
        // it off, and double-clicked a line that is still showing as translated.
        const action = selectionAction(new ToggleState(), { ...base, reverseTo: "de" });
        expect(action.kind).toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("de");
    });

    it("translates a DM once opted in", () => {
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: { guildId: null },
            includeDMs: true
        });
        expect(action.kind).toBe("translate");
    });

    it("refuses when the click cannot be traced to a conversation", () => {
        const action = selectionAction(serverOn(), { ...base, channel: null });
        expect(action.kind).toBe("refuse");
        expect(action.kind === "refuse" && action.reason).toBe(SELECTION_REFUSAL.unknownChannel);
    });

    it("an empty string is a held original — falsy is not absent", () => {
        // `if (heldOriginal)` instead of `!== null` would send an empty original
        // to a paid provider. The distinction is worth a test.
        const action = selectionAction(serverOn(), { ...base, heldOriginal: "" });
        expect(action.kind).toBe("showHeldOriginal");
    });
});

/**
 * 🔴 THE REGRESSION THE RULING WAS ASKED FOR, IN THE EXACT STATE THE OPERATOR
 * DESCRIBED.
 *
 * "Make double-click/triple-click translation available whether translate toggle
 * is off." Asked whether DMs should also be covered: "Yes - always translate."
 *
 * So the fixture is the shipped starting state and nothing else: NO server
 * switched on — which is every start, since the toggle stopped surviving one —
 * and `includeDMs` at its shipped default of false. Both gestures are covered by
 * one assertion each, because a triple-click fires `dblclick` on its second click
 * and `click` with `detail === 3` on its third, and selection.ts routes both into
 * selectionAction(). There is no separate triple-click decision to test.
 *
 * REVERT selectionGate()'s BODY AND THIS GOES RED, with `refuse` and
 * SELECTION_REFUSAL.serverOff for the channel and SELECTION_REFUSAL.directMessage
 * for the DM — which is how it was checked before it was believed.
 */
describe("the ruling: a deliberate gesture works with everything switched off", () => {
    const base: Omit<SelectionContext, "channel"> = {
        includeDMs: false,
        heldOriginal: null,
        reverseTo: null,
        targetLanguage: "en"
    };

    /** The shipped starting state: nothing on, nothing opted into. */
    const nothingOn = () => {
        const toggle = new ToggleState();
        // Controls: without these, every assertion below could be passing because
        // the fixture was already permissive.
        expect(toggle.isOn("g1"), "the fixture has a server switched on").toBe(false);
        expect(base.includeDMs, "the fixture has already opted into DMs").toBe(false);
        return toggle;
    };

    it("a double-click in a SERVER CHANNEL whose toggle is off resolves to translate", () => {
        const action = selectionAction(nothingOn(), { ...base, channel: { guildId: "g1" } });
        expect(action.kind, "the gesture is refused in a switched-off server").toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("en");
    });

    it("a double-click in a DM with includeDMs off resolves to translate", () => {
        const action = selectionAction(nothingOn(), { ...base, channel: { guildId: null } });
        expect(action.kind, "the gesture is refused in a direct message").toBe("translate");
        expect(action.kind === "translate" && action.to).toBe("en");
    });

    it("…and in a DM with includeDMs UNSET, which is what a pre-hydration store returns", () => {
        const action = selectionAction(nothingOn(), {
            ...base,
            channel: { guildId: null },
            includeDMs: undefined
        });
        expect(action.kind).toBe("translate");
    });

    it("neither of those opened the AUTOMATIC path, in the same world (control)", () => {
        // The half that makes this a widening of ONE path rather than of the
        // plugin. Same toggle, same setting, same moment.
        const toggle = nothingOn();
        expect(translationEnabled(toggle, "g1", false), "automatic translation opened for a server").toBe(false);
        expect(translationEnabled(toggle, null, false), "automatic translation opened for a DM").toBe(false);
    });

    it("an unidentifiable conversation is still refused in that same state (control)", () => {
        // Proof the gate is still a gate rather than a pass-through. If this ever
        // goes green as "translate", the remaining refusal has been lost and text
        // of unknown origin is being sent.
        const action = selectionAction(nothingOn(), { ...base, channel: null });
        expect(action.kind).toBe("refuse");
        expect(action.kind === "refuse" && action.reason).toBe(SELECTION_REFUSAL.unknownChannel);
    });
});

/**
 * 🔴 THE GUARANTEE MOST AT RISK FROM THE RULING, PINNED AGAINST THE SPECIFIC WAY
 * IT WOULD HAVE BEEN BROKEN.
 *
 * The cheapest way to make "double-click works whether the toggle is off" pass is
 * to widen translationEnabled(), because the gate used to delegate its whole
 * answer to it. That would have switched AUTOMATIC channel translation on for
 * every server and every DM — the exact opposite of the v0.2.13 decision that
 * turned it off — and a suite that only asked whether the gesture had opened
 * would have reported it as a clean pass.
 *
 * translationEnabled() has four callers and three of them start traffic on a
 * keystroke the user never made: render.tsx's two entry points, once per message
 * rendered, and state.ts's repaintChannel(), which enqueues a whole channel's
 * loaded scrollback at once. The fourth, selection.ts's isRenderedTranslated(),
 * answers "is the text on screen already one of ours?" — so widening it would
 * also send the reverse path looking for an original behind text that was never
 * translated.
 *
 * The describe above states that the GESTURE opened. This one states that nothing
 * else did.
 */
describe("the automatic path did NOT widen with the gesture", () => {
    it("a switched-off server is still refused automatic translation", () => {
        expect(translationEnabled(new ToggleState(), "g1", false)).toBe(false);
    });

    it("…and stays refused however the DM opt-in is set", () => {
        // A DM opt-in must not reach servers. It never did; this is the assertion
        // that says the gate change did not make it start.
        for (const includeDMs of [true, false, undefined]) {
            expect(
                translationEnabled(new ToggleState(), "g1", includeDMs),
                `a server became automatic with includeDMs=${String(includeDMs)}`
            ).toBe(false);
        }
    });

    it("a DM with includeDMs off is still refused automatic translation", () => {
        expect(translationEnabled(new ToggleState(), null, false)).toBe(false);
        expect(translationEnabled(new ToggleState(), null, undefined)).toBe(false);
    });

    it("🔴 the two paths genuinely DISAGREE now, which is the entire change", () => {
        // THE ONE ASSERTION THAT CANNOT BE SATISFIED BY EITHER MISTAKE. If the gate
        // is narrowed back it fails on the second expect; if translationEnabled()
        // is widened it fails on the first. Every other test in this file passes in
        // at least one of those two broken worlds.
        const toggle = new ToggleState();
        for (const guildId of ["g1", null]) {
            for (const includeDMs of [false, undefined]) {
                expect(
                    translationEnabled(toggle, guildId, includeDMs),
                    `automatic translation is ON for guildId=${String(guildId)} ` +
                    `includeDMs=${String(includeDMs)} — the rendered path widened`
                ).toBe(false);
                expect(
                    selectionGate(toggle, { guildId }, includeDMs).allowed,
                    `the gesture is REFUSED for guildId=${String(guildId)} ` +
                    `includeDMs=${String(includeDMs)} — the ruling was undone`
                ).toBe(true);
            }
        }
    });

    it("switching a server on still turns the automatic path on (control)", () => {
        // Without this the assertions above would pass on a build where automatic
        // translation was broken outright rather than merely off by default.
        const toggle = new ToggleState();
        toggle.setOn("g1", true);
        expect(translationEnabled(toggle, "g1", false)).toBe(true);
    });

    it("opting into DMs still turns the automatic path on for a DM (control)", () => {
        expect(translationEnabled(new ToggleState(), null, true)).toBe(true);
    });
});
