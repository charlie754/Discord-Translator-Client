/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * `provider` is a persisted STRING. A user who deliberately chose one of the two
 * paid providers — they went and got an API key for it — still has that id on
 * disk after updating to a build whose registry no longer holds it. From that
 * moment resolveProvider() answers EVERY translation with
 *
 *     Unknown translation provider "deepl".
 *
 * which is developer wording for a state the user cannot see and did not cause.
 * It never heals: the id is still there next launch, and the next, forever.
 *
 * The settings screen could not even show them what was wrong.
 * src/components/settings/tabs/plugins/components/SelectSetting.tsx picks the
 * highlighted entry with `isSelected={v => v === state}` over `setting.options`
 * — an id absent from that list matches no option, so the control falls back to
 * its placeholder and reads as merely unset. (Reasoned from SelectSetting.tsx;
 * Discord's own <Select> is a webpack module and cannot be rendered here.)
 *
 * THE FIX, asserted below: on start, a persisted provider the REGISTRY cannot
 * serve is reset to the dropdown's default and the user is told once, in
 * ordinary language.
 *
 * ── WHY THIS FILE EXECUTES RATHER THAN SCANNING ──────────────────────────────
 *
 * Its siblings record why the plugin is hard to import under vitest: state.ts,
 * index.tsx and settings.ts resolve @api/*, @webpack/common and ~git-remote,
 * aliases that exist only inside the Vencord build, so
 * test/panelSettingsOverlap.test.ts and test/providerChokepoint.test.ts scan
 * source TEXT. A text scan is the wrong instrument for every claim here: "the
 * stored value is reset", "the user is told once" and "the valid set comes from
 * the registry" are all statements about what RUNS.
 *
 * So this file compiles the real provider.ts and the real index.tsx with
 * esbuild — the compiler the real build uses — and evaluates them with only the
 * unresolvable modules stubbed. Two things are deliberately NOT stubbed:
 *
 *   core/providers/registry.ts  is the REAL module, imported straight into this
 *                               file (core/ resolves fine under vitest) and
 *                               handed to the module under test. Both therefore
 *                               hold the SAME Map instance, which is what makes
 *                               "adding or removing a registry entry changes
 *                               what migrates" a measurement rather than a
 *                               restatement of the implementation.
 *
 *   provider.ts, inside index.tsx is the real compiled module, so the start()
 *                               test is genuinely end-to-end: persisted id in,
 *                               settings write and notice out.
 *
 * `settings.store` is the one thing that must be faked — it is a live Discord
 * settings proxy — and PROVIDER_OPTIONS / DEFAULT_PROVIDER_ID are loaded out of
 * the REAL settings.ts rather than retyped, so no provider id or label in this
 * file is a second copy of one in the source.
 *
 * Every matcher is exercised against text that must match AND text that must
 * not, in `describe("instrument controls")` at the foot of the file.
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registry } from "../src/plugins/channelTranslator/core/providers/registry";
import type { ProviderFactory } from "../src/plugins/channelTranslator/core/providers/types";

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "src", "plugins", "channelTranslator");
const PROVIDER_PATH = join(PLUGIN, "provider.ts");
const INDEX_PATH = join(PLUGIN, "index.tsx");
const SETTINGS_PATH = join(PLUGIN, "settings.ts");

const read = (path: string): string => readFileSync(path, "utf8");

/**
 * The registry as it ships, captured before any test touches it.
 *
 * Several tests below add and remove entries — that is the point of them — and
 * the Map is a module singleton shared with the compiled provider.ts. Restoring
 * from this snapshot in beforeEach is what stops one test's mutation leaking
 * into the next and quietly making it pass.
 */
const SHIPPED_REGISTRY: ReadonlyArray<readonly [string, ProviderFactory]> = [...registry.entries()];

function restoreRegistry(): void {
    registry.clear();
    for (const [id, make] of SHIPPED_REGISTRY) registry.set(id, make);
}

// ───────────────────────────────────────────────────────────────────────────
// The real settings.ts, for its two exported constants and nothing else.
// ───────────────────────────────────────────────────────────────────────────

interface SettingsConstants {
    PROVIDER_OPTIONS: Array<{ value: string; label: string; default?: boolean; }>;
    DEFAULT_PROVIDER_ID: string;
}

/**
 * Compile and evaluate the real settings.ts far enough to read its exports.
 *
 * Unknown module ids THROW rather than returning a permissive stub, for the
 * reason test/guideTarget.test.ts gives: a catch-all would let this keep passing
 * after settings.ts grew an import nobody here had considered.
 */
function loadSettingsConstants(): SettingsConstants {
    const compiled = transformSync(read(SETTINGS_PATH), {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "settings.ts"
    }).code;

    // OptionType.SELECT and friends are read while the module body runs.
    const optionType = new Proxy({}, { get: (_t, key) => String(key) });

    const modules: Record<string, unknown> = {
        "@api/Settings": { definePluginSettings: (def: Record<string, any>) => ({ store: {}, def }) },
        "@components/Button": { Button: "Button" },
        "@components/Heading": { Heading: "Heading" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/types": { OptionType: optionType },
        "@utils/web-metadata": { EXTENSION_BASE_URL: undefined },
        "@webpack/common": { React: { createElement: () => null } },
        "~git-remote": { __esModule: true, default: "charlie754/Discord-Translator-Client" }
    };

    const require_ = (id: string) => {
        if (!(id in modules)) throw new Error(`settings.ts imported ${JSON.stringify(id)}, unstubbed here`);
        return modules[id];
    };

    const module_ = { exports: {} as SettingsConstants };
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "IS_EXTENSION", compiled)(
        require_, module_, module_.exports, false
    );
    return module_.exports;
}

const REAL = loadSettingsConstants();

// ───────────────────────────────────────────────────────────────────────────
// The harness: provider.ts and index.tsx, really executed.
// ───────────────────────────────────────────────────────────────────────────

interface Store {
    provider: any;
    appsScriptUrl: string;
    consentGiven: boolean;
    targetLanguage: string;
    includeDMs: boolean;
}

interface Notice {
    message: string;
    buttonText: string;
}

interface Harness {
    /** The fake settings store both modules share, exactly as they left it. */
    store: Store;
    /** Every banner put in front of the user, in order. The instrument. */
    notices: Notice[];
    migrate(): void;
    /** The plugin object index.tsx default-exports. */
    plugin: { start(): void; stop(): void; };
    /** What `provider` read as at the moment hydrate() was called, per call. */
    hydrateSawProvider: string[];
    /** Timers start() scheduled, so the 15s patch check cannot outlive the test. */
    timers: number[];
}

interface HarnessOptions {
    /** Lets a test mutate real source to prove an assertion can actually fail. */
    patchProvider?: (source: string) => string;
    /**
     * Seed `provider` BEFORE the modules are evaluated. The module-scope test
     * below needs the bad value already on disk at import time — seeding it
     * afterwards would prove nothing, because a module-scope migration would
     * have run against the default and found nothing to do.
     */
    provider?: unknown;
}

function compile(path: string, patch: (s: string) => string = s => s): string {
    return transformSync(patch(read(path)), {
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: path
    }).code;
}

/**
 * Build a fresh session: a new store, an empty notice log, and freshly
 * instantiated modules.
 *
 * FRESH MATTERS. provider.ts keeps `reasonShown` in a module variable — that is
 * how warnProviderUnavailable() deduplicates — so a module reused across tests
 * would carry one test's notice into the next and make "told once" pass for the
 * wrong reason.
 */
function makeHarness(opts: HarnessOptions = {}): Harness {
    const store: Store = {
        provider: "provider" in opts ? opts.provider : REAL.DEFAULT_PROVIDER_ID,
        appsScriptUrl: "",
        consentGiven: true,
        targetLanguage: "en",
        includeDMs: false
    };
    const notices: Notice[] = [];
    const hydrateSawProvider: string[] = [];
    const timers: number[] = [];

    const notices_ = {
        showNotice: (message: string, buttonText: string) => notices.push({ message, buttonText }),
        popNotice: () => undefined
    };

    // ── provider.ts ────────────────────────────────────────────────────────
    const providerModules: Record<string, unknown> = {
        "@api/Notices": notices_,
        // THE REAL REGISTRY. Same Map object this file mutates in the tests below.
        "./core/providers/registry": { registry, resolveProvider: () => ({ ok: false, reason: "unused here" }) },
        "./settings": {
            settings: { store },
            PROVIDER_OPTIONS: REAL.PROVIDER_OPTIONS,
            DEFAULT_PROVIDER_ID: REAL.DEFAULT_PROVIDER_ID
        }
    };
    const providerModule = { exports: {} as { migrateUnavailableProvider(): void; } };
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", compile(PROVIDER_PATH, opts.patchProvider))(
        (id: string) => {
            if (!(id in providerModules)) throw new Error(`provider.ts imported ${JSON.stringify(id)}, unstubbed here`);
            return providerModules[id];
        },
        providerModule,
        providerModule.exports
    );

    // ── index.tsx ──────────────────────────────────────────────────────────
    const indexModules: Record<string, unknown> = {
        "./styles.css": {},
        "@api/Notices": notices_,
        "@utils/types": { __esModule: true, default: (plugin: unknown) => plugin },
        "./panel": { mountPanel: () => undefined, unmountPanel: () => undefined },
        "./patches": { CHANNEL_TRANSLATOR_PATCHES: [], patchHit: () => true },
        // THE REAL provider.ts, so start() is end-to-end rather than a stub call.
        "./provider": providerModule.exports,
        "./render": { transformMessage: () => undefined, wrapContent: () => undefined },
        "./selection": { installSelectionHandler: () => undefined, removeSelectionHandler: () => undefined },
        "./settings": { settings: { store } },
        "./state": { hydrate: () => void hydrateSawProvider.push(store.provider) }
    };
    const indexModule = { exports: {} as { default: { start(): void; stop(): void; }; } };
    // `setTimeout` arrives as a parameter, shadowing the global, so the 15-second
    // patch check start() schedules is recorded instead of actually running.
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "setTimeout", compile(INDEX_PATH))(
        (id: string) => {
            if (!(id in indexModules)) throw new Error(`index.tsx imported ${JSON.stringify(id)}, unstubbed here`);
            return indexModules[id];
        },
        indexModule,
        indexModule.exports,
        (_fn: () => void, ms: number) => void timers.push(ms)
    );

    return {
        store,
        notices,
        migrate: () => providerModule.exports.migrateUnavailableProvider(),
        plugin: indexModule.exports.default,
        hydrateSawProvider,
        timers
    };
}

/** A stand-in factory for a provider id a test puts back into the registry. */
const fakeFactory = (id: string): ProviderFactory => () => ({
    id,
    label: id,
    needsKey: false,
    translate: async () => []
});

/** Code, not commentary: every line whose first non-space characters are not a comment. */
function codeOnly(source: string): string {
    return source
        .split("\n")
        .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join("\n");
}

/** The body of a `name: {` … `\n    },` block inside the definePluginSettings literal. */
function settingBlock(src: string, name: string): string {
    const start = src.indexOf(`\n    ${name}: {`);
    if (start === -1) throw new Error(`setting not found: ${name}`);
    const end = src.indexOf("\n    },", start);
    if (end === -1) throw new Error(`unterminated setting block: ${name}`);
    return src.slice(start, end);
}

/** The body of index.tsx's `start()`, comments stripped. */
function startBody(src: string): string {
    const code = codeOnly(src);
    const start = code.indexOf("    start() {");
    if (start === -1) throw new Error("start() not found in index.tsx");
    const end = code.indexOf("\n    },", start);
    if (end === -1) throw new Error("start() is unterminated");
    return code.slice(start, end);
}

/**
 * Words a banner about someone else's decision must not use.
 *
 * The user picked a provider that was on offer at the time and it was withdrawn
 * from under them. Nothing they did was an error, nothing is invalid, and
 * nothing failed — and "Unknown translation provider" is the developer string
 * this whole change exists to stop them ever reading.
 */
const ALARMING = [
    /\berror\b/i,
    /\binvalid\b/i,
    /\bfailed\b/i,
    /\bcorrupt/i,
    /\bunsupported\b/i,
    /Unknown translation provider/
];

let harness: Harness;

beforeEach(() => {
    restoreRegistry();
    harness = makeHarness();
});

afterEach(() => {
    restoreRegistry();
});

// ───────────────────────────────────────────────────────────────────────────

describe("the harness measures the real thing", () => {
    it("loaded the real settings.ts constants, not a copy typed in here", () => {
        expect(REAL.PROVIDER_OPTIONS.length).toBeGreaterThan(0);
        expect(REAL.DEFAULT_PROVIDER_ID).toBeTruthy();
        // The default is one of the options, and it is the one flagged default.
        expect(REAL.PROVIDER_OPTIONS.find(o => o.default)?.value).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it("the dropdown default is a provider the registry can actually serve", () => {
        // If this ever goes red the migration would move users onto something
        // that refuses every translation, which is the bug it exists to fix.
        expect(registry.has(REAL.DEFAULT_PROVIDER_ID)).toBe(true);
    });

    it("every id the dropdown offers is in the registry", () => {
        const orphans = REAL.PROVIDER_OPTIONS.filter(o => !registry.has(o.value)).map(o => o.value);
        expect(orphans, `the settings dropdown offers providers the registry cannot serve: ${orphans.join(", ")}`)
            .toEqual([]);
    });

    it("is running the real modules, not stubs of them", () => {
        expect(typeof harness.migrate).toBe("function");
        expect(typeof harness.plugin.start).toBe("function");
        expect(typeof harness.plugin.stop).toBe("function");
    });

    it("the shipped registry it snapshots is not empty — an empty one makes every loop vacuous", () => {
        expect(SHIPPED_REGISTRY.length).toBeGreaterThanOrEqual(2);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (a) A persisted value the registry cannot serve is reset.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Deliberately more than the two providers that were just removed. The rule is
 * "the registry cannot serve this", so a corrupted value, a hand edit and a
 * blank must all be repaired by the same code path — and none of these strings
 * appears in provider.ts, which is asserted separately below.
 */
const UNSERVABLE: ReadonlyArray<readonly [string, unknown]> = [
    ["the paid provider a user had chosen", "deepl"],
    ["the other paid provider", "google-cloud"],
    ["a provider from some future build", "not-invented-yet"],
    ["a hand-edited settings file", "GOOGLE"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a value that is not a string at all", null]
];

describe("a persisted provider the registry cannot serve is reset", () => {
    it.each(UNSERVABLE)("%s is reset to the dropdown default", (_label, stored) => {
        harness.store.provider = stored;
        harness.migrate();
        expect(harness.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it.each(UNSERVABLE)("%s leaves the user with a provider that resolves", (_label, stored) => {
        harness.store.provider = stored;
        harness.migrate();
        expect(registry.has(harness.store.provider)).toBe(true);
    });

    it("changes nothing else in the settings store", () => {
        harness.store.provider = "deepl";
        harness.store.appsScriptUrl = "https://script.google.com/macros/s/KEEPME/exec";
        harness.store.targetLanguage = "ja";
        harness.store.includeDMs = true;

        harness.migrate();

        // Named individually rather than as a snapshot so a failure says which
        // setting was clobbered. The Apps Script URL is the one that matters
        // most: it is a credential the user pasted.
        expect(harness.store.appsScriptUrl).toBe("https://script.google.com/macros/s/KEEPME/exec");
        expect(harness.store.targetLanguage).toBe("ja");
        expect(harness.store.includeDMs).toBe(true);
        expect(harness.store.consentGiven).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (b) A persisted value the registry CAN serve is left completely alone.
// ───────────────────────────────────────────────────────────────────────────

describe("a provider the registry can serve is left completely untouched", () => {
    // Derived from the registry, not written out, so a provider added later is
    // covered without editing this file.
    const servable = SHIPPED_REGISTRY.map(([id]) => id);

    it("there is more than one servable provider to check", () => {
        // Without this the two loops below could pass on an empty list.
        expect(servable.length).toBeGreaterThanOrEqual(2);
    });

    it.each(servable)("%s is not rewritten", id => {
        harness.store.provider = id;
        harness.migrate();
        expect(harness.store.provider).toBe(id);
    });

    it.each(servable)("%s produces no banner at all", id => {
        harness.store.provider = id;
        harness.migrate();
        expect(harness.notices).toEqual([]);
    });

    it("apps-script with no URL saved is NOT migrated — that is a config state, not a dead provider", () => {
        // resolveProvider() would refuse this (needsKey with no credential).
        // Migrating on that would silently move a user off Apps Script the
        // moment their Web App URL was blank, e.g. while they were pasting it.
        harness.store.provider = "apps-script";
        harness.store.appsScriptUrl = "";
        harness.migrate();
        expect(harness.store.provider).toBe("apps-script");
        expect(harness.notices).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (c) The valid set is the registry's, not a literal.
// ───────────────────────────────────────────────────────────────────────────

describe("the valid set comes from the registry, not a duplicated list", () => {
    it("ADDING an entry stops that id migrating", () => {
        registry.set("deepl", fakeFactory("deepl"));
        harness.store.provider = "deepl";

        harness.migrate();

        expect(
            harness.store.provider,
            "\"deepl\" is in the registry now, so nothing should have touched it. A hardcoded " +
            "list of retired ids would have migrated it anyway."
        ).toBe("deepl");
        expect(harness.notices).toEqual([]);
    });

    it("REMOVING an entry starts that id migrating", () => {
        expect(registry.has("apps-script"), "precondition").toBe(true);
        registry.delete("apps-script");
        harness.store.provider = "apps-script";

        harness.migrate();

        expect(harness.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
        expect(harness.notices).toHaveLength(1);
    });

    it("the same id migrates or not purely according to the registry (the pair, in one test)", () => {
        const a = makeHarness();
        a.store.provider = "some-future-provider";
        a.migrate();
        expect(a.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);

        registry.set("some-future-provider", fakeFactory("some-future-provider"));

        const b = makeHarness();
        b.store.provider = "some-future-provider";
        b.migrate();
        expect(b.store.provider).toBe("some-future-provider");
    });

    it("the TARGET is registry-derived too — dropping the default moves users to what is left", () => {
        registry.delete(REAL.DEFAULT_PROVIDER_ID);
        harness.store.provider = "deepl";

        harness.migrate();

        expect(harness.store.provider).not.toBe(REAL.DEFAULT_PROVIDER_ID);
        expect(registry.has(harness.store.provider)).toBe(true);
    });

    it("an empty registry changes nothing rather than writing a second broken value", () => {
        registry.clear();
        harness.store.provider = "deepl";

        harness.migrate();

        expect(harness.store.provider).toBe("deepl");
        expect(harness.notices).toEqual([]);
    });

    it("provider.ts names none of the removed ids in its own code", () => {
        const code = codeOnly(read(PROVIDER_PATH));
        for (const id of ["deepl", "google-cloud", "googleCloud", "DeepL"]) {
            expect(code, `${id} appears in provider.ts code — the rule must be "not in the registry"`)
                .not.toContain(id);
        }
    });

    it("index.tsx names none of the removed ids in its own code", () => {
        const code = codeOnly(read(INDEX_PATH));
        for (const id of ["deepl", "google-cloud", "DeepL"]) {
            expect(code, `${id} appears in index.tsx code`).not.toContain(id);
        }
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (d) The user is told, once, in words meant for them.
// ───────────────────────────────────────────────────────────────────────────

describe("the user is told, once", () => {
    const migrated = (): Notice => {
        harness.store.provider = "deepl";
        harness.migrate();
        expect(harness.notices, "no banner was shown at all").toHaveLength(1);
        return harness.notices[0];
    };

    it("shows exactly one banner", () => {
        harness.store.provider = "deepl";
        harness.migrate();
        expect(harness.notices).toHaveLength(1);
    });

    it("a second call in the same session adds no second banner", () => {
        harness.store.provider = "deepl";
        harness.migrate();
        // Put the bad value back so the second call has the same work to do.
        // Without warnProviderUnavailable()'s dedup this is where a second
        // banner would stack up behind the first.
        harness.store.provider = "deepl";
        harness.migrate();

        expect(harness.notices).toHaveLength(1);
        expect(harness.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it("goes through warnProviderUnavailable, so it carries the product prefix", () => {
        expect(migrated().message.startsWith("Discord Translator: ")).toBe(true);
        expect(migrated().buttonText).toBe("OK");
    });

    it("names the provider the user actually had", () => {
        expect(migrated().message).toContain("\"deepl\"");
    });

    it("names the provider they are on now, in the dropdown's own words", () => {
        const label = REAL.PROVIDER_OPTIONS.find(o => o.value === REAL.DEFAULT_PROVIDER_ID)!.label;
        expect(migrated().message).toContain(label);
    });

    it("says what changed and that nothing was lost", () => {
        const { message } = migrated();
        expect(message).toContain("switched");
        expect(message).toContain("Nothing else in your settings was changed");
        expect(message).toContain("nothing you saved was deleted");
    });

    it("says it costs nothing", () => {
        expect(migrated().message).toContain("cannot bill you");
    });

    it("points at the other free option that is still there", () => {
        const other = REAL.PROVIDER_OPTIONS.find(o => o.value !== REAL.DEFAULT_PROVIDER_ID)!;
        expect(migrated().message).toContain(other.label);
    });

    it("uses no alarming or blaming language, and never the developer string", () => {
        const { message } = migrated();
        const offenders = ALARMING.filter(rx => rx.test(message)).map(String);
        expect(offenders, `the banner reads as an error: ${offenders.join(", ")}`).toEqual([]);
    });

    it.each([
        ["a missing value", null],
        ["an empty string", ""],
        ["whitespace only", "   "]
    ])("%s still reads as a sentence, with no empty quotes and no \"undefined\"", (_label, stored) => {
        harness.store.provider = stored;
        harness.migrate();
        const { message } = harness.notices[0];

        expect(message).not.toContain("undefined");
        expect(message).not.toContain("null");
        // The dash-quote-dash clause must be DROPPED, not emitted empty. Merely
        // asserting the leading phrase is present cannot tell the two apart —
        // measured: a build with the guard deleted still contains it, followed
        // by `— "" —`. This is the assertion that separates them.
        expect(message, "the id clause was emitted with nothing in it").not.toMatch(/—\s*""\s*—/);
        expect(message).toContain("The translation provider your settings had is no longer");
    });

    it("a hand-edited settings file cannot turn the banner into a wall of text", () => {
        const huge = "x".repeat(5000);
        harness.store.provider = huge;
        harness.migrate();
        const { message } = harness.notices[0];
        expect(message).not.toContain(huge);
        expect(message.length).toBeLessThan(1000);
        expect(message).toContain("…");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (e) End to end, through the plugin's real start().
// ───────────────────────────────────────────────────────────────────────────

describe("start() repairs the stored provider, once, before anything reads it", () => {
    it("merely LOADING index.tsx migrates nothing — settings must not be read at module scope", () => {
        // The dead id is in the store BEFORE the modules are evaluated, so a
        // migration at module scope would already have fired and rewritten it by
        // the time makeHarness() returns. In a real client that read would have
        // thrown "Cannot access settings before plugin is initialized" during
        // module evaluation and taken every plugin down with it — see
        // test/no-module-scope-settings.test.ts.
        const fresh = makeHarness({ provider: "deepl" });

        expect(fresh.store.provider, "something migrated at module scope").toBe("deepl");
        expect(fresh.notices, "something showed a banner at module scope").toEqual([]);

        // …and the same harness DOES migrate once start() is called, so the two
        // assertions above are not passing because the module never loaded.
        fresh.plugin.start();
        expect(fresh.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it("a stranded user is back on a working provider after start()", () => {
        harness.store.provider = "deepl";
        harness.plugin.start();
        expect(harness.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it("and is told once, by the same banner", () => {
        harness.store.provider = "deepl";
        harness.plugin.start();
        const migration = harness.notices.filter(n => n.message.includes("switched"));
        expect(migration).toHaveLength(1);
    });

    it("the repair happens BEFORE hydrate(), so nothing downstream sees the dead id", () => {
        harness.store.provider = "deepl";
        harness.plugin.start();
        expect(harness.hydrateSawProvider).toEqual([REAL.DEFAULT_PROVIDER_ID]);
    });

    it("a user who was fine sees no banner and no change", () => {
        harness.store.provider = REAL.DEFAULT_PROVIDER_ID;
        harness.plugin.start();
        expect(harness.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
        expect(harness.notices).toEqual([]);
    });

    it("the first-run notice still fires and is not displaced by the migration", () => {
        const fresh = makeHarness();
        fresh.store.consentGiven = false;
        fresh.store.provider = "deepl";
        fresh.plugin.start();

        expect(fresh.notices).toHaveLength(2);
        expect(fresh.notices.some(n => n.message.includes("switched"))).toBe(true);
        expect(fresh.notices.some(n => n.buttonText === "Understood")).toBe(true);
    });

    it("start() still does the rest of its job", () => {
        harness.store.provider = "deepl";
        harness.plugin.start();
        // The 15-second patch check is still scheduled — the migration was
        // inserted, not substituted for what was already there.
        expect(harness.timers).toEqual([15000]);
        expect(harness.hydrateSawProvider).toHaveLength(1);
    });

    it("calls migrateUnavailableProvider exactly once, inside start(), never at module scope", () => {
        const src = read(INDEX_PATH);
        const code = codeOnly(src);
        const calls = code.match(/\bmigrateUnavailableProvider\s*\(/g) ?? [];
        expect(calls, "index.tsx must call the migration exactly once").toHaveLength(1);
        expect(startBody(src)).toContain("migrateUnavailableProvider();");

        // And not at column 0, which is what test/no-module-scope-settings.test.ts
        // exists for. Asserted here too because the reason differs: a module-scope
        // call would also run before pluginName is assigned.
        expect(/^(?:export\s+)?(?:const|let|var)\s+[^\n]*migrateUnavailableProvider/m.test(code)).toBe(false);
        expect(/^migrateUnavailableProvider\s*\(/m.test(code)).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (f) The source-level facts execution cannot see.
// ───────────────────────────────────────────────────────────────────────────

describe("settings.ts single-sources the provider list", () => {
    it("the dropdown draws its options from PROVIDER_OPTIONS, not a second inline list", () => {
        const block = settingBlock(read(SETTINGS_PATH), "provider");
        expect(block).toContain("options: PROVIDER_OPTIONS");
        expect(block, "an inline options array came back").not.toMatch(/options:\s*\[/);
    });

    it("exports both constants provider.ts imports", () => {
        const src = read(SETTINGS_PATH);
        expect(src).toContain("export const PROVIDER_OPTIONS");
        expect(src).toContain("export const DEFAULT_PROVIDER_ID");
    });

    it("derives DEFAULT_PROVIDER_ID from the option marked default rather than restating it", () => {
        const src = codeOnly(read(SETTINGS_PATH));
        const start = src.indexOf("export const DEFAULT_PROVIDER_ID");
        expect(start).toBeGreaterThan(-1);
        const decl = src.slice(start, src.indexOf(";", start));
        expect(decl).toContain("PROVIDER_OPTIONS");
        expect(decl, "the default id was written out a second time").not.toMatch(/=\s*"[a-z-]+"/);
    });
});

describe("the three touched files keep their licence headers", () => {
    it.each([
        ["provider.ts", PROVIDER_PATH],
        ["index.tsx", INDEX_PATH],
        ["settings.ts", SETTINGS_PATH]
    ])("%s", (_name, path) => {
        const src = read(path);
        expect(src).toContain("SPDX-License-Identifier: GPL-3.0-or-later");
        expect(src).toContain("Copyright (c) 2026 IRP_HongKong");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (g) Mutation controls: the assertions above must be able to fail.
// ───────────────────────────────────────────────────────────────────────────

describe("mutation controls — each assertion above can actually go red", () => {
    it("deleting the settings write leaves the stored value stranded", () => {
        const mutant = makeHarness({
            patchProvider: s => s.replace("settings.store.provider = target;", ";")
        });
        mutant.store.provider = "deepl";
        mutant.migrate();

        // The reset assertion is measuring the write, not something incidental.
        expect(mutant.store.provider).toBe("deepl");
    });

    it("deleting the banner leaves the user uninformed", () => {
        const mutant = makeHarness({
            // Anchored on a line start so it hits the call and not the
            // declaration or the paragraph of prose that names the function.
            patchProvider: s => s.replace(/\n(\s*)warnProviderUnavailable\(/, "\n$1String(")
        });
        mutant.store.provider = "deepl";
        mutant.migrate();

        expect(mutant.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
        expect(mutant.notices, "the banner assertion is measuring the banner").toEqual([]);
    });

    it("asking the DROPDOWN instead of the REGISTRY breaks the registry-derived claim", () => {
        // The exact defect the design constraint forbids: derive "does it work?"
        // from the label list. Adding deepl to the registry then has no effect.
        const mutant = makeHarness({
            patchProvider: s => s.replace(
                "if (registry.has(current)) return;",
                "if (PROVIDER_OPTIONS.some(o => o.value === current)) return;"
            )
        });
        registry.set("deepl", fakeFactory("deepl"));
        mutant.store.provider = "deepl";
        mutant.migrate();

        expect(
            mutant.store.provider,
            "the registry test above would pass even against a dropdown-derived rule"
        ).toBe(REAL.DEFAULT_PROVIDER_ID);
    });

    it("removing the dedup makes a second call stack a second banner", () => {
        const mutant = makeHarness({
            patchProvider: s => s.replace("if (reason === reasonShown) return;", ";")
        });
        mutant.store.provider = "deepl";
        mutant.migrate();
        mutant.store.provider = "deepl";
        mutant.migrate();

        expect(mutant.notices, "the told-once assertion is measuring the dedup").toHaveLength(2);
    });

    it("patchProvider really is patching (negative control)", () => {
        // An unpatched harness must behave normally, so the four controls above
        // cannot be passing because patchProvider silently does nothing.
        const unpatched = makeHarness({ patchProvider: s => s });
        unpatched.store.provider = "deepl";
        unpatched.migrate();
        expect(unpatched.store.provider).toBe(REAL.DEFAULT_PROVIDER_ID);
        expect(unpatched.notices).toHaveLength(1);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// (h) Instrument controls for every matcher this file writes.
// ───────────────────────────────────────────────────────────────────────────

describe("instrument controls", () => {
    it("codeOnly strips comment lines and keeps live ones", () => {
        expect(codeOnly('const x = "deepl";')).toContain("deepl");
        expect(codeOnly(' * the "deepl" provider is gone\n')).not.toContain("deepl");
        expect(codeOnly('// "deepl" is gone\n')).not.toContain("deepl");
    });

    it("settingBlock finds a real setting and throws on one that is absent", () => {
        expect(settingBlock(read(SETTINGS_PATH), "provider").length).toBeGreaterThan(100);
        expect(() => settingBlock(read(SETTINGS_PATH), "deeplApiKey")).toThrow(/setting not found/);
    });

    it("startBody returns start()'s body and not the whole file", () => {
        const body = startBody(read(INDEX_PATH));
        expect(body).toContain("hydrate();");
        expect(body, "startBody ran past the end of start()").not.toContain("stop() {");
    });

    it("startBody throws rather than returning \"\" when the anchor is gone", () => {
        expect(() => startBody("export default {};")).toThrow(/start\(\) not found/);
    });

    it("the ALARMING battery fires on the shipped developer string (positive control)", () => {
        expect(ALARMING.some(rx => rx.test('Unknown translation provider "deepl".'))).toBe(true);
        expect(ALARMING.some(rx => rx.test("The API key is invalid"))).toBe(true);
    });

    it("the ALARMING battery does not fire on ordinary reassurance (negative control)", () => {
        const kind =
            "You have been switched to Google (free). It needs no key, no account and no card, " +
            "and it cannot bill you. Nothing you saved was deleted.";
        expect(ALARMING.some(rx => rx.test(kind))).toBe(false);
    });

    it("the notice recorder records, and records nothing when nothing is shown", () => {
        const quiet = makeHarness();
        expect(quiet.notices).toEqual([]);
        quiet.store.provider = "deepl";
        quiet.migrate();
        expect(quiet.notices).toHaveLength(1);
        expect(quiet.notices[0].message.length).toBeGreaterThan(50);
    });

    it("the registry snapshot restores what a test deleted", () => {
        registry.delete("google");
        expect(registry.has("google")).toBe(false);
        restoreRegistry();
        expect(registry.has("google")).toBe(true);
        expect([...registry.keys()]).toEqual(SHIPPED_REGISTRY.map(([id]) => id));
    });
});
