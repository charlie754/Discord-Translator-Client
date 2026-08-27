/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ONE FUNCTION DECIDES WHAT THIS PLUGIN TALKS TO.
 *
 * This file used to be test/meteredProviderChokepoint.test.ts and its stated
 * reason was money: requestTranslation() in state.ts wrapped its provider in
 * meterIfBilled() and was therefore counted and capped, while selection.ts — the
 * double-click and triple-click path — obtained its own provider from the same
 * currentProvider() and translated through it RAW, so a user who had set a
 * monthly character cap kept paying past it through that door.
 *
 * The meter and the cap are gone: every surviving provider is free. THE GUARD IS
 * NOT. What it actually enforces outlived the bill — provider construction
 * happens in exactly one place, so "where does message text go, and with which
 * credential?" has a single answer read fresh from settings on every call. That
 * is what makes switching provider take effect on the next message rather than
 * the next Discord restart, and it matters MORE now that one of the two
 * surviving providers is an endpoint the user deployed themselves and pasted a
 * URL for.
 *
 * Both guards below are the ones that were here, at the same strength: nothing
 * outside provider.ts and state.ts may import currentProvider, and nothing
 * outside provider.ts may reach past it into the registry. A second call site is
 * a third one waiting to happen.
 *
 * A source scan, because neither state.ts nor selection.ts can be imported here:
 * both pull @api/* and @webpack/common, which need a running Discord client.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const STATE = join(PLUGIN, "state.ts");
const SELECTION = join(PLUGIN, "selection.ts");
const PROVIDER = join(PLUGIN, "provider.ts");

/**
 * The only two files allowed to name currentProvider: provider.ts defines it,
 * state.ts is the single chokepoint that hands out what it returns.
 */
const CURRENT_PROVIDER_ALLOWED = new Set(["provider.ts", "state.ts"]);

/**
 * The only file allowed to construct a provider straight out of the registry:
 * provider.ts, which is what currentProvider does. core/ is excluded from the
 * scan entirely — it is the registry's home and knows nothing about settings,
 * which is the point of the layering.
 */
const RESOLVE_PROVIDER_ALLOWED = new Set(["provider.ts"]);

/** Code, not commentary: every line whose first non-space characters are not a comment. */
function codeOnly(source: string): string {
    return source
        .split("\n")
        .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join("\n");
}

/** An import of the identifier, not a mention of it in a comment. */
function importsIdentifier(source: string, identifier: string): boolean {
    return new RegExp(`^import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`, "m").test(source);
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

/** Every plugin source file OUTSIDE core/. core/ has no access to settings and cannot resolve a provider. */
function scannedFiles(): string[] {
    const core = join(PLUGIN, "core");
    return walk(PLUGIN)
        .filter(f => f.endsWith(".ts") || f.endsWith(".tsx"))
        .filter(f => !f.startsWith(core));
}

describe("provider construction happens in exactly one place", () => {
    it("the files it claims to scan exist and are not empty", () => {
        for (const file of [STATE, SELECTION, PROVIDER]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(readFileSync(file, "utf8").length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("scans a non-empty set of files — a zero-file scan is a failure, not a pass", () => {
        const files = scannedFiles();
        expect(files.length, `no source files found under ${PLUGIN}`).toBeGreaterThan(0);
        const names = new Set(files.map(f => basename(f)));
        // If any of these drop out of the scan, the guard is measuring nothing.
        for (const required of ["state.ts", "selection.ts", "provider.ts"]) {
            expect(names.has(required), `${required} was not scanned`).toBe(true);
        }
    });

    it("nothing outside provider.ts and state.ts imports currentProvider", () => {
        const offenders = scannedFiles()
            .filter(f => importsIdentifier(readFileSync(f, "utf8"), "currentProvider"))
            .map(f => basename(f))
            .filter(name => !CURRENT_PROVIDER_ALLOWED.has(name));

        expect(
            offenders,
            "a second provider call site appeared. Use translationProvider() from state.ts — " +
            "it is the one place that decides what this plugin talks to and with which credential."
        ).toEqual([]);
    });

    it("nothing outside provider.ts reaches past it into the provider registry", () => {
        const offenders = scannedFiles()
            .filter(f => importsIdentifier(readFileSync(f, "utf8"), "resolveProvider"))
            .map(f => basename(f))
            .filter(name => !RESOLVE_PROVIDER_ALLOWED.has(name));

        expect(offenders, "resolveProvider() bypasses provider.ts and the chokepoint").toEqual([]);
    });

    it("would catch a new raw call site (positive control)", () => {
        const fake = 'import { currentProvider } from "./provider";\n';
        expect(importsIdentifier(fake, "currentProvider")).toBe(true);
        // …and does not fire on a mere mention in prose, which would make the
        // guard unmaintainable by forbidding people from explaining it.
        expect(importsIdentifier("// see currentProvider in provider.ts\n", "currentProvider")).toBe(false);

        // The same two properties for the call counter above.
        expect(codeOnly("const a = currentProvider(http);").match(/\bcurrentProvider\s*\(/g)).toHaveLength(1);
        expect(codeOnly(" * calls currentProvider(http) itself\n").match(/\bcurrentProvider\s*\(/g)).toBeNull();
    });

    it("selection.ts goes through the chokepoint and holds no transport of its own", () => {
        const src = readFileSync(SELECTION, "utf8");

        expect(src).toContain("translationProvider()");
        expect(importsIdentifier(src, "translationProvider")).toBe(true);
        expect(importsIdentifier(src, "currentProvider")).toBe(false);
        // The duplicated transport type was how it obtained a second provider at
        // all. Checked as an IMPORT so the comment above it may keep explaining
        // why it is gone — a guard that forbids its own explanation rots.
        expect(importsIdentifier(src, "HttpTransport")).toBe(false);
        expect(src).not.toContain("fetchTranslation");
    });

    it("state.ts's chokepoint is the single currentProvider() call", () => {
        const src = readFileSync(STATE, "utf8");
        const start = src.indexOf("export function translationProvider(");
        expect(start, "translationProvider() not found in state.ts").toBeGreaterThan(-1);

        const body = src.slice(start, src.indexOf("\n}", start));
        expect(body).toContain("currentProvider(http)");

        // Exactly one call in the whole file: the chokepoint's own. A second one
        // here is the same defect as a second one in another file. Counted over
        // code only — this file's own comments explain the rule at length, and a
        // guard that forbids its own explanation rots.
        const calls = codeOnly(src).match(/\bcurrentProvider\s*\(/g) ?? [];
        expect(calls, "state.ts must call currentProvider() exactly once").toHaveLength(1);
    });

    it("no provider decision is captured once at module scope", () => {
        const src = readFileSync(STATE, "utf8");
        // A module-scope settings read would also crash the whole mod; see
        // test/no-module-scope-settings.test.ts. Asserted here too because the
        // reason it matters HERE is different: a captured provider is a stale
        // provider, and switching provider would take a Discord restart.
        expect(/^(?:export\s+)?(?:const|let|var)\s+[^\n]*settings\.store\.provider/m.test(src)).toBe(false);
    });
});

/**
 * The poison-message loop, at the one layer that can see the wiring.
 *
 * PermanentFailureRegistry itself is unit-tested in test/requestBookkeeping.test.ts.
 * What cannot be unit-tested is that state.ts actually consults it — so that is
 * asserted here against the shipped source.
 */
describe("state.ts stops re-sending a message that will never translate", () => {
    const src = () => readFileSync(STATE, "utf8");

    it("refuses to re-enqueue a permanently failed message", () => {
        expect(src()).toContain("if (permanentFailures.has(flightKey)) return;");
    });

    it("marks only what the scheduler already calls permanent, so transient failures still recover", () => {
        const source = src();
        expect(source).toContain("if (isPermanent(err)) permanentFailures.mark(flightKey);");
        expect(importsIdentifier(source, "isPermanent")).toBe(true);
    });

    /** The text of a top-level `function name(` … `\n}` block in state.ts. */
    const fnBody = (source: string, name: string): string => {
        const start = source.indexOf(`function ${name}(`);
        expect(start, `${name}() not found in state.ts`).toBeGreaterThan(-1);
        const end = source.indexOf("\n}", start);
        expect(end, `${name}() is unterminated`).toBeGreaterThan(start);
        return source.slice(start, end);
    };

    it("clears the permanent-failure registry when the provider or the endpoint changes", () => {
        const source = src();
        const body = fnBody(source, "syncTranslationIdentity");
        expect(body).toContain("permanentFailures.clear()");

        const identity = fnBody(source, "providerIdentity");
        expect(identity).toContain("settings.store.provider");
        // The one live credential left. A message the free gtx endpoint refuses
        // is not a message the user's own deployment refuses.
        expect(identity).toContain("appsScriptUrl");
        // The credential itself is never held in a module variable.
        expect(identity).toContain("hashContent(settings.store.appsScriptUrl");
    });

    /**
     * THE DELETED PROVIDERS MUST NOT COME BACK THROUGH THIS DOOR. providerIdentity()
     * is a module-lifetime string; hashing a key here was how the two paid
     * providers' credentials were tracked. Both are gone, and so is any reason
     * for this function to know a key exists.
     */
    it("names no API key at all — there is no provider left that takes one", () => {
        const identity = fnBody(src(), "providerIdentity");
        expect(identity).not.toContain("deeplApiKey");
        expect(identity).not.toContain("googleCloudApiKey");
        expect(identity).not.toMatch(/apiKey/i);
    });

    it("runs that sync before the guard is trusted", () => {
        const source = src();
        const syncCall = source.indexOf("    syncTranslationIdentity();");
        const guard = source.indexOf("if (permanentFailures.has(flightKey)) return;");
        expect(syncCall).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(-1);
        expect(syncCall).toBeLessThan(guard);
    });
});
