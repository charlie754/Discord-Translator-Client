/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { ToggleState } from "../src/plugins/channelTranslator/core/modes";

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
