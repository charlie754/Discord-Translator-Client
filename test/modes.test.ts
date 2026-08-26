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
 * settings.ts, and one line of test/usage.test.ts that located it with
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
 * The double-click / triple-click path had NO privacy guard whatsoever.
 * translateSelection() checked that the selection was non-empty and that the
 * click was inside message content, and then sent the text. Not the per-server
 * toggle, not DMs. With a billed provider selected, a double-click inside a
 * private message — or inside a server the user had deliberately switched off —
 * was a paid disclosure.
 */
describe("selectionGate — the double-click privacy gate", () => {
    const server = (guildId: string) => ({ guildId });
    const dm = { guildId: null };

    const withServerOn = (guildId: string) => {
        const t = new ToggleState();
        t.setOn(guildId, true);
        return t;
    };

    it("refuses in a server the user switched off, and says which case it is", () => {
        const gate = selectionGate(new ToggleState(), server("g1"), false);
        expect(gate.allowed).toBe(false);
        expect(gate.allowed === false && gate.reason).toBe(SELECTION_REFUSAL.serverOff);
    });

    it("allows in a server the user switched on", () => {
        expect(selectionGate(withServerOn("g1"), server("g1"), false).allowed).toBe(true);
    });

    it("refuses in a DM by default", () => {
        const gate = selectionGate(new ToggleState(), dm, false);
        expect(gate.allowed).toBe(false);
        expect(gate.allowed === false && gate.reason).toBe(SELECTION_REFUSAL.directMessage);
    });

    it("allows in a DM once the user opted in — the decision is theirs", () => {
        expect(selectionGate(new ToggleState(), dm, true).allowed).toBe(true);
    });

    it("refuses an unset includeDMs, exactly as the rendered path does", () => {
        expect(selectionGate(new ToggleState(), dm, undefined).allowed).toBe(false);
    });

    it("refuses when the conversation cannot be identified at all", () => {
        // A search result or a pinned popout is not a message row. Unknown is
        // NOT a DM and NOT a server; it is its own refusal.
        const gate = selectionGate(withServerOn("g1"), null, true);
        expect(gate.allowed).toBe(false);
        expect(gate.allowed === false && gate.reason).toBe(SELECTION_REFUSAL.unknownChannel);
    });

    it("an unknown conversation is not silently treated as a DM", () => {
        const unknown = selectionGate(new ToggleState(), null, true);
        const inDm = selectionGate(new ToggleState(), dm, true);
        expect(unknown.allowed).toBe(false);
        expect(inDm.allowed).toBe(true);
    });

    it("every refusal actually says something — silence reads as a broken plugin", () => {
        const reasons = Object.values(SELECTION_REFUSAL);
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
        // protect. A user who opted out of DMs after translating one must still
        // be able to read their own message back.
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: { guildId: null },
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

    it("refuses in a DM the user never opted into", () => {
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: { guildId: null }
        });
        expect(action.kind).toBe("refuse");
        expect(action.kind === "refuse" && action.reason).toBe(SELECTION_REFUSAL.directMessage);
    });

    it("a reverse target does NOT carry the request past the gate", () => {
        // reverseTo is a language, not a permission. If the fallback branch were
        // reachable before the gate, a translated DM would be the easiest way in.
        const action = selectionAction(new ToggleState(), {
            ...base,
            channel: { guildId: null },
            reverseTo: "de"
        });
        expect(action.kind).toBe("refuse");
    });

    it("refuses in a server that is switched off, whatever the cache holds", () => {
        const action = selectionAction(new ToggleState(), { ...base, reverseTo: "de" });
        expect(action.kind).toBe("refuse");
        expect(action.kind === "refuse" && action.reason).toBe(SELECTION_REFUSAL.serverOff);
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
