/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE WIRING LAYER for two privacy defects whose LOGIC is behaviour-tested in
 * test/modes.test.ts. Read that file first — `translationEnabled`,
 * `selectionGate` and `selectionAction` are unit-tested there against real
 * inputs, not against source text.
 *
 * What no unit test in this suite can reach is whether the plugin layer actually
 * ASKS those functions, because render.tsx and selection.ts resolve Vencord
 * aliases (@webpack/common, @api/*) that do not exist under vitest — the same
 * constraint test/meteredProviderChokepoint.test.ts, test/settingsCopy.test.ts
 * and test/usage.test.ts all record for state.ts and settings.ts. A source scan
 * is the only instrument that reaches this layer at all, so it is used ONLY for
 * the call sites, never for the decisions.
 *
 * The two defects:
 *
 * 1. THE DOUBLE-CLICK PATH HAD NO PRIVACY GUARD. translateSelection() checked
 *    that the selection was non-empty and that the click landed inside message
 *    content, then sent the text to the provider. It never asked the per-server
 *    toggle and never asked about DMs, so a double-click inside a private
 *    message — or inside a server the user had deliberately switched OFF — was a
 *    disclosure, and a billed one on the paid providers.
 *
 * 2. `includeDMs` WAS A DEAD SETTING. Its only two mentions in the tree were its
 *    own definition and a source-ORDERING scan in test/usage.test.ts. Nothing
 *    read the value, while index.tsx's first-run notice and PRIVACY.md both told
 *    the user it worked.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const SELECTION = join(PLUGIN, "selection.ts");
const RENDER = join(PLUGIN, "render.tsx");
const SETTINGS = join(PLUGIN, "settings.ts");
const MODES = join(PLUGIN, "core", "modes.ts");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

/** An import of the identifier, not a mention of it in a comment. */
function importsIdentifier(source: string, identifier: string): boolean {
    return new RegExp(
        `import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`,
        "m"
    ).test(source);
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** A call to the identifier, not a mention of it in a comment or a string. */
function callsIdentifier(source: string, identifier: string): boolean {
    return source
        .split("\n")
        .filter(line => !isCommentLine(line))
        .some(line => new RegExp(`\\b${identifier}\\s*\\(`).test(line));
}

/**
 * Character offset of the first NON-COMMENT line containing `needle`, or -1.
 *
 * Every ordering assertion below has to use this rather than `indexOf`, and the
 * first draft of this file did not — so "the gate runs before the provider is
 * obtained" compared the gate against selection.ts's own HEADER COMMENT, which
 * explains why translationProvider() is the only way to obtain a provider. The
 * guard was measuring prose and went red on correct code. A guard that cannot
 * tell an explanation from an instruction forbids the file from explaining
 * itself.
 */
function codeIndexOf(source: string, needle: string): number {
    let offset = 0;
    for (const line of source.split("\n")) {
        if (!isCommentLine(line) && line.includes(needle)) return offset;
        offset += line.length + 1;
    }
    return -1;
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

function pluginSources(): string[] {
    return walk(PLUGIN).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
}

describe("the guard measures something — instrument checks first", () => {
    it("every file it claims to read exists and is not empty", () => {
        for (const file of [SELECTION, RENDER, SETTINGS, MODES]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("scans a non-empty set of plugin sources, including the guarded ones", () => {
        const names = new Set(pluginSources().map(f => basename(f)));
        expect(pluginSources().length).toBeGreaterThan(0);
        for (const required of ["selection.ts", "render.tsx", "settings.ts"]) {
            expect(names.has(required), `${required} was not scanned`).toBe(true);
        }
    });

    it("its own matchers fire and abstain correctly (positive control)", () => {
        expect(importsIdentifier('import { selectionAction } from "./core/modes";', "selectionAction")).toBe(true);
        expect(importsIdentifier("// selectionAction lives in core/modes\n", "selectionAction")).toBe(false);

        expect(callsIdentifier("    const a = selectionAction(toggle, ctx);", "selectionAction")).toBe(true);
        expect(callsIdentifier("    // selectionAction(toggle, ctx) decides this", "selectionAction")).toBe(false);
        expect(callsIdentifier(" * selectionAction() is documented here", "selectionAction")).toBe(false);
    });

    it("its ordering matcher skips prose and finds the code (positive control)", () => {
        const sample = [
            "// translationProvider() is the only metered way in.",
            " * see translationProvider() above",
            "const gate = decide();",
            "const resolved = translationProvider();"
        ].join("\n");

        const call = codeIndexOf(sample, "translationProvider()");
        const gate = codeIndexOf(sample, "const gate =");
        expect(call).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(call);
        // A naive indexOf would have found the comment on line 1 and reported
        // the gate as running AFTER the provider.
        expect(sample.indexOf("translationProvider()")).toBeLessThan(gate);
        expect(codeIndexOf(sample, "nothing here")).toBe(-1);
    });
});

describe("includeDMs is read by the code, not just defined by it", () => {
    /**
     * The exact measurement that exposed the dead setting: which files actually
     * READ the value. Before the fix this set was EMPTY — the setting was
     * defined, documented in PRIVACY.md, promised in the first-run notice, and
     * consulted nowhere.
     */
    function readers(): string[] {
        return pluginSources()
            .filter(f => read(f).includes("settings.store.includeDMs"))
            .map(f => basename(f))
            .sort();
    }

    it("every path that can send message text reads it", () => {
        // render.tsx is the rendered mainline; selection.ts is double-click and
        // triple-click; state.ts is repaintChannel(), which enqueues a whole
        // channel's scrollback when a server is switched on — and is the ONLY
        // thing that enqueues anything in Both-Language mode, because
        // wrapContent() reads the cache and never requests. It consulted
        // toggle.isOn() directly until it was fixed, and toggle.isOn() cannot
        // see a DM opt-in, so includeDMs governed Replace mode and not
        // Both-Language: one setting, two answers, decided by mode.
        //
        // If any of these drops off this list, one of the ways this plugin
        // transmits text has stopped asking the user's DM decision.
        expect(readers()).toEqual(["render.tsx", "selection.ts", "state.ts"]);
    });

    it("it is still defined, and still ships OFF", () => {
        const src = read(SETTINGS);
        const start = src.indexOf("includeDMs: {");
        expect(start, "includeDMs was removed from settings.ts").toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf("\n    },", start));
        expect(block).toMatch(/default:\s*false/);
        expect(block).toMatch(/type:\s*OptionType\.BOOLEAN/);
    });

    it("would notice a default flipped to true (positive control)", () => {
        const mutated = "includeDMs: {\n        default: true,";
        expect(/default:\s*false/.test(mutated)).toBe(false);
    });

    it("the DM decision fails closed on an unset value", () => {
        // The behaviour is tested in modes.test.ts; this asserts the shipped
        // source still expresses it as an identity check rather than a truthiness
        // check, because `!includeDMs` and `includeDMs !== true` differ exactly
        // on the undefined a pre-hydration store returns.
        expect(read(MODES)).toContain("includeDMs === true");
    });
});

describe("the rendered path asks the one decision, not the toggle directly", () => {
    const src = () => read(RENDER);

    it("imports and calls translationEnabled", () => {
        expect(importsIdentifier(src(), "translationEnabled")).toBe(true);
        expect(callsIdentifier(src(), "translationEnabled")).toBe(true);
    });

    it("no longer consults ToggleState directly, which could not see a DM opt-in", () => {
        expect(callsIdentifier(src(), "toggle.isOn")).toBe(false);
    });

    it("guards BOTH render entry points — Replace mode and Both Language mode", () => {
        // transformMessage() is Mode A, wrapContent() is Mode B. A guard on one
        // and not the other is a mode the user can switch to in order to defeat
        // their own setting.
        const source = src();
        const calls = source.split("translationEnabled(").length - 1;
        // One import mention is not a call; count only the invocations.
        expect(calls).toBeGreaterThanOrEqual(2);

        for (const fn of ["export function transformMessage(", "export function wrapContent("]) {
            const start = source.indexOf(fn);
            expect(start, `${fn} not found in render.tsx`).toBeGreaterThan(-1);
            const body = source.slice(start, source.indexOf("\n}", start));
            expect(body, `${fn} does not consult translationEnabled`).toContain("translationEnabled(");
            expect(body).toContain("settings.store.includeDMs");
        }
    });
});

describe("the double-click path is gated before anything is sent", () => {
    const src = () => read(SELECTION);

    it("imports and calls selectionAction", () => {
        expect(importsIdentifier(src(), "selectionAction")).toBe(true);
        expect(callsIdentifier(src(), "selectionAction")).toBe(true);
    });

    it("decides BEFORE it obtains a provider", () => {
        // translationProvider() is the metered chokepoint; reaching it at all
        // means a request is about to be made. The decision has to be upstream of
        // it, not a check bolted on afterwards.
        const source = src();
        const decision = codeIndexOf(source, "selectionAction(toggle, {");
        const provider = codeIndexOf(source, "translationProvider()");
        expect(decision, "selectionAction() call not found").toBeGreaterThan(-1);
        expect(provider, "translationProvider() call not found").toBeGreaterThan(-1);
        expect(decision).toBeLessThan(provider);
    });

    it("returns on a refusal instead of falling through to the request", () => {
        const source = src();
        const refuse = codeIndexOf(source, 'action.kind === "refuse"');
        const provider = codeIndexOf(source, "translationProvider()");
        expect(refuse).toBeGreaterThan(-1);
        expect(refuse).toBeLessThan(provider);
        // The refusal branch must end the function; a missing `return` here is
        // the whole bug wearing a guard.
        expect(source.slice(refuse, provider)).toContain("return;");
    });

    it("passes the user's real setting, not a literal", () => {
        const source = src();
        const start = codeIndexOf(source, "selectionAction(toggle, {");
        expect(start, "selectionAction() call not found").toBeGreaterThan(-1);
        const args = source.slice(start, source.indexOf("});", start));
        expect(args).toContain("includeDMs: settings.store.includeDMs");
        // The guild id comes from the same resolver the rendered path uses;
        // inventing a second mechanism is how the two drift apart.
        expect(args).toContain("guildIdOf(");
    });

    it("an unidentifiable click is passed as null, not as a DM", () => {
        // `guildIdOf(undefined)` also returns null. Collapsing "not a server"
        // into "not identified" would let an unknown surface inherit whatever
        // the DM setting happens to be.
        expect(src()).toContain("ref ? { guildId: guildIdOf(ref.channelId) } : null");
    });

    it("does not consult ToggleState directly anywhere", () => {
        expect(callsIdentifier(src(), "toggle.isOn")).toBe(false);
    });
});

describe("seeing the original costs nothing", () => {
    const src = () => read(SELECTION);

    it("actually feeds the recovered original into the decision", () => {
        // Without this, `heldOriginal: null` would sever the free path while
        // leaving every other assertion in this file green: the decision would
        // still be correct and still be asked, just never told that the original
        // exists. The charge comes back and nothing goes red.
        const source = src();
        const start = codeIndexOf(source, "selectionAction(toggle, {");
        expect(start, "selectionAction() call not found").toBeGreaterThan(-1);
        const args = source.slice(start, source.indexOf("});", start));
        expect(args).toContain("heldOriginal: originalFor(");
        expect(args).toContain("reverseTo: reverseTargetFor(");
    });

    it("takes the original from the message store rather than re-translating it", () => {
        // render.tsx's Mode A hands the renderer a clone and never writes to
        // Discord's store, so the store still holds the original. The tooltip
        // says "double-click to see the original"; following it used to buy an
        // approximation of that text from a billed provider.
        const source = src();
        expect(importsIdentifier(source, "MessageStore")).toBe(true);
        expect(source).toContain("MessageStore.getMessage(");
    });

    it("serves it before the request path is reached at all", () => {
        const source = src();
        const held = codeIndexOf(source, 'action.kind === "showHeldOriginal"');
        const provider = codeIndexOf(source, "translationProvider()");
        expect(held).toBeGreaterThan(-1);
        expect(held).toBeLessThan(provider);
        expect(source.slice(held, provider)).toContain("return;");
    });

    it("still keeps the reverse-translation fallback for when it is genuinely gone", () => {
        // A message evicted from the store has no recoverable original. Deleting
        // the fallback would turn that case into a dead double-click.
        expect(callsIdentifier(src(), "reverseTargetFor")).toBe(true);
    });
});
