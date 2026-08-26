/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The spend cap has to be uncircumventable, and for one release it was not.
 *
 * requestTranslation() in state.ts obtained a provider, wrapped it in
 * meterIfBilled(), and was therefore counted and capped. selection.ts — the
 * double-click and triple-click path — obtained its own provider from the same
 * currentProvider() and translated through it RAW. A user who set a monthly
 * character cap kept paying past it through that door, and the usage figure they
 * were reading did not know those characters existed.
 *
 * The fix was structural: state.ts's translationProvider() is now the only way
 * to obtain a provider, and everything it returns is already metered. This file
 * is what keeps it that way. It fails if a second raw call site appears, which
 * is the failure mode a second meterIfBilled() call site would have.
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
 * state.ts is the single chokepoint that meters what it returns.
 */
const CURRENT_PROVIDER_ALLOWED = new Set(["provider.ts", "state.ts"]);

/**
 * The only two files allowed to construct a provider straight out of the
 * registry: provider.ts (which is what currentProvider does) and the registry
 * itself. core/ is excluded from the scan entirely — it is the registry's home
 * and knows nothing about metering, which is the point of the layering.
 */
const RESOLVE_PROVIDER_ALLOWED = new Set(["provider.ts"]);

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

describe("the metered provider is the only provider", () => {
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
            "a raw, unmetered provider call site appeared. Use translationProvider() from state.ts — " +
            "it is metered and capped; currentProvider() is not."
        ).toEqual([]);
    });

    it("nothing outside provider.ts reaches past it into the provider registry", () => {
        const offenders = scannedFiles()
            .filter(f => importsIdentifier(readFileSync(f, "utf8"), "resolveProvider"))
            .map(f => basename(f))
            .filter(name => !RESOLVE_PROVIDER_ALLOWED.has(name));

        expect(offenders, "resolveProvider() bypasses both provider.ts and the meter").toEqual([]);
    });

    it("would catch a new raw call site (positive control)", () => {
        const fake = 'import { currentProvider } from "./provider";\n';
        expect(importsIdentifier(fake, "currentProvider")).toBe(true);
        // …and does not fire on a mere mention in prose, which would make the
        // guard unmaintainable by forbidding people from explaining it.
        expect(importsIdentifier("// see currentProvider in provider.ts\n", "currentProvider")).toBe(false);
    });

    it("selection.ts goes through the chokepoint and holds no transport of its own", () => {
        const src = readFileSync(SELECTION, "utf8");

        expect(src).toContain("translationProvider()");
        expect(importsIdentifier(src, "translationProvider")).toBe(true);
        expect(importsIdentifier(src, "currentProvider")).toBe(false);
        // The duplicated transport type was how it obtained a raw provider at
        // all. Checked as an IMPORT so the comment above it may keep explaining
        // why it is gone — a guard that forbids its own explanation rots.
        expect(importsIdentifier(src, "HttpTransport")).toBe(false);
        expect(src).not.toContain("fetchTranslation");
    });

    it("state.ts's chokepoint meters what it hands out", () => {
        const src = readFileSync(STATE, "utf8");
        const start = src.indexOf("export function translationProvider(");
        expect(start, "translationProvider() not found in state.ts").toBeGreaterThan(-1);

        const body = src.slice(start, src.indexOf("\n}", start));
        expect(body).toContain("currentProvider(http)");
        expect(body).toContain("meterIfBilled(");
        expect(body).toContain("new UsageMeter(usageStore())");
        expect(body).toContain("monthlyCharacterCap");
    });

    it("the cap is read fresh per call, not captured once at module scope", () => {
        const src = readFileSync(STATE, "utf8");
        // A module-scope capture would also crash the whole mod; see
        // test/no-module-scope-settings.test.ts. Asserted here too because the
        // reason it matters HERE is different: a captured cap is a stale cap.
        expect(/^(?:export\s+)?(?:const|let|var)\s+[^\n]*monthlyCharacterCap/m.test(src)).toBe(false);
    });
});

/**
 * The poison-message loop, at the one layer that can see the wiring.
 *
 * The registry and the notice gate themselves are unit-tested in usage.test.ts.
 * What cannot be unit-tested is that state.ts actually consults them, and that
 * it does so on the right side of the cap/permanent distinction — so that is
 * asserted here against the shipped source.
 */
describe("state.ts stops paying for a message that will never translate", () => {
    const src = () => readFileSync(STATE, "utf8");

    it("refuses to re-enqueue a permanently failed message", () => {
        expect(src()).toContain("if (permanentFailures.has(flightKey)) return;");
    });

    it("marks only what the scheduler already calls permanent, so transient failures still recover", () => {
        const source = src();
        expect(source).toContain("if (isPermanent(err)) permanentFailures.mark(flightKey);");
        expect(importsIdentifier(source, "isPermanent")).toBe(true);
    });

    it("does NOT mark a cap refusal — it must resume the moment the user raises the cap", () => {
        const source = src();
        const catchStart = source.indexOf(".catch(err => {");
        expect(catchStart).toBeGreaterThan(-1);
        const capIndex = source.indexOf("isCapRefusal(err)", catchStart);
        const markIndex = source.indexOf("permanentFailures.mark(", catchStart);
        expect(capIndex).toBeGreaterThan(-1);
        expect(markIndex).toBeGreaterThan(-1);
        // The cap branch returns before the marking branch is ever reached.
        expect(capIndex).toBeLessThan(markIndex);
        expect(source.slice(capIndex, markIndex)).toContain("return;");
    });

    /** The text of a top-level `function name(` … `\n}` block in state.ts. */
    const fnBody = (source: string, name: string): string => {
        const start = source.indexOf(`function ${name}(`);
        expect(start, `${name}() not found in state.ts`).toBeGreaterThan(-1);
        const end = source.indexOf("\n}", start);
        expect(end, `${name}() is unterminated`).toBeGreaterThan(start);
        return source.slice(start, end);
    };

    it("clears the permanent-failure registry when the provider or the key changes", () => {
        const source = src();
        const body = fnBody(source, "syncTranslationIdentity");
        expect(body).toContain("permanentFailures.clear()");
        expect(body).toContain("capNotice.reset()");

        const identity = fnBody(source, "providerIdentity");
        expect(identity).toContain("settings.store.provider");
        expect(identity).toContain("deeplApiKey");
        expect(identity).toContain("googleCloudApiKey");
        // The key itself is never held in a module variable.
        expect(identity).toContain("hashContent(settings.store.deeplApiKey");
        expect(identity).toContain("hashContent(settings.store.googleCloudApiKey");
    });

    /**
     * THE DEFECT THIS REPLACES THE OLD ASSERTION FOR. The cap used to be folded
     * into the same fingerprint as the provider and the keys, so raising the cap
     * changed the fingerprint and wiped the permanent-failure registry — and
     * every message already proven unpayable-for was re-sent and re-BILLED, at
     * the exact moment the user had said they were willing to spend more. A
     * budget is not evidence about a message.
     *
     * The old test asserted `identity` CONTAINED monthlyCharacterCap, i.e. it
     * locked the defect in. This asserts the opposite, on the one function whose
     * change clears the registry.
     */
    it("does NOT fold the cap into the identity that clears the registry", () => {
        const identity = fnBody(src(), "providerIdentity");
        expect(
            identity,
            "raising the cap must not wipe the permanent-failure registry: it re-bills every " +
            "message that already permanently failed"
        ).not.toContain("monthlyCharacterCap");
    });

    it("a cap change still re-arms the refusal banner, and only that", () => {
        const source = src();
        // The cap has an identity of its own …
        expect(fnBody(source, "capIdentity")).toContain("monthlyCharacterCap");

        // … and the branch that reacts to it touches the banner, not the registry.
        const sync = fnBody(source, "syncTranslationIdentity");
        const capBranch = sync.slice(sync.indexOf("const cap = capIdentity();"));
        expect(capBranch, "the cap branch was not found in syncTranslationIdentity()").toContain(
            "lastCapIdentity"
        );
        expect(capBranch).toContain("capNotice.reset()");
        expect(capBranch).not.toContain("permanentFailures.clear()");
    });

    /**
     * The reason the change above is safe. A cap REFUSAL was never in the
     * registry: the catch returns on isCapRefusal(err) before the marking
     * branch, so a capped message resumes the instant the cap rises regardless
     * of what the identity functions do. Asserted directly above as
     * "does NOT mark a cap refusal"; restated here as the precondition for
     * removing the cap from providerIdentity(), so that if that ordering is ever
     * broken, the reader of THIS test is told what it was holding up.
     */
    it("cap refusals are excluded from the registry, which is why the cap need not clear it", () => {
        const source = src();
        const capIndex = source.indexOf("isCapRefusal(err)");
        const markIndex = source.indexOf("permanentFailures.mark(");
        expect(capIndex).toBeGreaterThan(-1);
        expect(markIndex).toBeGreaterThan(capIndex);
        expect(source.slice(capIndex, markIndex)).toContain("return;");
    });

    it("runs that sync before either guard is trusted", () => {
        const source = src();
        const syncCall = source.indexOf("    syncTranslationIdentity();");
        const guard = source.indexOf("if (permanentFailures.has(flightKey)) return;");
        expect(syncCall).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(-1);
        expect(syncCall).toBeLessThan(guard);
    });

    it("shows the cap refusal at most once per episode and re-arms on a real translation", () => {
        const source = src();
        expect(source).toContain("if (capNotice.claim()) warnProviderUnavailable(err.message);");
        expect(source).toContain("capNotice.reset();");
        // The re-arm has to be behind the "something was actually sent" check,
        // or a message with nothing to translate would re-arm it for free.
        const nullGuard = source.indexOf("if (!payload) return;");
        const rearm = source.indexOf("capNotice.reset();", nullGuard);
        expect(nullGuard).toBeGreaterThan(-1);
        expect(rearm).toBeGreaterThan(nullGuard);
    });
});
