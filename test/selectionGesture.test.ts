/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE REAL CORE MODULES, for the reason test/toggleDoesNotSurviveRestart.test.ts
// records: core/ resolves fine here, and a stubbed ClickBurstGate or Scheduler
// would make this file a test of the stub. The two questions below are "does the
// real burst gate still let a genuine double-click through once a forged one has
// been refused" and "what does the real scheduler's RETRY paint after the user
// has dismissed the popover", and neither can be asked of a hand-written double.
import { selectionAction, ToggleState, translationEnabled } from "../src/plugins/channelTranslator/core/modes";
import { protect, restore } from "../src/plugins/channelTranslator/core/protect";
import { CLICK_BURST_MS, ClickBurstGate } from "../src/plugins/channelTranslator/core/requestBookkeeping";
import { Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/**
 * TWO DEFECTS IN selection.ts's TWO CLICK HANDLERS, BOTH EXECUTED RATHER THAN
 * SCANNED.
 *
 * 1. A SYNTHETIC CLICK WAS A GESTURE. `isTrusted` appeared nowhere in the plugin,
 *    so an untrusted `dblclick` — and an untrusted `click` with `detail === 3` —
 *    reached translateSelection() and sent the selected text to a third party
 *    with nobody having clicked. That was survivable while the path also asked
 *    the per-server toggle and the DM opt-in, because a forged click still had to
 *    get past two decisions the user had made. The 2026-09-11 ruling took both
 *    out of the gate on the grounds that the gesture is a DELIBERATE USER ACTION,
 *    which left the gesture as the only permission — and nothing checking that it
 *    was one.
 *
 * 2. A DISMISSED POPOVER CAME BACK. scheduler.run() retries a transient failure,
 *    and dismissal removed the host element and nothing else, so a retry that
 *    succeeded after the user clicked away rebuilt the popover for a gesture they
 *    had abandoned. Same hazard on teardown: an attempt already sent when the
 *    plugin was switched off could still paint onto a client with no translator
 *    running. selection.ts now gives each gesture a GENERATION and drops any
 *    render whose token is stale.
 *
 * WHY THIS FILE EXECUTES selection.ts WHEN EVERY OTHER GUARD OVER IT IS A SOURCE
 * SCAN. The existing scans (test/selectionPrivacy.test.ts,
 * test/requestBookkeeping.test.ts, test/providerChokepoint.test.ts) all record
 * the same constraint: selection.ts imports @webpack/common and ./settings, which
 * do not resolve under vitest. That constraint is about the IMPORTS, not about the
 * file — so it is answered the way test/toggleDoesNotSurviveRestart.test.ts
 * answers it for state.ts: compile the real source, evaluate it against stubs, and
 * hand it a DOM small enough to be honest about. "Does an untrusted event reach
 * the provider?" and "what is on screen after a dismissal?" are questions about
 * behaviour, and a scan for the presence of a line cannot answer either — the same
 * information could arrive, or fail to, through any of half a dozen edits.
 *
 * WHAT A SCAN IS STILL USED FOR, AND IT IS ONE THING. That the trust check is the
 * FIRST statement of each handler is a property of the source, not of any single
 * behaviour: a guard placed one line lower still refuses the forged click while
 * letting it run supersede() first. That assertion is explicitly labelled below.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const SELECTION_PATH = join(PLUGIN, "selection.ts");
const SELECTION_SOURCE = readFileSync(SELECTION_PATH, "utf8");

/**
 * The popover's element id, mirroring selection.ts's own POPOVER_ID. Asserted
 * against the source in the instrument checks, so a rename cannot leave this file
 * quietly measuring an element nobody creates.
 */
const POPOVER_ID = "channel-translator-popover";

/* ------------------------------------------------------------------ fake DOM */

/**
 * A DOM that answers EXACTLY what selection.ts asks and throws on anything else.
 *
 * There is no jsdom in this project's dependencies, and adding one to test two
 * handlers would be the larger change. The rule that keeps this honest is the
 * same one the other harnesses here use for their module stubs: an unmodelled
 * call is a loud failure, never a silent undefined, because a fake that shrugs
 * lets the file under test grow a DOM dependency this suite is no longer
 * exercising.
 */
interface PopNode { textContent: string; }

class FakeShadowRoot {
    innerHTML = "";
    /** The single node selection.ts writes the popover's text into. */
    readonly pop: PopNode = { textContent: "" };

    querySelector(selector: string): PopNode {
        if (selector !== ".pop") {
            throw new Error(`the fake shadow root was asked for ${selector}, which it does not model`);
        }
        return this.pop;
    }
}

class FakeElement {
    id = "";
    style = { cssText: "" };
    shadow: FakeShadowRoot | null = null;

    constructor(readonly tagName: string, private readonly doc: FakeDocument) {}

    attachShadow(_init: { mode: string; }): FakeShadowRoot {
        this.shadow = new FakeShadowRoot();
        return this.shadow;
    }

    remove(): void {
        this.doc.detach(this);
    }
}

class FakeDocument {
    /** Everything currently in the document, in insertion order. */
    readonly attached: FakeElement[] = [];
    private readonly listeners = new Map<string, Array<(event: any) => void>>();
    readonly body = { appendChild: (el: FakeElement) => { this.attached.push(el); } };

    createElement(tagName: string): FakeElement {
        return new FakeElement(tagName, this);
    }

    getElementById(id: string): FakeElement | null {
        return this.attached.find(el => el.id === id) ?? null;
    }

    detach(el: FakeElement): void {
        const at = this.attached.indexOf(el);
        if (at > -1) this.attached.splice(at, 1);
    }

    addEventListener(type: string, fn: (event: any) => void): void {
        const forType = this.listeners.get(type) ?? [];
        forType.push(fn);
        this.listeners.set(type, forType);
    }

    removeEventListener(type: string, fn: (event: any) => void): void {
        const forType = this.listeners.get(type) ?? [];
        const at = forType.indexOf(fn);
        if (at > -1) forType.splice(at, 1);
    }

    /** Fire every listener registered for `type`, over a copy, as the browser does. */
    dispatch(type: string, event: unknown): void {
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    }

    listenerCount(type: string): number {
        return (this.listeners.get(type) ?? []).length;
    }
}

/**
 * The element a click landed on, answering only the three selectors selection.ts
 * asks for: the message row, the "is this inside message content" test, and the
 * bilingual lower row. It is deliberately NOT one of our translations, so
 * originalFor() and reverseTargetFor() both decline and the decision reaching
 * selectionAction() is a plain forward translation.
 */
function messageTarget(channelId = "chan-1", messageId = "msg-1") {
    const row = { id: `chat-messages-${channelId}-${messageId}` };
    return {
        closest(selector: string) {
            if (selector.includes("chat-messages-")) return row;
            if (selector === ".ct-translated-row") return null;
            throw new Error(`the fake target was asked for ${selector}, which it does not model`);
        }
    };
}

/**
 * A click event of exactly the shape the two handlers read.
 *
 * A PLAIN OBJECT, AND THAT IS THE ONLY WAY THE POSITIVE HALF IS TESTABLE AT ALL.
 * `isTrusted` is read-only on a real Event — a browser sets it, and neither page
 * script nor jsdom can hand out a trusted one — so "a trusted double-click still
 * works" cannot be asserted against a constructed DOM event anywhere. Here both
 * halves are expressible, at the cost that "trusted" means "an object whose
 * isTrusted is true" rather than "a click a human made". The handlers cannot tell
 * those apart, and neither can anything else in a page: that is precisely why the
 * flag is set by the browser and not by the caller.
 */
function clickEvent(opts: { isTrusted: boolean; detail?: number; target?: unknown; }) {
    return {
        isTrusted: opts.isTrusted,
        detail: opts.detail ?? 2,
        target: opts.target ?? messageTarget(),
        clientX: 40,
        clientY: 80
    };
}

/* ------------------------------------------------------------------- harness */

/** The real burst gate with its clock collapsed, so a held click resolves at once. */
class InstantBurstGate extends ClickBurstGate {
    constructor() {
        super(0, () => Promise.resolve());
    }
}

/**
 * THE TWO PLACES THE REQUEST PATH ABORTS AN ABANDONED GESTURE, as patch anchors.
 *
 * Named here because the controls below need them separately AND together. The
 * first is what keeps a gesture whose generation went stale during the burst hold
 * from obtaining a provider and taking a scheduler slot at all; the second is what
 * stops the SEND when the dismissal lands later — while scheduler.run() waits for
 * one of three concurrency slots, or during the backoff before a retry. Remove one
 * and the other still catches the text, so the silent-send reproduction removes both.
 */
const ABORT_AFTER_THE_HOLD: SourcePatch = {
    find: "    if (!popoverIsCurrent(popover)) return;\n",
    replace: ""
};
const ABORT_BEFORE_THE_SEND: SourcePatch = {
    find: "            if (!popoverIsCurrent(popover)) return null;\n",
    replace: ""
};

/**
 * The real gate with its hold PARKED until the test releases it.
 *
 * InstantBurstGate cannot be used for the third defect below, and the reason is the
 * defect: its window is 0 ms, so the gesture is through the gate before anything can
 * be dispatched, and the whole bug lives in the window. This keeps the shipped
 * epoch arithmetic — settle() is the real one, and what decides whether a held click
 * may still send — and substitutes only the sleep, exactly as the harness's Scheduler
 * substitutes its own.
 *
 * windows() records the number settle() actually asked to wait, so a test cannot
 * quietly hold for 0 ms and still describe itself as spanning the burst.
 */
function heldBurstGate() {
    let release: () => void = () => {};
    const parked = new Promise<void>(resolve => { release = resolve; });
    const windows: number[] = [];

    class HeldBurstGate extends ClickBurstGate {
        constructor() {
            super(CLICK_BURST_MS, (ms: number) => {
                windows.push(ms);
                return parked;
            });
        }
    }

    return { Gate: HeldBurstGate, release: () => release(), windows: () => [...windows] };
}

interface SelectionModule {
    installSelectionHandler(): void;
    removeSelectionHandler(): void;
}

interface Harness {
    exports: SelectionModule;
    doc: FakeDocument;
    /** Calls to the provider chokepoint: one per gesture that got as far as wanting a request. */
    providerCalls: () => number;
    /** One entry per translate() call that actually went out — i.e. per ATTEMPT, retries included. */
    sent: () => string[];
    /** The popover's text, or null when there is no popover on screen. */
    popover: () => string | null;
    /**
     * Change what the user has selected, as a real triple-click does when it
     * widens a word to the whole block. Lets one test tell WHICH click's request
     * went out, which is the only way the supersede-ordering control below can
     * discriminate at all.
     */
    setSelection: (text: string) => void;
    /** Every module id the compiled file required, in order. */
    required: string[];
}

/** One edit to the real source, made to prove an assertion below can fail. */
interface SourcePatch { find: string; replace: string; matches?: number; }

interface LoadOptions {
    selectedText?: string;
    /**
     * Removes or rewrites an exact substring of the real source, to prove an
     * assertion below can fail. It THROWS unless the anchor is found exactly
     * `matches` times (default 1): a control that silently patches nothing would
     * report the defect as fixed while measuring nothing at all, and one that
     * patched 1 of 2 handlers would leave half the reproduction in place.
     *
     * ONE PATCH, OR SEVERAL APPLIED IN ORDER. The list is not a convenience: the
     * request path aborts an abandoned gesture in TWO places — after the burst hold
     * and again inside scheduler.run() — and removing either alone does not reproduce
     * the silent send, because the other still catches the text. A control that
     * stripped one line would report "nothing was sent" while measuring the OTHER
     * guard, which is the exact shape of a control that certifies itself.
     */
    patchSource?: SourcePatch | SourcePatch[];
    /** What the provider does with an attempt. Defaults to succeeding immediately. */
    translate?: (texts: string[]) => Promise<Array<{ text: string; }>>;
    maxRetries?: number;
    /**
     * The gate class selection.ts constructs at module scope. Defaults to the
     * instant one, which is right for every question that is not about the hold
     * itself; the tests that ARE about the hold pass heldBurstGate() or the shipped
     * ClickBurstGate on the real clock.
     */
    burstGate?: new () => ClickBurstGate;
    /**
     * The scheduler's backoff sleep. Collapsed by default; parked by the test that
     * asks what a RETRY does when the user dismissed during the backoff, which is
     * the second place a gesture can be abandoned before its request goes out.
     */
    schedulerSleep?: (ms: number) => Promise<void>;
}

function loadSelection(opts: LoadOptions = {}): Harness {
    const { selectedText = "hola mundo", maxRetries = 0 } = opts;

    let source = SELECTION_SOURCE;
    const patches = opts.patchSource === undefined
        ? []
        : Array.isArray(opts.patchSource) ? opts.patchSource : [opts.patchSource];
    for (const { find, replace, matches = 1 } of patches) {
        const parts = source.split(find);
        if (parts.length - 1 !== matches) {
            throw new Error(
                `the control tried to patch ${JSON.stringify(find)}, which matched ` +
                `${parts.length - 1} times in selection.ts — it expected ${matches}`
            );
        }
        source = parts.join(replace);
    }

    const compiled = transformSync(source, {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "selection.ts"
    }).code;

    const doc = new FakeDocument();
    let selection = selectedText;
    const win = { getSelection: () => ({ toString: () => selection }) };

    let providerCalls = 0;
    const sent: string[] = [];
    const translate = opts.translate ?? (async (texts: string[]) => [{ text: `T(${texts[0]})` }]);

    const provider = {
        id: "stub",
        label: "Stub",
        needsKey: false,
        translate: (texts: string[]) => {
            sent.push(texts[0]);
            return translate(texts);
        }
    };

    // The REAL scheduler, with its sleep collapsed so a retry lands inside the
    // test rather than half a second later. maxRetries is per test: 0 for the
    // trust guard, where a retry would only add noise, and 1 for the dismissal
    // tests, where the retry IS the defect.
    const scheduler = new Scheduler({
        concurrency: 3,
        maxRetries,
        baseDelayMs: 0,
        breakerThreshold: 5,
        sleep: opts.schedulerSleep ?? (() => Promise.resolve())
    });

    const required: string[] = [];
    const modules: Record<string, unknown> = {
        "@webpack/common": { MessageStore: { getMessage: () => undefined } },
        "./core/modes": { selectionAction, translationEnabled },
        "./core/protect": { protect, restore },
        "./core/requestBookkeeping": { ClickBurstGate: opts.burstGate ?? InstantBurstGate },
        "./settings": { settings: { store: { mode: "replace", targetLanguage: "en", includeDMs: false } } },
        "./state": {
            entryForMessage: () => undefined,
            guildIdOf: () => "guild-1",
            scheduler,
            toggle: new ToggleState(),
            translationProvider: () => {
                providerCalls++;
                return { ok: true, provider };
            }
        }
    };

    const require_ = (id: string) => {
        required.push(id);
        if (!(id in modules)) {
            throw new Error(
                `selection.ts imported ${JSON.stringify(id)}, which this harness has no stub for. ` +
                "Add one — and check first whether the new import can reach the provider or the " +
                "DOM, because those are the two things this file exists to watch."
            );
        }
        return modules[id];
    };

    const module_ = { exports: {} as SelectionModule };
    // `document` and `window` are passed as parameters so they shadow the globals
    // the compiled file reads. vitest runs this suite in the `node` environment,
    // where both are absent; a stray read of anything unmodelled therefore fails
    // loudly inside the fake rather than silently finding a real DOM.
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "document", "window", compiled);
    run(require_, module_, module_.exports, doc, win);

    module_.exports.installSelectionHandler();

    return {
        exports: module_.exports,
        doc,
        providerCalls: () => providerCalls,
        sent: () => [...sent],
        popover: () => doc.getElementById(POPOVER_ID)?.shadow?.pop.textContent ?? null,
        setSelection: (text: string) => { selection = text; },
        required
    };
}

/**
 * Let the handlers' async work run out. Every clock in the harness is collapsed —
 * the burst gate waits 0 and the scheduler's sleep resolves immediately — so a
 * handful of macrotask turns drains the whole chain including a retry. The
 * assertions never depend on elapsed time.
 */
async function flush(turns = 6): Promise<void> {
    for (let i = 0; i < turns; i++) await new Promise(resolve => { setTimeout(resolve, 0); });
}

/* ------------------------------------------------------- source-level helpers */

/** The body of a top-level function declaration, as source text. */
function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    if (start === -1) throw new Error(`${signature} not found in selection.ts`);
    const open = source.indexOf("{", start);
    const end = source.indexOf("\n}", open);
    return source.slice(open + 1, end);
}

/** The first line of real code in a body, comments and blank lines skipped. */
function firstStatement(body: string): string {
    return body
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("/*"))
        .at(0) ?? "";
}

const TRUST_GUARD = /^if\s*\(!event\.isTrusted\)\s*return;$/;

/* --------------------------------------------------------------------- tests */

describe("the harness executes the real selection.ts — instrument checks first", () => {
    it("the file it compiles is on disk and is not empty", () => {
        expect(SELECTION_SOURCE.length).toBeGreaterThan(1000);
    });

    it("the popover id this file looks for is the one selection.ts creates", () => {
        expect(SELECTION_SOURCE).toContain(`const POPOVER_ID = "${POPOVER_ID}"`);
    });

    it("it evaluates the module, requires the real graph, and installs both handlers", () => {
        const h = loadSelection();
        expect(typeof h.exports.installSelectionHandler).toBe("function");
        expect(typeof h.exports.removeSelectionHandler).toBe("function");
        expect(h.required).toContain("./core/requestBookkeeping");
        expect(h.required).toContain("./state");
        expect(h.doc.listenerCount("dblclick")).toBe(1);
        expect(h.doc.listenerCount("click")).toBe(1);
    });

    it("an import with no stub is a loud failure, not a silent empty object", () => {
        expect(() => loadSelection({
            patchSource: {
                find: `import { MessageStore } from "@webpack/common";`,
                replace: `import { MessageStore } from "@webpack/common";\nimport { nope } from "./not-a-real-module";\nvoid nope;`
            }
        })).toThrow(/no stub for/);
    });

    it("a control whose anchor is absent throws instead of patching nothing", () => {
        // Every red/green control below rests on this. A patch that matched zero
        // times would leave the guard in place and report the test as proving the
        // guard — the exact shape of a control that certifies itself.
        expect(() => loadSelection({
            patchSource: { find: "a line selection.ts does not contain", replace: "" }
        })).toThrow(/matched 0 times/);

        // And a control that reaches only some of its sites is just as dead: the
        // trust guard exists twice, once per handler, and stripping one of the two
        // would leave the other handler guarded and the reproduction silent.
        expect(() => loadSelection({
            patchSource: { find: "    if (!event.isTrusted) return;\n", replace: "", matches: 1 }
        })).toThrow(/matched 2 times/);
    });

    it("A TRUSTED DOUBLE-CLICK REALLY DOES TRANSLATE — the positive control", async () => {
        // Without this, every "nothing was sent" assertion below could be passing
        // because the harness cannot send anything at all.
        const h = loadSelection({ selectedText: "hola mundo" });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();

        expect(h.providerCalls()).toBe(1);
        expect(h.sent()).toEqual(["hola mundo"]);
        expect(h.popover()).toBe("T(hola mundo)");
    });

    it("a trusted triple-click translates too, and once", async () => {
        const h = loadSelection({ selectedText: "the whole line" });
        h.doc.dispatch("click", clickEvent({ isTrusted: true, detail: 3 }));
        await flush();

        expect(h.sent()).toEqual(["the whole line"]);
        expect(h.popover()).toBe("T(the whole line)");
    });
});

describe("a forged click is not a gesture — BEHAVIOUR, executed", () => {
    it("an untrusted dblclick sends nothing and paints nothing", async () => {
        const h = loadSelection();
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: false }));
        await flush();

        expect(h.providerCalls(), "a script's click reached the provider chokepoint").toBe(0);
        expect(h.sent(), "a script's click sent the selection to a third party").toEqual([]);
        expect(h.popover()).toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    it("an untrusted click with detail 3 — the triple-click route — sends nothing either", async () => {
        // The two handlers are separate functions and fail independently. A guard
        // on one of them is a route a script can still take.
        const h = loadSelection();
        h.doc.dispatch("click", clickEvent({ isTrusted: false, detail: 3 }));
        await flush();

        expect(h.providerCalls()).toBe(0);
        expect(h.sent()).toEqual([]);
        expect(h.popover()).toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    it("STRIP THE GUARD AND THE FORGED CLICK SENDS — this file measures the guard", async () => {
        // The reproduction, run against the same source with one line removed from
        // each handler. If this went green with the guards in place, the two tests
        // above would be measuring something else entirely.
        const h = loadSelection({
            selectedText: "private message",
            patchSource: { find: "    if (!event.isTrusted) return;\n", replace: "", matches: 2 }
        });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: false }));
        await flush();

        expect(h.sent()).toEqual(["private message"]);
        expect(h.popover()).toBe("T(private message)");
    });

    it("a forged third click cannot cancel a real double-click's held request", async () => {
        // WHY THE GUARD'S POSITION MATTERS AND NOT ONLY ITS PRESENCE.
        // onTripleClick() calls clickBurst.supersede(), which drops whatever the
        // real dblclick is holding. A guard placed after that call still refuses to
        // send, and still lets a script delete the user's translation — a denial
        // that leaves a double-click doing visibly nothing.
        //
        // The two clicks are given DIFFERENT selections — a real third click widens
        // a word to the whole block — because that is the only way the text that
        // went out says WHICH click sent it. With one selection for both, this test
        // and its control below produce identical output and neither proves
        // anything.
        const h = loadSelection({ selectedText: "word" });

        // The real gesture, dispatched but not yet resumed: it is parked inside the
        // burst gate at this point, exactly as it is mid-burst in a client.
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        // The forged one, arriving while the real one is held, with the wider
        // selection a genuine third click would have made.
        h.setSelection("the whole line");
        h.doc.dispatch("click", clickEvent({ isTrusted: false, detail: 3 }));
        await flush();

        expect(h.sent(), "a script's click dropped the user's own translation").toEqual(["word"]);
        expect(h.popover()).toBe("T(word)");
    });

    it("and the same sequence with the guard stripped sends the FORGED click's text (control)", async () => {
        const h = loadSelection({
            selectedText: "word",
            patchSource: { find: "    if (!event.isTrusted) return;\n", replace: "", matches: 2 }
        });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        h.setSelection("the whole line");
        h.doc.dispatch("click", clickEvent({ isTrusted: false, detail: 3 }));
        await flush();

        // Both halves of the damage, in one measurement. The text that went out is
        // the forged click's wider selection, which means the user's own
        // double-click was superseded and dropped itself, and the request that
        // replaced it was made by nobody. Exactly one request either way — the burst
        // gate's own rule — so the TEXT is what tells the two apart.
        expect(h.sent()).toEqual(["the whole line"]);
        expect(h.popover()).toBe("T(the whole line)");
        expect(h.providerCalls()).toBe(1);
    });

    it("SOURCE SCAN, not behaviour: the guard is the FIRST statement of both handlers", () => {
        // Labelled as a scan because it is one. No single behaviour distinguishes
        // "first statement" from "second": the test above catches the specific
        // damage supersede() does, and this pins the general property — nothing in
        // either handler runs before the event is known to be real.
        for (const signature of ["function onDoubleClick(", "function onTripleClick("]) {
            const first = firstStatement(functionBody(SELECTION_SOURCE, signature));
            expect(first, `${signature} does not open with the trust check`).toMatch(TRUST_GUARD);
        }
    });

    it("the scanner can tell first from second (positive control)", () => {
        const guardFirst = "\n    if (!event.isTrusted) return;\n    doThing();\n";
        const guardSecond = "\n    doThing();\n    if (!event.isTrusted) return;\n";
        const commentedOut = "\n    // if (!event.isTrusted) return;\n    doThing();\n";
        expect(firstStatement(guardFirst)).toMatch(TRUST_GUARD);
        expect(firstStatement(guardSecond)).not.toMatch(TRUST_GUARD);
        expect(firstStatement(commentedOut)).not.toMatch(TRUST_GUARD);
        expect(() => functionBody(SELECTION_SOURCE, "function notAFunction(")).toThrow(/not found/);
    });
});

describe("a dismissed popover stays dismissed — BEHAVIOUR, executed", () => {
    /**
     * A provider that fails its first attempt and succeeds on the retry. This is
     * the real shape the defect needed: a plain Error carries no status, so
     * isPermanent() classes it transient and the real scheduler tries again.
     */
    function failThenSucceed() {
        let calls = 0;
        return async (texts: string[]) => {
            calls++;
            if (calls === 1) throw new Error("network");
            return [{ text: `T(${texts[0]})` }];
        };
    }

    /**
     * The same thing with the SUCCEEDING attempt parked until the test releases
     * it, which is what makes the "…" state observable at all.
     *
     * Every clock in this harness is collapsed, so an attempt that resolves by
     * itself resolves before the test can look: the first version of these tests
     * asserted on "…" and found the finished translation already there. Holding
     * the attempt is not a convenience — it is the only way to stand in the
     * middle of the gesture, which is precisely where the user's dismissal lands.
     */
    function heldProvider(opts: { failFirst?: boolean; } = {}) {
        let release: () => void = () => {};
        const parked = new Promise<void>(resolve => { release = resolve; });
        let calls = 0;
        return {
            translate: async (texts: string[]) => {
                calls++;
                if (opts.failFirst && calls === 1) throw new Error("network");
                await parked;
                return [{ text: `T(${texts[0]})` }];
            },
            release: () => release()
        };
    }

    it("the retry really does happen — fixture control", async () => {
        // If the retry never fired, the two tests below would pass with no late
        // render to suppress, which is the whole thing they are about.
        const h = loadSelection({ translate: failThenSucceed(), maxRetries: 1 });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();

        expect(h.sent()).toHaveLength(2);
        expect(h.popover()).toBe("T(hola mundo)");
    });

    it("a retry that lands after the user clicked away paints nothing", async () => {
        const provider = heldProvider({ failFirst: true });
        const h = loadSelection({ translate: provider.translate, maxRetries: 1 });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));

        // The ellipsis is on screen, the first attempt has already failed, and the
        // retry is in flight. The dismissal listener's registration is deferred by
        // a setTimeout, so it is awaited rather than assumed.
        await flush(2);
        expect(h.popover(), "the gesture never got as far as showing anything").toBe("…");
        expect(h.doc.listenerCount("mousedown")).toBe(1);
        expect(h.sent(), "the retry had not been issued yet — the test is not in the middle").toHaveLength(2);

        // The user clicks away.
        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        // The retry now succeeds.
        provider.release();
        await flush();
        expect(h.popover(), "a dismissed gesture's retry put its popover back on screen").toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    it("STRIP THE INVALIDATION FROM dismiss() AND THE POPOVER COMES BACK (control)", async () => {
        // The defect, reproduced against the same source with one line removed.
        const provider = heldProvider({ failFirst: true });
        const h = loadSelection({
            translate: provider.translate,
            maxRetries: 1,
            patchSource: { find: "        invalidatePopover();\n        host.remove();", replace: "        host.remove();" }
        });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(2);
        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        provider.release();
        await flush();
        expect(h.sent()).toHaveLength(2);
        expect(h.popover(), "removing the invalidation no longer resurrects the popover — the control is dead").toBe("T(hola mundo)");
    });

    it("a superseded gesture's late answer cannot overwrite the gesture that replaced it", async () => {
        // Dismissal is not the only way a gesture stops being the current one. A
        // second double-click takes its own generation, and the first gesture's
        // answer must not land on top of the second's.
        let releaseFirst: (() => void) | null = null;
        const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
        let call = 0;

        const h = loadSelection({
            translate: async (texts: string[]) => {
                call++;
                if (call === 1) {
                    await firstHeld;
                    return [{ text: "STALE" }];
                }
                return [{ text: `T(${texts[0]})` }];
            }
        });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        expect(h.popover()).toBe("…");

        // The second gesture, while the first is still in flight.
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();
        expect(h.popover()).toBe("T(hola mundo)");

        releaseFirst!();
        await flush();
        expect(h.sent(), "both gestures sent, which is what makes the race real").toHaveLength(2);
        expect(h.popover(), "the abandoned gesture's answer replaced the current one").toBe("T(hola mundo)");
    });

    it("switching the plugin off drops an answer that is already in flight", async () => {
        let releaseTranslate: (() => void) | null = null;
        const held = new Promise<void>(resolve => { releaseTranslate = resolve; });

        const h = loadSelection({
            translate: async (texts: string[]) => {
                await held;
                return [{ text: `T(${texts[0]})` }];
            }
        });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        expect(h.popover()).toBe("…");

        // Teardown. clickBurst.abandon() cannot reach this attempt: it has already
        // been sent, which is exactly the case removeSelectionHandler()'s own
        // comment describes.
        h.exports.removeSelectionHandler();
        expect(h.popover()).toBeNull();
        expect(h.doc.listenerCount("dblclick")).toBe(0);

        releaseTranslate!();
        await flush();
        expect(h.sent(), "nothing was in flight, so the teardown had nothing to drop").toHaveLength(1);
        expect(h.popover(), "a translation painted onto a client with no translator running").toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    it("STRIP THE INVALIDATION FROM TEARDOWN AND IT PAINTS ANYWAY (control)", async () => {
        let releaseTranslate: (() => void) | null = null;
        const held = new Promise<void>(resolve => { releaseTranslate = resolve; });

        const h = loadSelection({
            translate: async (texts: string[]) => {
                await held;
                return [{ text: `T(${texts[0]})` }];
            },
            patchSource: {
                find: "    invalidatePopover();\n    document.getElementById(POPOVER_ID)?.remove();",
                replace: "    document.getElementById(POPOVER_ID)?.remove();"
            }
        });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        h.exports.removeSelectionHandler();
        expect(h.popover()).toBeNull();

        releaseTranslate!();
        await flush();
        expect(h.popover(), "teardown's invalidation is no longer what suppresses this — the control is dead").toBe("T(hola mundo)");
    });

    it("the ordinary two-step render still works — a token is not a one-shot", async () => {
        // Both showPopover() calls of one gesture carry the SAME token: the
        // ellipsis and then the translation. A fix that invalidated on every render
        // would suppress every gesture's own answer, and every other test here
        // would still pass.
        const provider = heldProvider();
        const h = loadSelection({ translate: provider.translate });
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        expect(h.popover()).toBe("…");
        provider.release();
        await flush();
        expect(h.popover()).toBe("T(hola mundo)");
        // One popover on screen, not two stacked hosts.
        expect(h.doc.attached).toHaveLength(1);
    });

    it("a gesture that arrives after a dismissal gets a fresh, usable generation", async () => {
        // The counter only moves forward, so an invalidation must not lock the
        // feature off. This is the case a sentinel-based fix would break.
        const h = loadSelection();
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();
        expect(h.popover()).toBe("T(hola mundo)");

        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();
        expect(h.popover(), "the popover stopped working after one dismissal").toBe("T(hola mundo)");
    });
});

/**
 * THE THIRD DEFECT, AND THE POPOVER GENERATION ITSELF CREATED IT.
 *
 * selection.ts takes a gesture's generation ABOVE every branch that renders, but on
 * the request path the first showPopover() is BELOW the burst hold — and the
 * mousedown listener that dismisses a popover is registered inside showPopover(). So
 * for the whole of CLICK_BURST_MS a double-click owns a token, has no popover of its
 * own and has no dismiss listener of its own, while a popover from an EARLIER gesture
 * is still on screen with a live one.
 *
 * THE SEQUENCE. Triple-click a sentence, and a popover appears. Double-click
 * somewhere else: that gesture enters the hold. Click the old popover to get rid of
 * it — its dismiss() calls invalidatePopover(), which moves the generation past the
 * held gesture. The hold then resolves TRUE, because the burst gate's epoch is
 * untouched and nothing superseded that click, and the gesture walked on and SENT the
 * selection. Only its paint was dropped, by showPopover()'s token check.
 *
 * So the user clicked away and their text went to a third party with nothing ever
 * shown: a SILENT SEND, and a worse outcome than the resurrected popover the
 * generation counter was added to prevent. The counter suppressed the symptom and
 * left the transmission — which is why a stale generation now aborts the gesture
 * rather than merely muting it.
 *
 * WHY THESE TESTS DO NOT USE InstantBurstGate. Its window is 0 ms, so there is no
 * hold to stand inside: the gesture is through the gate before the test can dispatch
 * anything, and the whole defect lives in that window. Two instruments span it
 * instead — a gate whose wait is parked until the test releases it, which carries the
 * bulk of the assertions deterministically, and the shipped gate on the real clock in
 * the block after this one.
 */
describe("a dismissal inside the burst hold — BEHAVIOUR, executed", () => {
    /**
     * The gesture that leaves a popover on screen and is already OVER: a triple-click
     * does not hold, being the last click of its own burst. That is the real shape of
     * the defect — the popover the user clicks away belongs to a finished gesture,
     * and the gesture that pays for the click is the one still inside the window.
     */
    function finishedGesture(h: Harness): void {
        h.doc.dispatch("click", clickEvent({ isTrusted: true, detail: 3 }));
    }

    it("the parked gate holds, for the shipped window, and still sends afterwards (fixture control)", async () => {
        const gate = heldBurstGate();
        const h = loadSelection({ burstGate: gate.Gate });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush();

        // Standing inside the hold, which is what every assertion below depends on.
        expect(gate.windows(), "the hold was never entered, or not for the shipped window").toEqual([CLICK_BURST_MS]);
        expect(h.providerCalls()).toBe(0);
        expect(h.sent()).toEqual([]);
        expect(h.popover()).toBeNull();

        // And it is a hold, not a refusal: the moment the burst is over the gesture
        // proceeds. Without this half, every "nothing was sent" below could be
        // passing because a parked gate can never send at all.
        gate.release();
        await flush();
        expect(h.providerCalls()).toBe(1);
        expect(h.sent()).toEqual(["hola mundo"]);
        expect(h.popover()).toBe("T(hola mundo)");
    });

    it("DISMISSING AN OLDER POPOVER DURING THE HOLD SENDS NOTHING", async () => {
        const gate = heldBurstGate();
        const h = loadSelection({ selectedText: "the whole line", burstGate: gate.Gate });

        // Gesture A: a triple-click that completes and leaves its popover up.
        finishedGesture(h);
        await flush();
        expect(h.popover()).toBe("T(the whole line)");
        expect(h.sent()).toEqual(["the whole line"]);

        // Gesture B: a double-click on something else, now parked in the burst hold
        // with no popover and no dismiss listener of its own.
        h.setSelection("a private sentence");
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        expect(h.popover(), "the held gesture painted during the hold").toBe("T(the whole line)");

        // The user clicks the OLD popover away. A's dismiss() invalidates the
        // generation, and B is the gesture that loses its token to it.
        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        // B's window ends. Its own settle() resolves TRUE — nothing superseded it —
        // so the abort has to come from the generation, not from the burst gate.
        gate.release();
        await flush();

        expect(h.sent(), "the abandoned gesture sent its selection with nothing on screen").toEqual(["the whole line"]);
        expect(h.providerCalls(), "the abandoned gesture reached the provider chokepoint").toBe(1);
        expect(h.popover()).toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    /** The sequence above, driven against whatever source the control asked for. */
    async function dismissDuringTheHold(patchSource?: SourcePatch | SourcePatch[]) {
        const gate = heldBurstGate();
        const h = loadSelection({ selectedText: "the whole line", burstGate: gate.Gate, patchSource });

        finishedGesture(h);
        await flush();
        h.setSelection("a private sentence");
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        h.doc.dispatch("mousedown", { isTrusted: true });
        gate.release();
        await flush();
        return h;
    }

    it("STRIP BOTH ABORTS AND THE SAME SEQUENCE IS THE SILENT SEND IT WAS (control)", async () => {
        // THE DEFECT ITSELF, reproduced against the same source with the two abort
        // lines removed and nothing else changed — which is the code as it shipped
        // before them. Read the two assertions together: the selection WENT OUT, and
        // there was never anything on screen for it. That combination is the whole
        // reason the aborts exist, and it is worse than the resurrected popover the
        // generation counter was added to prevent, because the user cannot tell it
        // happened at all.
        const h = await dismissDuringTheHold([ABORT_AFTER_THE_HOLD, ABORT_BEFORE_THE_SEND]);

        expect(h.sent(), "the aborts are no longer what stops the send — the control is dead")
            .toEqual(["the whole line", "a private sentence"]);
        expect(h.providerCalls()).toBe(2);
        expect(h.popover(), "the silent send: transmitted, and nothing on screen").toBeNull();
    });

    it("STRIP ONLY THE ABORT AFTER THE HOLD AND THE ABANDONED GESTURE STILL SPENDS A SLOT (control)", async () => {
        // What the FIRST abort is worth on its own, now that the second exists. The
        // text stays in — scheduler.run() refuses to send it — but the abandoned gesture
        // has already obtained a provider and taken one of the three concurrency slots
        // away from the rendered path. The earlier abort is the cheaper one, and it is
        // the one that survives a later edit moving the send out of that callback.
        const h = await dismissDuringTheHold(ABORT_AFTER_THE_HOLD);

        expect(h.providerCalls(), "the first abort no longer keeps an abandoned gesture out — the control is dead").toBe(2);
        expect(h.sent(), "the second abort should still have stopped the send").toEqual(["the whole line"]);
        expect(h.popover()).toBeNull();
    });

    it("a dismissal during the RETRY BACKOFF means the retry never goes out", async () => {
        // The same abandonment one step further on, and why the check is repeated
        // inside scheduler.run(). PRIVACY.md counts up to four attempts per gesture;
        // a gesture the user has ended is owed none of them, and the backoff between
        // attempts is a second window with the ellipsis on screen. The concurrency
        // wait inside scheduler.run() is the same hazard through the same door.
        let releaseBackoff: () => void = () => {};
        const backoff = new Promise<void>(resolve => { releaseBackoff = resolve; });
        let calls = 0;

        const h = loadSelection({
            maxRetries: 1,
            schedulerSleep: () => backoff,
            translate: async (texts: string[]) => {
                calls++;
                if (calls === 1) throw new Error("network");
                return [{ text: `T(${texts[0]})` }];
            }
        });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(2);
        expect(h.popover(), "the test is not standing in the middle of the gesture").toBe("…");
        expect(h.sent(), "the first attempt had not gone out yet").toEqual(["hola mundo"]);

        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        releaseBackoff();
        await flush();
        expect(h.sent(), "a retry went out for a gesture the user had already ended").toEqual(["hola mundo"]);
        expect(h.popover()).toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });

    it("STRIP THE ABORT INSIDE THE SCHEDULER AND THE RETRY STILL GOES OUT (control)", async () => {
        let releaseBackoff: () => void = () => {};
        const backoff = new Promise<void>(resolve => { releaseBackoff = resolve; });
        let calls = 0;

        const h = loadSelection({
            maxRetries: 1,
            schedulerSleep: () => backoff,
            translate: async (texts: string[]) => {
                calls++;
                if (calls === 1) throw new Error("network");
                return [{ text: `T(${texts[0]})` }];
            },
            patchSource: ABORT_BEFORE_THE_SEND
        });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(2);
        h.doc.dispatch("mousedown", { isTrusted: true });
        releaseBackoff();
        await flush();

        expect(h.sent(), "the scheduler-side abort is no longer what stops the retry — the control is dead")
            .toEqual(["hola mundo", "hola mundo"]);
        expect(h.popover()).toBeNull();
    });

    it("and the abort does not break the ordinary case: a gesture nobody abandoned still lands", async () => {
        // A check that returns early on a stale token must not return early on a
        // current one. Every other test in this block asserts an absence, and an
        // abort that fired always would satisfy all of them.
        const gate = heldBurstGate();
        const h = loadSelection({ burstGate: gate.Gate });

        finishedGesture(h);
        await flush();
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await flush(1);
        gate.release();
        await flush();

        expect(h.sent()).toEqual(["hola mundo", "hola mundo"]);
        expect(h.popover()).toBe("T(hola mundo)");
        expect(h.doc.attached).toHaveLength(1);
    });
});

/**
 * THE SAME DEFECT ON THE REAL CLOCK, WITH THE SHIPPED GATE AND THE SHIPPED 500 ms.
 *
 * The block above parks the hold, and a parked hold is a substitution: it proves the
 * epoch arithmetic and the abort, and it cannot prove that what a real client waits
 * out is a window a user can click inside. These two do, at just over half a second
 * each — which is why there are two and not eight, and why every other test in this
 * file keeps its clock collapsed.
 */
describe("and inside the real CLICK_BURST_MS window, on the real clock", () => {
    /** A genuine wall-clock wait. Every other clock in this file is collapsed. */
    const realWait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

    /** Early enough to be unambiguously inside a 500 ms hold, with slack for a stall. */
    const INSIDE_THE_HOLD = 150;

    /** Comfortably past the window, without waiting on a guess. */
    const PAST_THE_WINDOW = CLICK_BURST_MS + 120;

    it("the shipped gate really holds for 500 ms, then really sends (fixture control)", async () => {
        const h = loadSelection({ burstGate: ClickBurstGate });

        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await realWait(INSIDE_THE_HOLD);
        expect(h.sent(), "the shipped gate did not hold at all").toEqual([]);
        expect(h.popover(), "the shipped gate painted before its window was out").toBeNull();

        await realWait(PAST_THE_WINDOW - INSIDE_THE_HOLD);
        expect(h.sent(), "the shipped gate never let the click through").toEqual(["hola mundo"]);
        expect(h.popover()).toBe("T(hola mundo)");
    });

    it("A DISMISSAL 150 ms INTO A REAL 500 ms HOLD SENDS NOTHING", async () => {
        const h = loadSelection({ selectedText: "the whole line", burstGate: ClickBurstGate });

        // The finished gesture, on the real clock: a triple-click does not hold.
        h.doc.dispatch("click", clickEvent({ isTrusted: true, detail: 3 }));
        await flush();
        expect(h.popover()).toBe("T(the whole line)");

        h.setSelection("a private sentence");
        h.doc.dispatch("dblclick", clickEvent({ isTrusted: true }));
        await realWait(INSIDE_THE_HOLD);
        expect(h.sent(), "the second gesture was through the real window inside 150 ms").toEqual(["the whole line"]);

        h.doc.dispatch("mousedown", { isTrusted: true });
        expect(h.popover()).toBeNull();

        await realWait(PAST_THE_WINDOW - INSIDE_THE_HOLD);
        expect(h.sent(), "the abandoned gesture sent its selection with nothing on screen").toEqual(["the whole line"]);
        expect(h.providerCalls()).toBe(1);
        expect(h.popover()).toBeNull();
        expect(h.doc.attached).toHaveLength(0);
    });
});
