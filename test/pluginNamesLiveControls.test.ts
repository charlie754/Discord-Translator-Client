/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformSync } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    checkDeploymentUrl,
    createAppsScriptProvider
} from "../src/plugins/channelTranslator/core/providers/appsScript";
import { registry, resolveProvider } from "../src/plugins/channelTranslator/core/providers/registry";
import type { HttpTransport } from "../src/plugins/channelTranslator/core/providers/types";

/**
 * THE PLUGIN'S OWN COPY MAY NOT NAME A CONTROL THIS BUILD NO LONGER HAS.
 *
 * test/guideNamesLiveControls.test.ts made this true of the SHIPPED GUIDE, which
 * is static HTML nothing recompiles. It was the obvious place for the defect to
 * hide and it was not the only one. When PROVIDER_OPTIONS was reworded —
 * "Google Default Public Key" → "Google (free, shared)", "Google Apps Script
 * (your own free proxy)" → "Google Free API" — and the settings section's
 * heading became "Setup Google Key", the guide was fixed and SIX strings inside
 * the plugin were not:
 *
 *   1. the settings tab's credential input, whose `aria-label` still said
 *      "Apps Script proxy" under a heading reading "Setup Google Key", so one
 *      control had two names and only blind users got the wrong one;
 *   2. the first-run notice in index.tsx — the very first sentence a new install
 *      reads — offering a choice between two entries under their old names;
 *   3. the provider dropdown's own description, immediately under the dropdown;
 *   4. the Apps Script daily-quota hint, which tells a user out of translations
 *      which entry to switch to;
 *   5. the registry's refusal when Apps Script has no URL saved, which names the
 *      same escape;
 *   6. appsScript.ts's registry `label`, which is the first half of that
 *      refusal's first sentence.
 *
 * Every one of them was TypeScript, in the same repository as the array they
 * disagreed with, and every build, type-check and test stayed green — because a
 * rename cannot reach a sentence that spelled the name a second time.
 *
 * SO BOTH SIDES ARE DERIVED HERE TOO, AND THE COPY IS READ WHERE IT IS
 * PRODUCED.
 *
 *   - THE LIVE SIDE. PROVIDER_OPTIONS is read by EXECUTING settings.ts — the
 *     labels the dropdown is HANDED, not what the file happens to spell — and
 *     the settings heading by reading the constant the tab renders. Rename
 *     either and these sets move underneath every claim below.
 *   - THE COPY SIDE. Wherever the code allows it, the sentence itself is
 *     evaluated: the refusals and hints under core/ are obtained by driving the
 *     real provider into the real failure and reading the message a user would
 *     be shown. Where a whole module cannot be executed under vitest (settings.ts
 *     renders React; the tab resolves the Vencord alias graph) the string is
 *     reconstructed from source with substitutions resolved, which is the same
 *     instrument test/stateGates.test.ts and test/appsScriptRowSaveReset.test.ts
 *     use on those two files.
 *
 * WHY A RETIRED-NAME SWEEP RATHER THAN "every name must be a live one". A
 * sentence naming a provider does not announce that it is doing so — "Pick X and
 * you must fill in its Web App URL" is a name and "the Apps Script deployment in
 * your own Google account" is a product. Deciding which spans are control names
 * would need a parser of English. What IS decidable, and is exactly the defect,
 * is that a name the controls USED to have has been left behind; and the other
 * half — that the live names are actually said — is asserted per surface, so a
 * surface cannot pass by naming nothing at all.
 *
 * THE RETIRED LIST IS HARDCODED, DELIBERATELY, for the reason
 * test/guideNamesLiveControls.test.ts gives about its own: a retired name is by
 * definition absent from the code, so there is nothing to derive it from. The
 * control below keeps it honest by requiring each one to really be retired.
 */

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "src", "plugins", "channelTranslator");
const SETTINGS_PATH = join(PLUGIN, "settings.ts");
const PLUGIN_INDEX_PATH = join(PLUGIN, "index.tsx");
const TAB_PATH = join(ROOT, "src", "components", "settings", "tabs", "vencord", "index.tsx");
/**
 * The window the rate-limited panel opens — the other place a user changes
 * provider. It renders PROVIDER_OPTIONS itself rather than listing the entries
 * again, so its dropdown cannot drift; its PROSE still can, and that is what is
 * swept here.
 */
const ENDPOINT_MODAL_PATH = join(PLUGIN, "panel", "EndpointModal.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

// ───────────────────────────────────────────────────────────────────────────
// The live side: what the controls are called in this build.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compile and evaluate the real settings.ts far enough to read its exports.
 *
 * EXECUTED RATHER THAN PATTERN-MATCHED, the same loader
 * test/guideNamesLiveControls.test.ts and test/providerMigration.test.ts use and
 * for the same reason: `options: PROVIDER_OPTIONS` is the wiring, so reading the
 * evaluated array is the only way to be sure the thing compared against the copy
 * is the thing the dropdown shows. Unknown module ids THROW rather than
 * returning a permissive stub, so an import nobody here considered fails loudly
 * instead of being silently satisfied.
 */
function loadSettings(): {
    PROVIDER_OPTIONS: Array<{ value: string; label: string; }>;
    providerName(id: string): string;
} {
    const compiled = transformSync(read(SETTINGS_PATH), {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "settings.ts"
    }).code;

    const optionType = new Proxy({}, { get: (_t, key) => String(key) });

    const modules: Record<string, unknown> = {
        "@api/Settings": { definePluginSettings: (def: Record<string, any>) => ({ store: {}, def }) },
        "@components/Button": { Button: "Button" },
        "@components/Heading": { Heading: "Heading" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/types": { OptionType: optionType },
        "@utils/web-metadata": { EXTENSION_BASE_URL: undefined },
        "@webpack/common": { React: { createElement: () => null } },
        "~git-remote": { __esModule: true, default: "charlie754/Discord-Translator-Client" },
        // The real one — a settings validator calls it, and stubbing it would be
        // stubbing part of the module under inspection.
        "./core/providers/appsScript": { checkDeploymentUrl }
    };

    const require_ = (id: string) => {
        if (!(id in modules)) throw new Error(`settings.ts imported ${JSON.stringify(id)}, unstubbed here`);
        return modules[id];
    };

    const module_ = {
        exports: {} as {
            PROVIDER_OPTIONS: Array<{ value: string; label: string; }>;
            providerName(id: string): string;
        }
    };
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "IS_EXTENSION", compiled)(
        require_, module_, module_.exports, false
    );
    return module_.exports;
}

const SETTINGS = loadSettings();

/** Every name the provider dropdown currently offers. */
const LIVE_PROVIDER_LABELS: string[] = SETTINGS.PROVIDER_OPTIONS.map(option => option.label);

/** Every provider id the dropdown currently offers. */
const LIVE_PROVIDER_IDS: string[] = SETTINGS.PROVIDER_OPTIONS.map(option => option.value);

/** Comment lines out, so a note that EXPLAINS a retired name is not shipped copy. */
function codeOnly(source: string): string {
    return source
        .split(/\r?\n/)
        .filter(line => {
            const trimmed = line.trim();
            return !(
                trimmed.startsWith("//") ||
                trimmed.startsWith("*") ||
                trimmed.startsWith("/*") ||
                trimmed.startsWith("{/*")
            );
        })
        .join("\n");
}

/**
 * The value of a top-level `const NAME = "…";`, from comment-stripped source.
 *
 * THROWS rather than returning "" when the constant is gone: an empty string
 * satisfies every `not.toContain` in this file, which is the direction that
 * fails silently.
 */
function stringConst(source: string, name: string): string {
    const match = new RegExp(`^const ${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)";$`, "m")
        .exec(codeOnly(source));
    expect(match, `const ${name} = "…"; is gone from the settings tab`).not.toBeNull();
    return match![1].replace(/\\"/g, "\"");
}

/** What the settings section is headed with, read off the constant the tab renders. */
const LIVE_SETTINGS_HEADING: string = stringConst(read(TAB_PATH), "SETTINGS_HEADING");

// ───────────────────────────────────────────────────────────────────────────
// The copy side: the sentences, as the user gets them.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every string literal and template in a fragment, joined, with
 * `${providerName("id")}` resolved against the live dropdown.
 *
 * TEMPLATES ARE MATCHED AS WHOLE UNITS, and that ordering is load-bearing: the
 * id inside a substitution is itself a quoted literal, so a quoted-literal scan
 * reads `${providerName("google")}` as the word "google" and reconstructs a
 * sentence the user never sees. Measured on the first-run notice, which came
 * back as "…you choose. googleapps-scriptScript proxy…" — no provider named, no
 * complete sentence, and plausible enough to be believed.
 *
 * AN UNRECOGNISED SUBSTITUTION IS LEFT IN PLACE ON PURPOSE, and
 * assertResolved() below turns it into a failure. Silently dropping it would
 * delete a name from the sentence and let every absence assertion pass for the
 * wrong reason.
 */
function renderedText(fragment: string): string {
    const literals = fragment.match(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g) ?? [];
    return literals
        .map(literal => {
            const body = literal.slice(1, -1);
            if (!literal.startsWith("`")) return body;
            return body.replace(
                /\$\{providerName\("([^"]+)"\)\}/g,
                (_whole, id: string) => SETTINGS.providerName(id)
            );
        })
        .join("");
}

/** A reconstructed sentence with a substitution left unresolved is not evidence. */
function assertResolved(text: string, what: string): string {
    expect(text, `${what} still carries an unresolved substitution — this scan is not reading ` +
        "what the user is shown").not.toMatch(/\$\{/);
    return text;
}

/** The slice from `startMarker` up to and including the first `endMarker` after it. */
function sliceBetween(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, `no ${JSON.stringify(endMarker)} after ${startMarker}`).toBeGreaterThan(start);
    return source.slice(start, end + endMarker.length);
}

/** The first-run consent notice, as the user reads it. */
function firstRunNotice(): string {
    const src = codeOnly(read(PLUGIN_INDEX_PATH));
    return assertResolved(
        renderedText(sliceBetween(src, "if (!settings.store.consentGiven) {", "\n        }")),
        "the first-run notice"
    );
}

/** One `name: { … }` setting entry's `description`, as the cog shows it. */
function settingDescription(name: string): string {
    const src = codeOnly(read(SETTINGS_PATH));
    const block = sliceBetween(src, `\n    ${name}: {`, "\n    },");
    const at = block.indexOf("description:");
    expect(at, `setting ${name} has no description`).toBeGreaterThan(-1);
    return assertResolved(renderedText(block.slice(at)), `the ${name} description`);
}

/** The credentials section's own paragraphs, as the cog renders them. */
function credentialsSectionText(): string {
    const src = codeOnly(read(SETTINGS_PATH));
    return assertResolved(
        renderedText(sliceBetween(src, "function CredentialsSection() {", "\n}")),
        "the credentials section"
    );
}

/** Everything the settings tab's credential row renders, accessible names included. */
function tabSectionText(): string {
    const src = read(TAB_PATH);
    const section = sliceBetween(codeOnly(src), "function TranslationApiKeySection() {", "\n}");
    // The two constants the section renders by reference rather than inline.
    const heading = stringConst(src, "SETTINGS_HEADING");
    const inputLabel = new RegExp("^const ENDPOINT_INPUT_LABEL\\s*=\\s*`([^`]*)`;$", "m")
        .exec(codeOnly(src));
    expect(inputLabel, "const ENDPOINT_INPUT_LABEL = `…`; is gone from the settings tab")
        .not.toBeNull();
    const resolvedLabel = inputLabel![1].replace(
        /\$\{([A-Za-z_$][\w$]*)\}/g,
        (_whole, name: string) => stringConst(src, name)
    );
    return assertResolved(
        [renderedText(section), heading, resolvedLabel].join("\n"),
        TAB_SURFACE
    );
}

/**
 * The one surface that renders the settings section's own name — the heading and
 * the accessible names built from it.
 *
 * A constant rather than a repeated string because it is BOTH a key of SURFACES
 * below and the scope of a retired name, and those two have to be the same
 * surface or the retired heading is scoped to a surface that does not exist. An
 * instrument test checks exactly that, but making it one value is cheaper than
 * catching it.
 */
const TAB_SURFACE = "the settings tab's credential row";

/**
 * A transport that never answers 200 with a translation, for the refusal paths.
 * Nothing here reaches the network: every response below is a recorded shape.
 */
const NEVER_CALLED: HttpTransport = async () => {
    throw new Error("the refusal paths must not send a request");
};

/** The exact reply Apps Script gives when the day's 5,000 calls are spent. */
const QUOTA_BODY = JSON.stringify({
    error: "Exception: Service invoked too many times for one day: translate."
});

/**
 * Every refusal a registry entry produces when it is selected with no
 * credential — the sentence state.ts puts in a banner and the settings tab shows
 * under the Save button.
 *
 * DRIVEN, NOT READ. This is the one surface where the copy can be obtained by
 * running the code that emits it, so it is: `provider.label` reaches the user
 * through here and through nothing else, which is the whole reason
 * appsScript.ts's label had to be aligned with the dropdown and google.ts's did
 * not. Asking resolveProvider() rather than reasoning about `needsKey` means the
 * day a keyless provider starts requiring a credential, its label is checked
 * without anybody remembering to come back here.
 */
function registryRefusals(): Array<{ id: string; reason: string; }> {
    const refusals: Array<{ id: string; reason: string; }> = [];
    for (const id of registry.keys()) {
        const resolution = resolveProvider(id, NEVER_CALLED, {});
        if (!resolution.ok) refusals.push({ id, reason: resolution.reason });
    }
    return refusals;
}

/** The daily-quota message, obtained by driving the provider into the quota refusal. */
async function quotaMessage(): Promise<string> {
    const provider = createAppsScriptProvider(
        async () => ({ status: 200, body: QUOTA_BODY }),
        { apiKey: "https://script.google.com/macros/s/AKfycbxTESTdeploymentIDnotreal123456/exec" }
    );
    const error = await provider.translate(["Hello"], "auto", "es").catch(e => e);
    expect(error, "the quota path stopped throwing — this scan has nothing to read")
        .toBeInstanceOf(Error);
    return (error as Error).message;
}

/**
 * Every surface that is allowed to name a provider or the settings section, and
 * the copy it puts in front of the user.
 *
 * A surface added to this table is checked by every claim below without anything
 * else being edited; a surface MISSING from it is checked by nothing, which is
 * why the instrument tests insist the table is non-empty and that each entry
 * actually produces text.
 */
const SURFACES: Record<string, () => string | Promise<string>> = {
    "the first-run notice (index.tsx)": firstRunNotice,
    "the provider dropdown's description (settings.ts)": () => settingDescription("provider"),
    "the credential field's description (settings.ts)": () => settingDescription("appsScriptUrl"),
    "the DM opt-in's description (settings.ts)": () => settingDescription("includeDMs"),
    "the credentials section (settings.ts)": credentialsSectionText,
    "the rate-limit escape window (panel/EndpointModal.tsx)": () =>
        assertResolved(renderedText(codeOnly(read(ENDPOINT_MODAL_PATH))), "the escape window"),
    [TAB_SURFACE]: tabSectionText,
    "the registry's refusals (core/providers)": () =>
        registryRefusals().map(refusal => refusal.reason).join("\n"),
    "the Apps Script daily-quota hint (core/providers)": quotaMessage
};

/**
 * The names the controls USED to have. Any of them still being said to a user is
 * an instruction to look for something that is not there.
 *
 * HARDCODED, and it is the only thing here that is — see the file header. The
 * control below requires each to really be retired, so a name brought back
 * deliberately fails once, loudly, instead of failing forever.
 *
 * 🔴 EACH ONE CARRIES A SCOPE, AND THE REASON IS A FALSE POSITIVE THIS FILE
 * PRODUCED ON ITS FIRST RUN. Three retired PROVIDER LABELS are long, punctuated
 * strings — "Google Apps Script (your own free proxy)", "Google Default Public
 * Key", "Google (free)" — which cannot occur in English by accident, so a
 * substring sweep over any surface is sound for them.
 *
 * The retired SECTION HEADING is not like that. "Apps Script proxy" is also the
 * ordinary way to describe the technology, and the shipped copy legitimately
 * says a provider "is a Google Apps Script proxy you deploy once into your own
 * Google account" — a true sentence about what the thing IS, which no reader
 * will mistake for a menu entry to go and find. A global substring sweep fired
 * on three such sentences.
 *
 * THE TWO WAYS OUT OF THAT WERE NOT EQUAL. Rewording correct product copy so a
 * matcher stops complaining is the fix this codebase refuses on principle — the
 * same argument test/stateGates.test.ts records for its own rejoin — and
 * teaching the matcher which English phrases are descriptions would be a parser
 * of prose, i.e. the shape that never converges. So the heading is checked where
 * a heading is actually NAMED: the settings tab, which renders it and the
 * accessible names built from it, and which is exactly where the defect was.
 *
 * WHAT THAT COSTS, STATED PLAINLY: prose on another surface could say "open the
 * Apps Script proxy section" and this file would not catch it. That gap is real
 * and is not covered here. It is covered for the one document most likely to
 * give such an instruction — the shipped setup guide — by
 * test/guideNamesLiveControls.test.ts, whose global sweep over rendered guide
 * text includes this exact name.
 */
interface RetiredName {
    name: string;
    /**
     * "anywhere" for a retired provider label. TAB_SURFACE for the section
     * heading, which is only a control name where a section is headed.
     */
    scope: "anywhere" | typeof TAB_SURFACE;
}

const RETIRED_NAMES: RetiredName[] = [
    { name: "Google Default Public Key", scope: "anywhere" },
    { name: "Google Apps Script (your own free proxy)", scope: "anywhere" },
    { name: "Google (free)", scope: "anywhere" },
    { name: "Apps Script proxy", scope: TAB_SURFACE }
];

/** The retired names that are a defect on `surface`. */
function retiredFor(surface: string): string[] {
    return RETIRED_NAMES
        .filter(retired => retired.scope === "anywhere" || retired.scope === surface)
        .map(retired => retired.name);
}

/**
 * The one place a retired name is still allowed, and why.
 *
 * The provider dropdown's description says the first entry is "listed as Google
 * (free) in earlier builds". That is a historical fact stated AS a historical
 * fact, for a reader who arrived from an older screenshot, the setup guide or a
 * refusal message and has to work out which entry is which. It is the opposite
 * of the defect: the defect is a retired name presented as a live one.
 *
 * IT IS SCOPED TO ONE SURFACE AND ONE NAME, and the control below proves the
 * exemption is load-bearing rather than a blanket. Anything else naming a
 * retired control still fails.
 */
const HISTORICAL_MENTIONS: Record<string, ReadonlyArray<string>> = {
    "the provider dropdown's description (settings.ts)": ["listed as Google (free) in earlier builds"]
};

function withoutHistory(surface: string, text: string): string {
    let stripped = text;
    for (const phrase of HISTORICAL_MENTIONS[surface] ?? []) {
        expect(
            stripped,
            `${surface} no longer contains the historical mention ${JSON.stringify(phrase)} — ` +
            "take it out of HISTORICAL_MENTIONS rather than leaving an exemption for nothing"
        ).toContain(phrase);
        stripped = stripped.split(phrase).join(" ");
    }
    return stripped;
}

describe("the instrument, before it is trusted", () => {
    it("every file this test derives from exists and is not a stub", () => {
        for (const path of [SETTINGS_PATH, PLUGIN_INDEX_PATH, TAB_PATH, ENDPOINT_MODAL_PATH]) {
            expect(existsSync(path), `not found: ${path}`).toBe(true);
            expect(read(path).length, `suspiciously small: ${path}`).toBeGreaterThan(500);
        }
    });

    it("the live sets are non-empty and are strings", () => {
        // A derivation that silently returned [] would make every sweep below
        // pass on copy naming nothing that exists.
        expect(LIVE_PROVIDER_LABELS.length, "PROVIDER_OPTIONS derived nothing").toBeGreaterThan(0);
        for (const label of LIVE_PROVIDER_LABELS) expect(typeof label).toBe("string");
        expect(LIVE_SETTINGS_HEADING.length, "the settings heading derived nothing")
            .toBeGreaterThan(0);
    });

    it("the labels are the array's, not a copy typed into this file", () => {
        // loadSettings() executing the module is the claim; this is the check.
        // A loader that returned {} would give an empty set, which the test above
        // catches, but one that returned a stale stub would not — so the ids are
        // compared against the registry, which is imported for real.
        for (const id of LIVE_PROVIDER_IDS) {
            expect(registry.has(id), `the dropdown offers "${id}", which the registry cannot serve`)
                .toBe(true);
        }
        expect(SETTINGS.providerName(LIVE_PROVIDER_IDS[0])).toBe(LIVE_PROVIDER_LABELS[0]);
    });

    it("every surface produces copy — a silent empty one would pass every sweep", async () => {
        expect(Object.keys(SURFACES).length, "no surfaces are checked at all").toBeGreaterThan(0);
        for (const [name, produce] of Object.entries(SURFACES)) {
            const text = await produce();
            expect(typeof text, `${name} did not produce a string`).toBe("string");
            expect(text.length, `${name} produced no copy — it is being checked vacuously`)
                .toBeGreaterThan(40);
        }
    });

    it("renderedText resolves a substitution and reads a template as one unit (controls)", () => {
        const google = SETTINGS.providerName("google");
        const sample = '"pick " +\n`${providerName("google")} for nothing`';
        expect(renderedText(sample)).toBe(`pick ${google} for nothing`);
        // The failure mode this shape exists to prevent: the id inside the
        // substitution must not surface as prose.
        expect(renderedText(sample)).not.toContain("google\"");
        expect(sample, "the control agrees with a literal, so it proves no resolution")
            .not.toContain(google);
        // A plain concatenation still rejoins, so nothing that straddles a line
        // break goes missing.
        expect(renderedText('"Direct messages are " +\n"excluded unless you opt in."'))
            .toContain("Direct messages are excluded unless you opt in.");
    });

    it("an unresolved substitution is a failure, not a silent gap (control)", () => {
        expect(() => assertResolved("switch to ${someOtherHelper(x)}", "a sample"))
            .toThrow();
    });

    it("stringConst throws rather than returning nothing (control)", () => {
        expect(() => stringConst(read(TAB_PATH), "NO_SUCH_CONSTANT_HERE")).toThrow();
        expect(stringConst(read(TAB_PATH), "SETTINGS_HEADING")).toBe(LIVE_SETTINGS_HEADING);
    });

    it("the refusal driver actually produces refusals (control)", () => {
        const refusals = registryRefusals();
        expect(refusals.length, "no registry entry refuses a missing credential any more — " +
            "either every provider is keyless, or resolveProvider stopped refusing")
            .toBeGreaterThan(0);
        for (const { reason } of refusals) expect(reason.length).toBeGreaterThan(40);
    });

    it("the quota driver reaches the quota message and not some other failure", async () => {
        const message = await quotaMessage();
        expect(message).toContain("apps-script:");
        expect(message, "this is no longer the daily-quota path").toContain("5,000");
    });
});

describe("every retired control name really is retired (control)", () => {
    it("none of them is a live provider label or the live settings heading", () => {
        // If one is brought back deliberately this fails first and says so,
        // rather than the sweeps below failing forever on a name that is correct
        // again.
        const live = new Set([...LIVE_PROVIDER_LABELS, LIVE_SETTINGS_HEADING]);
        for (const { name } of RETIRED_NAMES) {
            expect(
                live.has(name),
                `${JSON.stringify(name)} is a live control name again — take it out of RETIRED_NAMES`
            ).toBe(false);
        }
    });

    it("the list is not empty and the sweep can find one (control)", () => {
        expect(RETIRED_NAMES.length).toBeGreaterThan(0);
        // Proof the search below is capable of failing: the same search, over
        // copy that does contain a retired name.
        const doctored = "Switch Provider back to Google (free) if you need translation.";
        expect(retiredFor("any surface").filter(name => doctored.includes(name)))
            .toEqual(["Google (free)"]);
    });

    it("every scope names a surface that exists, so nothing is scoped into nowhere", () => {
        // A typo in a scope would silently switch that name's check off
        // everywhere, which is indistinguishable from the copy being clean.
        for (const { name, scope } of RETIRED_NAMES) {
            if (scope === "anywhere") continue;
            expect(
                Object.keys(SURFACES),
                `${JSON.stringify(name)} is scoped to ${JSON.stringify(scope)}, which is not a surface`
            ).toContain(scope);
        }
    });

    it("the scoped name IS checked on its own surface (control)", () => {
        // The scoping is a narrowing, not an exemption. Without this, moving a
        // name to a surface scope would be a way to stop checking it at all.
        const scoped = RETIRED_NAMES.filter(retired => retired.scope !== "anywhere");
        expect(scoped.length, "the scope mechanism is unused — delete it or use it")
            .toBeGreaterThan(0);
        for (const { name, scope } of scoped) {
            expect(retiredFor(scope)).toContain(name);
            const doctored = `${tabSectionText()} ${name}`;
            expect(
                retiredFor(scope).filter(candidate => doctored.includes(candidate)),
                `the sweep cannot find ${JSON.stringify(name)} even on ${scope}`
            ).toContain(name);
        }
    });
});

describe("no user-facing string names a control this build does not have", () => {
    it.each(Object.keys(SURFACES))("%s", async surface => {
        const text = withoutHistory(surface, await SURFACES[surface]());
        const names = retiredFor(surface);
        expect(names.length, `${surface} is checked against no retired names at all`)
            .toBeGreaterThan(0);
        for (const name of names) {
            expect(
                text,
                `${surface} still sends the reader looking for ${JSON.stringify(name)} — the ` +
                `controls are now ${JSON.stringify([...LIVE_PROVIDER_LABELS, LIVE_SETTINGS_HEADING])}`
            ).not.toContain(name);
        }
    });

    it("the historical exemption is scoped, not a blanket (control)", () => {
        // Without this, adding a surface to HISTORICAL_MENTIONS would be a way to
        // switch the sweep off for that surface entirely.
        const surface = "the provider dropdown's description (settings.ts)";
        const text = withoutHistory(surface, settingDescription("provider"));

        // It removed the one sentence and left the description behind.
        expect(text, "the exemption removed more than the historical sentence it names")
            .toContain(SETTINGS.providerName("google"));
        expect(text.length).toBeGreaterThan(200);

        // And a retired name anywhere ELSE in the same surface is still caught.
        const doctored = `${text} Switch Provider back to Google (free).`;
        expect(retiredFor(surface).filter(name => doctored.includes(name)))
            .toContain("Google (free)");
    });

    it("a surface with no exemption has nothing stripped from it (control)", () => {
        const surface = "the first-run notice (index.tsx)";
        expect(HISTORICAL_MENTIONS[surface]).toBeUndefined();
        const notice = firstRunNotice();
        expect(withoutHistory(surface, notice)).toBe(notice);
    });
});

describe("the live names are actually said, so a surface cannot pass by naming nothing", () => {
    it("the first-run notice names both dropdown entries", () => {
        const notice = firstRunNotice();
        for (const label of LIVE_PROVIDER_LABELS) {
            expect(notice, "the first sentence a new install reads no longer names this choice")
                .toContain(label);
        }
    });

    it("the provider dropdown's description names both entries it describes", () => {
        const description = settingDescription("provider");
        for (const label of LIVE_PROVIDER_LABELS) expect(description).toContain(label);
    });

    it("the credentials section names the entry whose credential it is about", () => {
        expect(credentialsSectionText()).toContain(SETTINGS.providerName("apps-script"));
    });

    it("the registry's refusal names the entry that is refusing AND the one that works", () => {
        const refusals = registryRefusals();
        const appsScript = refusals.find(refusal => refusal.id === "apps-script");
        expect(appsScript, "apps-script no longer refuses a missing URL").toBeDefined();
        // The first half is provider.label, which is why that field is not an
        // engineering name; the second is the way out.
        expect(appsScript!.reason).toContain(SETTINGS.providerName("apps-script"));
        expect(appsScript!.reason).toContain(SETTINGS.providerName("google"));
    });

    it("the daily-quota hint names the entry it tells the user to switch to", async () => {
        expect(await quotaMessage()).toContain(SETTINGS.providerName("google"));
    });

    it("the settings tab's row is headed and labelled with the live heading", () => {
        const text = tabSectionText();
        expect(text).toContain(LIVE_SETTINGS_HEADING);
    });
});

/**
 * 🔴 THE ACCESSIBLE NAME AND THE VISIBLE HEADING ARE ONE NAME.
 *
 * The defect this file is named for, in its worst form: the heading was renamed
 * and the input's `aria-label` was not, so a sighted user read "Setup Google
 * Key" and a screen-reader user was told the box belonged to the "Apps Script
 * proxy" — a section this build does not have. Two people looking at the same
 * screen could not agree on what was on it, and only one of them could see that
 * the name they had been given was wrong.
 */
describe("one control, one name", () => {
    it("the credential input's accessible name contains the visible heading", () => {
        const src = read(TAB_PATH);
        const label = new RegExp("^const ENDPOINT_INPUT_LABEL\\s*=\\s*`([^`]*)`;$", "m")
            .exec(codeOnly(src));
        expect(label, "the input's accessible name is no longer a template over the heading")
            .not.toBeNull();
        const resolved = label![1].replace(
            /\$\{([A-Za-z_$][\w$]*)\}/g,
            (_whole, name: string) => stringConst(src, name)
        );
        expect(resolved).toContain(LIVE_SETTINGS_HEADING);
        expect(resolved, "the accessible name stopped saying which values the box takes")
            .toContain("Deployment ID");
    });

    it("the input renders that constant rather than a second literal", () => {
        const section = sliceBetween(
            codeOnly(read(TAB_PATH)),
            "function TranslationApiKeySection() {",
            "\n}"
        );
        expect(section).toContain("aria-label={ENDPOINT_INPUT_LABEL}");
        expect(
            section,
            "the input has a hand-written accessible name again — that is the drift this " +
            "whole file exists to catch"
        ).not.toMatch(/aria-label="[^"]*"[\s\S]{0,200}maxLength/);
    });

    it("the heading renders the same constant (control)", () => {
        // Otherwise the accessible name could agree with a constant nothing
        // displays, and the two names would be free to diverge again.
        const section = sliceBetween(
            codeOnly(read(TAB_PATH)),
            "function TranslationApiKeySection() {",
            "\n}"
        );
        expect(section).toContain("{SETTINGS_HEADING}");
    });
});
