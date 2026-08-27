/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The two rules that survived core/usage.ts.
 *
 * These assertions lived in test/usage.test.ts, whose subject was money: a spend
 * meter, a monthly character cap, and the two providers billed to the user's own
 * key. Those are gone — every surviving provider is free — so the meter, the
 * cap, the cap banner and their tests went with them.
 *
 * PermanentFailureRegistry and ClickBurstGate did NOT go. They were filed under
 * "spend" only because money was the loudest consequence of making a request
 * that should not have been made. Take the money away and both rules still hold
 * for the reasons that were always the real ones: a request that can only fail
 * again is waste — of the free endpoint's rate budget, of an Apps Script
 * deployment's daily allowance, and of a scheduler slot — and one gesture should
 * produce one answer rather than two, the second of which throws the first away.
 *
 * The code moved to core/requestBookkeeping.ts. These tests moved with it,
 * unchanged in what they assert.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    CLICK_BURST_MS,
    ClickBurstGate,
    MAX_TRACKED_PERMANENT_FAILURES,
    PermanentFailureRegistry
} from "../src/plugins/channelTranslator/core/requestBookkeeping";

/**
 * The poison-message loop, unit-testable because the thing that closes it lives
 * in core/. state.ts itself cannot be imported here — it pulls
 * @api/MessageUpdater and @webpack/common, which need a running client — so the
 * wiring is asserted separately by test/providerChokepoint.test.ts.
 */
describe("PermanentFailureRegistry — the pointless retry loop", () => {
    it("remembers a marked key and forgets nothing else", () => {
        const registry = new PermanentFailureRegistry();
        expect(registry.has("abc:en")).toBe(false);
        registry.mark("abc:en");
        expect(registry.has("abc:en")).toBe(true);
        expect(registry.has("abc:ja")).toBe(false);
        expect(registry.has("def:en")).toBe(false);
    });

    it("marking twice is not two entries", () => {
        const registry = new PermanentFailureRegistry();
        registry.mark("abc:en");
        registry.mark("abc:en");
        expect(registry.size).toBe(1);
    });

    it("clear() forgets everything, which is what a new provider or endpoint must do", () => {
        const registry = new PermanentFailureRegistry();
        registry.mark("abc:en");
        registry.mark("def:en");
        registry.clear();
        expect(registry.size).toBe(0);
        expect(registry.has("abc:en")).toBe(false);
    });

    it("is bounded — it cannot grow without limit across a long session", () => {
        const registry = new PermanentFailureRegistry(3);
        registry.mark("a");
        registry.mark("b");
        registry.mark("c");
        registry.mark("d");

        expect(registry.size).toBe(3);
        // "a" is the oldest and is the one dropped.
        expect(registry.has("a")).toBe(false);
        expect(registry.has("b")).toBe(true);
        expect(registry.has("d")).toBe(true);
    });

    it("re-marking moves an entry to the back, so a message that keeps failing is not evicted first", () => {
        const registry = new PermanentFailureRegistry(2);
        registry.mark("a");
        registry.mark("b");
        registry.mark("a");
        registry.mark("c");

        expect(registry.has("b")).toBe(false);
        expect(registry.has("a")).toBe(true);
        expect(registry.has("c")).toBe(true);
    });

    it("defaults to the same bound as the translation cache, so the two cannot drift", () => {
        expect(MAX_TRACKED_PERMANENT_FAILURES).toBe(5_000);
        const registry = new PermanentFailureRegistry();
        for (let i = 0; i < MAX_TRACKED_PERMANENT_FAILURES + 10; i++) registry.mark(`k${i}`);
        expect(registry.size).toBe(MAX_TRACKED_PERMANENT_FAILURES);
    });

    it("would notice an unbounded registry (positive control)", () => {
        // If mark() ever stopped evicting, this is the shape that would fail.
        const registry = new PermanentFailureRegistry(2);
        registry.mark("a");
        registry.mark("b");
        registry.mark("c");
        expect(registry.size).not.toBe(3);
    });
});

/**
 * ONE TRIPLE-CLICK USED TO BUY TWO TRANSLATIONS — and with nothing billed it
 * still SPENDS two.
 *
 * A triple-click is not a separate event from a double-click: the browser fires
 * `dblclick` on the second click and then `click` with `detail === 3` on the
 * third, and selection.ts translates on both. So the gesture that selects a
 * whole line issued two requests and threw the first answer away when the second
 * popover replaced it.
 *
 * It cannot be fixed by cancelling: a request that has already gone cannot be
 * recalled — the endpoint has already been asked. The first click of the burst
 * has to be HELD, and dropped if a later click in the same gesture arrives.
 */
describe("ClickBurstGate — one gesture, one translation", () => {
    /** A wait the test drives by hand, so nothing here depends on a real timer. */
    function manualWait() {
        const waiting: Array<() => void> = [];
        return {
            wait: (_ms: number) => new Promise<void>(resolve => { waiting.push(resolve); }),
            release: () => { for (const resolve of waiting.splice(0)) resolve(); },
            get held() { return waiting.length; }
        };
    }

    it("drops the double-click's request when the third click of the same gesture arrives", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const doubleClick = gate.settle();     // dblclick: held, nothing sent yet
        expect(clock.held).toBe(1);
        gate.supersede();                      // the third click, translating now
        clock.release();

        expect(await doubleClick).toBe(false);
    });

    it("lets a plain double-click through when no third click follows", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const doubleClick = gate.settle();
        clock.release();

        expect(await doubleClick).toBe(true);
    });

    it("counts the sends: one gesture, one translation, and it is the one the user meant", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);
        const sent: string[] = [];

        // The gesture, in the order the browser fires it.
        const fromDoubleClick = (async () => {
            if (await gate.settle()) sent.push("word");
        })();
        gate.supersede();
        sent.push("whole line");   // the third click sends immediately
        clock.release();
        await fromDoubleClick;

        // The block, not the word the double-click had selected — and only it.
        expect(sent).toEqual(["whole line"]);
    });

    it("a later gesture supersedes an earlier one still waiting, rather than both sending", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const first = gate.settle();
        const second = gate.settle();
        clock.release();

        expect(await first).toBe(false);
        expect(await second).toBe(true);
    });

    it("abandon() drops a held click, so removing the handlers cannot send afterwards", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const held = gate.settle();
        gate.abandon();
        clock.release();

        expect(await held).toBe(false);
    });

    it("waits the burst window it was given, and defaults to the multi-click interval", async () => {
        const asked: number[] = [];
        const gate = new ClickBurstGate(undefined, async ms => { asked.push(ms); });
        expect(await gate.settle()).toBe(true);
        expect(asked).toEqual([CLICK_BURST_MS]);
        expect(CLICK_BURST_MS).toBe(500);
    });

    it("would notice a gate that never drops anything (positive control)", async () => {
        // The shape of the bug: both clicks of one gesture translate.
        const alwaysSpends = { settle: async () => true, supersede: () => { /* nothing */ } };
        const sent: string[] = [];
        const fromDoubleClick = (async () => {
            if (await alwaysSpends.settle()) sent.push("word");
        })();
        alwaysSpends.supersede();
        sent.push("whole line");
        await fromDoubleClick;
        expect(sent).toHaveLength(2);
    });
});

/**
 * The half of the rule that lives in a file needing a DOM and a running client:
 * selection.ts must route BOTH click handlers through the gate. It cannot be
 * imported here — it pulls @webpack/common and ./settings — so this is a source
 * scan, and every assertion carries a positive control.
 */
describe("what selection.ts actually ships", () => {
    const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
    const SELECTION = join(PLUGIN, "selection.ts");

    const read = (path: string) => readFileSync(path, "utf8");

    /** Code, not commentary: every line whose first non-space characters are not a comment. */
    function codeOnly(source: string): string {
        return source
            .split("\n")
            .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
            .join("\n");
    }

    it("the file it claims to scan exists and is not empty", () => {
        expect(read(SELECTION).length, `empty: ${SELECTION}`).toBeGreaterThan(0);
    });

    it("codeOnly() strips comments and keeps code (positive control)", () => {
        expect(codeOnly("// clickBurst.supersede();\nclickBurst.abandon();")).not.toContain("supersede");
        expect(codeOnly(" * clickBurst.supersede();\nreal();")).toContain("real();");
    });

    it("selection.ts routes both click handlers through the burst gate", () => {
        const code = codeOnly(read(SELECTION));
        expect(code).toMatch(/import\s*\{[^}]*\bClickBurstGate\b[^}]*\}\s*from/);
        expect(code).toContain("new ClickBurstGate(");
        // The third click supersedes before it sends …
        expect(code).toContain("clickBurst.supersede();");
        // … and the request path holds.
        expect(code).toContain("clickBurst.settle()");
    });

    it("the hold is on the request path and NOT on the local ones", () => {
        // Showing a held original costs no request at all. Delaying it by half a
        // second to protect a request that is not being made would be a
        // regression in the one interaction the UI advertises.
        const code = codeOnly(read(SELECTION));
        const held = code.indexOf("action.kind === \"showHeldOriginal\"");
        const refuse = code.indexOf("action.kind === \"refuse\"");
        const hold = code.indexOf("clickBurst.settle()");
        const provider = code.indexOf("translationProvider()");
        expect(held).toBeGreaterThan(-1);
        expect(refuse).toBeGreaterThan(-1);
        expect(hold).toBeGreaterThan(-1);
        expect(provider).toBeGreaterThan(-1);
        expect(hold).toBeGreaterThan(held);
        expect(hold).toBeGreaterThan(refuse);
        expect(hold).toBeLessThan(provider);
    });

    it("removing the handlers abandons anything still held", () => {
        const code = codeOnly(read(SELECTION));
        const remove = code.indexOf("export function removeSelectionHandler");
        expect(remove).toBeGreaterThan(-1);
        expect(code.slice(remove)).toContain("clickBurst.abandon();");
    });
});
