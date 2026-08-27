/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE WIRING LAYER for the panel-over-settings defect, reported by the operator
 * THREE times.
 *
 * src/plugins/channelTranslator/panel/index.tsx cannot be imported under vitest:
 * it resolves `@webpack/common`, an alias that only exists inside the Vencord
 * build. test/providerChokepoint.test.ts and test/selectionPrivacy.test.ts
 * record the same constraint for state.ts, settings.ts, render.tsx and
 * selection.ts, and use the same instrument — a source scan, used ONLY for
 * wiring and never for a decision that a unit test could reach.
 *
 * WHAT ACTUALLY WENT WRONG, and why this file pins a DELETION.
 *
 * The panel hides itself with two rules in applyLayerVisibility(): "the anchor
 * is detached" and "an ancestor is aria-hidden". Both were added in an earlier
 * turn and BOTH WERE INERT, for one reason — the anchor lookup ended in
 *
 *     ?? document.querySelector("main")
 *
 * Discord's settings screen is itself inside a `<main>`. So when the chat went
 * away the fallback still matched: the anchor was never null, never detached,
 * and the settings page's own `<main>` has no aria-hidden ancestor. "No chat
 * area" was a state the code could not represent, and the two guards tested a
 * thing that could not be absent. The panel floated over the settings page.
 *
 * A fallback that matches everything is not a safety net. It is the failure.
 * The most important assertion in this file is therefore that it is GONE and
 * cannot come back — a test that pins an absence, because a future reader
 * looking at `if (!chat)` would reasonably want to add a fallback so the anchor
 * is "never missing".
 */

const ROOT = process.cwd();
const PANEL = join(ROOT, "src", "plugins", "channelTranslator", "panel", "index.tsx");
const BASE_TAB = join(ROOT, "src", "components", "settings", "tabs", "BaseTab.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Only the executable lines. This file's subject is heavily commented, and the
 *  comments quote the very selectors being forbidden — a matcher that cannot
 *  tell an explanation from an instruction would forbid the file from warning
 *  the next reader off the mistake. */
function codeLines(source: string): string[] {
    return source.split("\n").filter(line => !isCommentLine(line));
}

function codeContains(source: string, needle: string): boolean {
    return codeLines(source).some(line => line.includes(needle));
}

/** Character offset of the first NON-COMMENT line containing `needle`, or -1. */
function codeIndexOf(source: string, needle: string): number {
    let offset = 0;
    for (const line of source.split("\n")) {
        if (!isCommentLine(line) && line.includes(needle)) return offset;
        offset += line.length + 1;
    }
    return -1;
}

/** The body of an arrow function assigned to `name`, comments included.
 *  Matches both `const x = () => {` and the module-scoped `x = () => {`. */
function bodyOf(source: string, name: string): string {
    const start = source.indexOf(`${name} = () => {`);
    expect(start, `${name} was not found in the panel source`).toBeGreaterThan(-1);
    const end = source.indexOf("\n    };", start);
    expect(end, `${name} has no recognisable end`).toBeGreaterThan(start);
    return source.slice(start, end);
}

/**
 * Is this line of a selector list the bare entry `"main"` (or 'main', or `main`)?
 *
 * 🔴 EXTRACTED SO THE CONTROL AND THE ASSERTION SHARE ONE MATCHER. The positive
 * control below used to inline a regex — `/^\s*["'`]main["'`]\s*,?\s*$/` — that
 * NO assertion in this file ever ran. The live check built its own pattern with
 * `new RegExp`, anchored differently. So the control proved that a regex nobody
 * used could match a string nobody scanned, which is not a control at all: the
 * live matcher could have been broken in any way and the control would still
 * have been green.
 */
function isBareSelectorEntry(line: string, selector: string): boolean {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*["'\`]${escaped}["'\`]\\s*,?\\s*$`).test(line);
}

/**
 * Every `host.style.display = …` write in the panel's executable code, with the
 * offset it sits at and whether it CAN SHOW the panel.
 *
 * 🔴 "CAN SHOW" IS NOT "DOES NOT CONTAIN none". The filter here used to be
 * `!line.includes('"none"')`, and every display write in this file either is the
 * literal `"none"` or is the ternary `hidden ? "none" : ""` — which contains the
 * substring and IS the show path. So the filter matched nothing, the assertion
 * compared [] to [] and could not fail whatever the panel did.
 *
 * What is classified instead is the RIGHT-HAND SIDE: a write that assigns
 * exactly `"none"` can only hide; anything else — a ternary, a variable, an
 * empty string — can put the panel back on screen and therefore has to live
 * inside the one function allowed to do that.
 */
interface DisplayWrite { offset: number; line: string; rhs: string; canShow: boolean; }

function displayWrites(source: string): DisplayWrite[] {
    const found: DisplayWrite[] = [];
    let offset = 0;
    for (const line of source.split("\n")) {
        if (!isCommentLine(line)) {
            const at = /host\.style\.display\s*=/.exec(line);
            if (at) {
                const rhs = line.slice(at.index + at[0].length).replace(/;\s*$/, "").trim();
                found.push({ offset, line, rhs, canShow: rhs !== '"none"' && rhs !== "'none'" });
            }
        }
        offset += line.length + 1;
    }
    return found;
}

/** The entries of a top-level `const NAME = [ ... ] as const;` array.
 *  Slicing at the first `]` would stop inside `[data-list-id="chat-messages"]`,
 *  which is how the first draft of this file went red on correct code. */
function arrayLiteral(source: string, name: string): string {
    const start = source.indexOf(`const ${name} = [`);
    expect(start, `${name} was removed or renamed`).toBeGreaterThan(-1);
    const end = source.indexOf("] as const", start);
    expect(end, `${name} is no longer a \`as const\` array literal`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("the guard measures something — instrument checks first", () => {
    it("every file it claims to read exists and is not empty", () => {
        for (const file of [PANEL, BASE_TAB]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("it is reading the panel it thinks it is", () => {
        const src = read(PANEL);
        expect(src).toContain("export function mountPanel");
        expect(src).toContain("export function unmountPanel");
        expect(src).toContain("channel-translator-host");
    });

    it("its matchers fire and abstain correctly (positive control)", () => {
        expect(codeContains('    const x = document.querySelector("main");', 'querySelector("main")')).toBe(true);
        expect(codeContains('    // ?? document.querySelector("main") must never return', 'querySelector("main")')).toBe(false);
        expect(codeContains(' * document.querySelector("main") was the bug', 'querySelector("main")')).toBe(false);
    });

    it("its ordering matcher skips prose and finds the code (positive control)", () => {
        const sample = [
            "// isBlockingLayerOpen() is described here first",
            "host.style.display = hidden ? \"none\" : \"\";",
            "if (isBlockingLayerOpen()) return;"
        ].join("\n");
        // A naive indexOf would find the comment on line 1 and report the check
        // as running BEFORE the show, which is the thing under test.
        expect(sample.indexOf("isBlockingLayerOpen()")).toBeLessThan(sample.indexOf("display ="));
        expect(codeIndexOf(sample, "isBlockingLayerOpen()")).toBeGreaterThan(codeIndexOf(sample, "display ="));
        expect(codeIndexOf(sample, "nothing here")).toBe(-1);
    });

    it("bodyOf() extracts a function body and not the whole file", () => {
        const src = read(PANEL);
        const body = bodyOf(src, "applyLayerVisibility");
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThan(src.length);
        expect(body).not.toContain("export function unmountPanel");
    });

    it("bodyOf() reaches the module-scoped `reposition = () => {` too", () => {
        const body = bodyOf(read(PANEL), "reposition");
        expect(body).toContain("if (!chat) {");
        expect(body).not.toContain("export function unmountPanel");
    });

    it("arrayLiteral() spans the whole list, not up to the first bracket", () => {
        // The first draft sliced at the first `]`, which lands INSIDE
        // `[data-list-id="chat-messages"]` — a matcher that reported the list
        // as missing its own first entry.
        const list = arrayLiteral(read(PANEL), "CHAT_SELECTORS");
        expect(list).toContain('[data-list-id="chat-messages"]');
        expect(list).toContain('[class*="chatContent"]');
        expect(list).not.toContain("BLOCKING_LAYER_SELECTORS");
    });
});

describe("the `main` fallback is gone and must stay gone", () => {
    /**
     * THE REGRESSION THIS FILE EXISTS FOR. Restoring
     * `?? document.querySelector("main")` — in the anchor lookup, in the
     * selector list, anywhere in executable code — turns both hide rules inert
     * again and puts the panel back over the settings page.
     */
    it("no executable line asks for a bare <main>", () => {
        const src = read(PANEL);
        expect(codeContains(src, 'querySelector("main")'), "the <main> fallback is back").toBe(false);
        expect(codeContains(src, "querySelector('main')"), "the <main> fallback is back").toBe(false);
        expect(codeLines(src).some(l => /querySelector\(\s*["'`]main["'`]\s*\)/.test(l))).toBe(false);
    });

    it("would notice the fallback restored in either shape (positive control)", () => {
        // BOTH halves now exercise the matcher an assertion actually runs. The
        // list-entry half used to test a regex written only here — see
        // isBareSelectorEntry()'s doc-block for what that cost.
        const asFallback = "        const chat = findChatAnchor() ?? document.querySelector(\"main\");";
        expect(/querySelector\(\s*["'`]main["'`]\s*\)/.test(asFallback)).toBe(true);

        for (const asListEntry of ["    'main',", '    "main",', "    `main`", "  'main'"]) {
            expect(isBareSelectorEntry(asListEntry, "main"), asListEntry).toBe(true);
        }
        // …and abstains on the entries that must survive, so the live check below
        // cannot be passing by matching nothing.
        for (const kept of ['    \'[data-list-id="chat-messages"]\',', "    '[class*=\"chatContent\"]',"]) {
            expect(isBareSelectorEntry(kept, "main"), kept).toBe(false);
        }
    });

    it("the chat selector list is chat-specific and contains no page-wide entry", () => {
        const list = arrayLiteral(read(PANEL), "CHAT_SELECTORS");

        // Every entry proves a MESSAGE LIST exists, not that a page exists.
        expect(list).toContain('[data-list-id="chat-messages"]');
        expect(list).toContain('[class*="messagesWrapper"]');
        expect(list).toContain('[class*="chatContent"]');

        // Nothing in the list may match a document that merely has a page in it.
        // Uses isBareSelectorEntry(), which is the same matcher the positive
        // control above exercises — that is the whole point of it being named.
        for (const pageWide of ["main", "body", "#app-mount", "html", "[class*=\"app\"]"]) {
            expect(
                list.split("\n").some(line => isBareSelectorEntry(line, pageWide)),
                `${pageWide} is a page-wide selector and cannot prove a chat area exists`
            ).toBe(false);
        }
    });

    it("the anchor is resolved only through the chat-specific list", () => {
        const src = read(PANEL);
        expect(codeContains(src, "const chat = findChatAnchor();")).toBe(true);
        // findChatAnchor() reads CHAT_SELECTORS and nothing else.
        const start = src.indexOf("function findChatAnchor()");
        expect(start).toBeGreaterThan(-1);
        const fn = src.slice(start, src.indexOf("\n}", start));
        expect(fn).toContain("CHAT_SELECTORS");
        expect(fn).toContain("return null;");
        expect(/querySelector\(\s*["'`]/.test(fn), "findChatAnchor() hardcodes a selector").toBe(false);
    });
});

describe("no chat area means hidden", () => {
    it("reposition() hides when there is no chat anchor", () => {
        const body = bodyOf(read(PANEL), "reposition");
        const guard = body.indexOf("if (!chat) {");
        expect(guard, "the no-chat guard was removed from reposition()").toBeGreaterThan(-1);
        const block = body.slice(guard, body.indexOf("return;", guard));
        expect(block).toContain('host.style.display = "none";');
    });

    it("applyLayerVisibility() hides when the anchor is detached", () => {
        const body = bodyOf(read(PANEL), "applyLayerVisibility");
        const guard = body.indexOf("if (!observedAnchor?.isConnected) {");
        expect(guard, "the detached-anchor guard was removed").toBeGreaterThan(-1);
        expect(body.slice(guard, body.indexOf("return;", guard))).toContain('host.style.display = "none";');
    });
});

describe("the aria-hidden rule still runs after the change", () => {
    it("applyLayerVisibility() still reads aria-hidden off the anchor's ancestors", () => {
        const body = bodyOf(read(PANEL), "applyLayerVisibility");
        expect(body).toContain('observedAnchor.closest("[aria-hidden]")');
        expect(body).toContain('getAttribute("aria-hidden") === "true"');
        expect(body).toContain('host.style.display = hidden ? "none" : "";');
    });

    it("the ancestor chain is still observed for aria-hidden being ADDED", () => {
        const src = read(PANEL);
        expect(codeContains(src, 'attributeFilter: ["aria-hidden"]')).toBe(true);
        // Walking parentElement is what makes it the whole chain rather than the
        // one node that happens to carry the attribute today.
        expect(codeContains(src, "node = node.parentElement")).toBe(true);
    });
});

describe("the third, explicit signal: a full-screen layer hides the panel", () => {
    it("isBlockingLayerOpen() exists and is driven by a selector list", () => {
        const src = read(PANEL);
        expect(codeContains(src, "function isBlockingLayerOpen()")).toBe(true);
        expect(codeContains(src, "const BLOCKING_LAYER_SELECTORS = [")).toBe(true);
    });

    it("it is checked BEFORE anything can show the panel", () => {
        const body = bodyOf(read(PANEL), "applyLayerVisibility");

        const check = codeIndexOf(body, "isBlockingLayerOpen()");
        const show = codeIndexOf(body, 'host.style.display = hidden ? "none" : "";');
        expect(check, "applyLayerVisibility() never calls isBlockingLayerOpen()").toBeGreaterThan(-1);
        expect(show, "the show path was removed or reshaped").toBeGreaterThan(-1);
        expect(check, "the layer check runs after the panel is shown").toBeLessThan(show);

        // It is the FIRST guard, not merely an earlier one: nothing may run
        // between entering the function and asking whether a layer is open.
        expect(check).toBeLessThan(codeIndexOf(body, "if (!observedAnchor?.isConnected)"));
        expect(check).toBeLessThan(codeIndexOf(body, 'observedAnchor.closest("[aria-hidden]")'));

        // And it hides rather than falling through.
        expect(body.slice(body.indexOf("if (isBlockingLayerOpen()) {")))
            .toContain('host.style.display = "none";');
    });

    /*
     * 🔴 THIS TEST USED TO BE UNABLE TO FAIL, IN TWO SEPARATE WAYS, AND THE TITLE
     * WAS THE SECOND OF THEM.
     *
     * (a) The filter for "a show path" was `!line.includes('"none"')`. Every
     *     display write in the panel either IS `"none"` or is the ternary
     *     `hidden ? "none" : ""` — the show path itself, which contains the
     *     substring. So the filter matched nothing, the assertion compared an
     *     empty array with an empty array, and no arrangement of the panel's
     *     code could have made it red.
     *
     * (b) The title said applyLayerVisibility() was the only thing that could
     *     show the panel. The body scanned the WHOLE FILE and never established
     *     which function any write lived in, so it could not have told the
     *     difference between a show path inside that function and one in
     *     reposition(). It asserted a file-wide property and was titled with a
     *     function-scoped one.
     *
     * Both are fixed here rather than by retitling: the body now classifies each
     * write by its right-hand side and BOUNDS the search with the same bodyOf()
     * helper the rest of this file uses, so the title is what is measured.
     */
    it("applyLayerVisibility() is the only thing that can show the panel", () => {
        const src = read(PANEL);
        const writes = displayWrites(src);

        // The scan is real: the panel does write display, and at least one of
        // those writes can show. An empty list either way makes this vacuous.
        expect(writes.length, "no host.style.display writes found — the scan is empty")
            .toBeGreaterThan(0);
        const shows = writes.filter(w => w.canShow);
        expect(
            shows.length,
            "no write can show the panel at all — either the show path was removed " +
            "or the classifier stopped recognising one"
        ).toBeGreaterThan(0);

        // Where applyLayerVisibility() actually starts and ends, in file offsets.
        const body = bodyOf(src, "applyLayerVisibility");
        const from = src.indexOf(body);
        const to = from + body.length;
        expect(from, "applyLayerVisibility() was not located in the file").toBeGreaterThan(-1);

        const outside = shows.filter(w => w.offset < from || w.offset >= to);
        expect(
            outside.map(w => w.line.trim()),
            "a show path outside applyLayerVisibility() bypasses the blocking-layer guard"
        ).toEqual([]);
    });

    it("the show-path classifier and the function bound both work (controls)", () => {
        // (a) The classifier tells a hide from a show, including the exact shape
        //     that defeated the old substring filter.
        const sample = [
            '        host.style.display = "none";',
            '        host.style.display = hidden ? "none" : "";',
            '        host.style.display = "";',
            "        // host.style.display = wantShow;"
        ].join("\n");
        const found = displayWrites(sample);
        expect(found.map(w => w.rhs)).toEqual(['"none"', 'hidden ? "none" : ""', '""']);
        expect(found.map(w => w.canShow)).toEqual([false, true, true]);
        // The old filter's verdict on the same three, recorded so the defect
        // cannot be reintroduced as a "simplification".
        expect(found.filter(w => !w.line.includes('"none"')).length).toBe(1);

        // (b) The bound is a real window, not the whole file: reposition() writes
        //     display too and must sit OUTSIDE it.
        const src = read(PANEL);
        const body = bodyOf(src, "applyLayerVisibility");
        const from = src.indexOf(body);
        const to = from + body.length;
        expect(from).toBeGreaterThan(0);
        expect(to).toBeLessThan(src.length);
        const repositionWrite = displayWrites(src)
            .find(w => w.offset >= src.indexOf(bodyOf(src, "reposition")));
        expect(repositionWrite, "reposition() no longer writes display").toBeTruthy();
        expect(repositionWrite!.offset >= to, "the bound does not separate the two functions").toBe(true);
    });

    it("the check runs on the timer that survives a settings screen", () => {
        const src = read(PANEL);
        // The ResizeObserver dies with the message column and the
        // MutationObserver watches an ancestor chain that goes with it, so this
        // interval is the only trigger left when settings is open — and the only
        // thing that brings the panel back afterwards.
        expect(codeContains(src, "visibilityTimer = setInterval(")).toBe(true);
        expect(codeContains(src, "reposition?.()")).toBe(true);
        // reposition() ends by re-asking the visibility question.
        expect(bodyOf(src, "reposition")).toContain("applyLayerVisibility();");
    });
});

describe("the settings signal is this project's own class, not a guess at Discord's", () => {
    /**
     * The chair's instruction was to prefer an existing mechanism over a
     * class-name guess. `vc-settings-tab` is emitted by SettingsTab in
     * src/components/settings/tabs/BaseTab.tsx, which wraps every client
     * settings page this project ships — including the "Discord Translator" page
     * in the operator's screenshot. This test fails if either side moves.
     */
    it("the panel watches for the class BaseTab.tsx actually emits", () => {
        const panel = read(PANEL);
        const baseTab = read(BASE_TAB);

        expect(baseTab, "BaseTab.tsx no longer emits vc-settings-tab").toContain('className="vc-settings-tab"');
        expect(baseTab, "BaseTab.tsx no longer emits it on a <section>").toMatch(/<section\s+className="vc-settings-tab"/);

        expect(arrayLiteral(panel, "BLOCKING_LAYER_SELECTORS")).toContain("section.vc-settings-tab");
    });

    it("Discord's own full-screen layers are matched by ARIA, not by a class name", () => {
        const list = arrayLiteral(read(PANEL), "BLOCKING_LAYER_SELECTORS");

        expect(list).toContain('[aria-modal="true"]');
        // A generated Discord class name in this list would rot on the next
        // client build and silently stop hiding the panel.
        expect(/class\*=/.test(list), "a generated class name crept into the layer list").toBe(false);
    });

    it("would notice BaseTab renaming the class (positive control)", () => {
        const renamed = '        <section className="vc-settings-page">{children}</section>';
        expect(/<section\s+className="vc-settings-tab"/.test(renamed)).toBe(false);
    });
});
