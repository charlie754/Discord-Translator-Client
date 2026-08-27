/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two defects this file exists to keep fixed, both in
 * src/plugins/channelTranslator/settings.ts:
 *
 * 1. COPY DRIFT ACROSS SHIPPED SURFACES. The googleCloudApiKey description used
 *    to say the first 500,000 characters were "free across the project, then USD
 *    20 per million". That framing was wrong twice over — it was a monthly USD 10
 *    CREDIT, not a free tier, and Google's pricing page states no
 *    project-vs-billing-account scope for it — and it had already been removed
 *    from the 429 hint and contradicted by the setup guide. Three shipped
 *    surfaces, two stories. Prose is not covered by any type, so it gets a test.
 *
 *    THE SETTING IT WAS ABOUT IS NOW DELETED, along with both paid providers and
 *    the setup guide that documented one of them. The wording assertions went
 *    with it; the regex batteries did not, and they now sweep the whole file —
 *    see the first describe below for why a price reappearing in a plugin that
 *    cannot charge anybody is a worse defect than the one they were written for.
 *
 * 2. A CONTROL THAT DEFEATED ITS OWN DOCUMENTATION. The setup guide told the
 *    reader to pick a language from the supported list rather than type a
 *    code, because a provider answers an unknown code with a 400. targetLanguage
 *    was nevertheless OptionType.STRING — a free text box that accepted anything.
 *    It is now a SELECT over TARGET_LANGUAGES.
 *
 * The list is still duplicated in panel/Panel.tsx (`LANGUAGES`), which the lane
 * that made this change does not own. The drift test below compares the two
 * entry-by-entry so the duplication cannot silently diverge while that stays
 * true. When Panel.tsx is changed to import TARGET_LANGUAGES, its literal
 * disappears and the "panel still has its own literal" test should be deleted
 * along with it — the equality test will then be trivially satisfied by there
 * being one list.
 *
 * Everything here reads SOURCE TEXT rather than importing the modules: both
 * files resolve Vencord aliases (@api/Settings, @webpack/common) that do not
 * exist under vitest, and Panel.tsx is TSX. Static reading is the only way to
 * assert on them from this suite at all.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const SETTINGS_PATH = join(PLUGIN, "settings.ts");
const PANEL_PATH = join(PLUGIN, "panel", "Panel.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

/**
 * Rejoin adjacent string literals split across lines by `" +` … `"`, so a
 * description written as a concatenation can be searched as one sentence.
 * Without this, every assertion below would be hostage to where the author
 * happened to wrap the line.
 */
function flattenConcatenatedStrings(src: string): string {
    return src.replace(/"\s*\+\s*\r?\n\s*"/g, "");
}

/** The text of one `name: { … }` setting entry, at four-space indentation. */
function settingBlock(src: string, name: string): string {
    const start = src.indexOf(`\n    ${name}: {`);
    if (start === -1) throw new Error(`setting not found: ${name}`);
    const end = src.indexOf("\n    },", start);
    if (end === -1) throw new Error(`unterminated setting block: ${name}`);
    return src.slice(start, end);
}

interface Lang { value: string; label: string; }

/**
 * Parse the array literal that follows `anchor` into {value,label} pairs.
 * Deliberately strict: a missing anchor or an unterminated array throws rather
 * than returning [], because an empty list silently compares equal to another
 * empty list and would turn this whole file into a test that cannot fail.
 */
function parseLanguageArray(src: string, anchor: string): Lang[] {
    const start = src.indexOf(anchor);
    if (start === -1) throw new Error(`anchor not found: ${anchor}`);
    const open = src.indexOf("[", start);
    if (open === -1) throw new Error(`no array literal after anchor: ${anchor}`);
    const close = src.indexOf("\n];", open);
    if (close === -1) throw new Error(`unterminated array after anchor: ${anchor}`);
    const body = src.slice(open + 1, close);

    return [...body.matchAll(/\{([^}]*)\}/g)].map(entry => {
        const value = /value:\s*"([^"]*)"/.exec(entry[1]);
        const label = /label:\s*"([^"]*)"/.exec(entry[1]);
        if (!value || !label) throw new Error(`entry missing value/label: ${entry[0]}`);
        return { value: value[1], label: label[1] };
    });
}

/** Count entries carrying `default: true`, for the SELECT's single default. */
function defaultValues(src: string, anchor: string): string[] {
    const start = src.indexOf(anchor);
    const open = src.indexOf("[", start);
    const close = src.indexOf("\n];", open);
    const body = src.slice(open + 1, close);
    return [...body.matchAll(/\{([^}]*)\}/g)]
        .filter(entry => /default:\s*true/.test(entry[1]))
        .map(entry => /value:\s*"([^"]*)"/.exec(entry[1])![1]);
}

/** The exact framing that was removed. Any reappearance is the regression. */
const STALE_COST_FRAMING = [
    /free across the project/i,
    /characters a month are free/i,
    /USD 20 per\s+million\b/i
];

/**
 * Google's pricing page does not state whether the USD 10 credit is scoped to a
 * project or to a billing account. Asserting either is inventing a fact the
 * user may act on. These are the ways that invention has been phrased.
 */
const SCOPE_ASSERTIONS = [
    /across the project/i,
    /per project/i,
    /across your project/i,
    /per billing account/i,
    /across the billing account/i,
    /across your billing account/i
];

describe("settings.ts — files under test", () => {
    it("settings.ts exists at the path this suite reads", () => {
        expect(existsSync(SETTINGS_PATH), `not found: ${SETTINGS_PATH}`).toBe(true);
    });

    it("panel/Panel.tsx exists at the path this suite reads", () => {
        expect(existsSync(PANEL_PATH), `not found: ${PANEL_PATH}`).toBe(true);
    });

    it("preserves the upstream GPL-3.0 header", () => {
        expect(read(SETTINGS_PATH)).toContain("SPDX-License-Identifier: GPL-3.0-or-later");
    });
});

/*
 * DEFECT 1, AFTER THE PROVIDERS IT WAS ABOUT WERE DELETED.
 *
 * This describe used to assert the exact wording of googleCloudApiKey's price
 * paragraph — the monthly USD 10 credit, its Basic-and-Advanced scope, that it
 * does not roll over, and the USD 20.00 per 1,000,000 overage. That setting no
 * longer exists: both paid providers are gone and settings.ts holds no API key
 * field at all.
 *
 * The regex batteries STALE_COST_FRAMING and SCOPE_ASSERTIONS are KEPT and now
 * run over the whole file. They cost nothing, and the failure they catch is one
 * step worse than before: any reappearance of that framing means a price claim
 * has come back into a product that cannot charge anybody, which is a lie rather
 * than merely stale copy.
 *
 * What replaces the wording assertions is the claim that actually matters now —
 * settings.ts offers no way to spend money and describes none.
 */
describe("settings.ts describes a product that cannot bill anyone", () => {
    const flat = () => flattenConcatenatedStrings(read(SETTINGS_PATH));

    it("has no API-key setting of any kind left to describe", () => {
        for (const gone of ["deeplApiKey", "googleCloudApiKey", "monthlyCharacterCap", "usageBlob", "usageSummary"]) {
            expect(() => settingBlock(flat(), gone), gone).toThrow(/setting not found/);
        }
    });

    it("settingBlock() still finds a setting that IS there (positive control)", () => {
        // Without this the loop above passes for a settings.ts that failed to
        // parse, or an extractor whose anchor shape had drifted — every lookup
        // would throw and every assertion would be satisfied by the wrong reason.
        expect(settingBlock(flat(), "appsScriptUrl").length).toBeGreaterThan(200);
    });

    it("the surviving credential says there is no key and no card", () => {
        const description = settingBlock(flat(), "appsScriptUrl");
        expect(description).toContain("There is no API key and no card");
        // The whole reason Apps Script is safe to keep: past the allowance a
        // request fails instead of costing anything.
        expect(description).toContain("Apps Script has no billing");
        expect(description).toContain("script.google.com");
    });

    it("the provider list offers nothing that takes the user's money", () => {
        const description = settingBlock(flat(), "provider");
        expect(description).toContain("neither can bill you");
        expect(description).toContain("Google (free)");
        expect(description).toContain("Google Apps Script");
    });

    it("quotes no price at all — no currency figure survives anywhere in the file", () => {
        // Broader than the two batteries below on purpose. They name the exact
        // sentences that were wrong; this one refuses the whole CATEGORY, because
        // there is no longer any correct price for this plugin to quote.
        const prices = flat().match(/USD\s*[\d.,]+|\$\s?\d/g) ?? [];
        expect(prices, `settings.ts quotes a price: ${prices.join(", ")}`).toEqual([]);
    });

    it("would notice a price coming back (positive control)", () => {
        const shipped = "then USD 20.00 per 1,000,000 characters, billed to your own key.";
        expect(shipped.match(/USD\s*[\d.,]+|\$\s?\d/g)).not.toBeNull();
    });

    it("does not reintroduce the stale free-tier framing anywhere in the file", () => {
        const offenders = STALE_COST_FRAMING.filter(rx => rx.test(flat())).map(String);
        expect(offenders, `stale cost framing found in settings.ts: ${offenders.join(", ")}`)
            .toEqual([]);
    });

    it("does not assert a project-vs-billing-account scope Google does not state", () => {
        const offenders = SCOPE_ASSERTIONS.filter(rx => rx.test(flat())).map(String);
        expect(offenders, `unsupported scope claim in settings.ts: ${offenders.join(", ")}`)
            .toEqual([]);
    });

    // Positive controls: the guards above must actually fire on the text that
    // was shipped. Without these, a typo in a regex reads as a clean pass.
    it("flags the exact wording that was removed (positive control)", () => {
        const shipped =
            "Google bills you: 500,000 characters a month are free across the project, " +
            "then USD 20 per million.";
        expect(STALE_COST_FRAMING.some(rx => rx.test(shipped))).toBe(true);
        expect(SCOPE_ASSERTIONS.some(rx => rx.test(shipped))).toBe(true);
    });

    it("does not flag prose that carries neither framing (negative control)", () => {
        const corrected =
            "There is no API key and no card: a consumer Google account allows about 5,000 " +
            "translation calls a day, and going past that fails the request rather than " +
            "charging you, because Apps Script has no billing at all.";
        expect(STALE_COST_FRAMING.some(rx => rx.test(corrected))).toBe(false);
        expect(SCOPE_ASSERTIONS.some(rx => rx.test(corrected))).toBe(false);
    });
});

describe("targetLanguage is a closed list, not a text box", () => {
    const block = () => settingBlock(read(SETTINGS_PATH), "targetLanguage");

    it("is OptionType.SELECT", () => {
        expect(block()).toContain("type: OptionType.SELECT");
    });

    it("is not OptionType.STRING — the control the setup guide's advice could not reach", () => {
        expect(block()).not.toContain("type: OptionType.STRING");
    });

    it("draws its options from TARGET_LANGUAGES rather than a second inline list", () => {
        expect(block()).toContain("options: TARGET_LANGUAGES");
    });

    it("has exactly one default, and it is English", () => {
        expect(defaultValues(read(SETTINGS_PATH), "export const TARGET_LANGUAGES")).toEqual(["en"]);
    });
});

describe("TARGET_LANGUAGES does not drift from the panel's list", () => {
    const fromSettings = () =>
        parseLanguageArray(read(SETTINGS_PATH), "export const TARGET_LANGUAGES");
    const fromPanel = () => parseLanguageArray(read(PANEL_PATH), "const LANGUAGES");

    it("parses a non-empty list out of settings.ts — an empty parse is a failure", () => {
        expect(fromSettings().length).toBeGreaterThanOrEqual(15);
    });

    it("parses a non-empty list out of Panel.tsx — an empty parse is a failure", () => {
        expect(fromPanel().length).toBeGreaterThanOrEqual(15);
    });

    it("the two lists are identical, entry for entry and in the same order", () => {
        expect(fromSettings()).toEqual(fromPanel());
    });

    it("English is first, so the default is the first thing a user sees", () => {
        expect(fromSettings()[0]).toEqual({ value: "en", label: "EN - English" });
    });

    // Parser controls. A comparison between two lists both produced by a broken
    // parser passes by agreeing on nothing.
    it("the parser reads values and labels, and throws rather than returning [] (control)", () => {
        const synthetic = [
            "const LANGUAGES: Array<{ value: string; label: string; }> = [",
            '    { value: "en", label: "EN - English", default: true },',
            '    { value: "ja", label: "JP - 日本語" }',
            "];"
        ].join("\n");
        expect(parseLanguageArray(synthetic, "const LANGUAGES")).toEqual([
            { value: "en", label: "EN - English" },
            { value: "ja", label: "JP - 日本語" }
        ]);
        expect(() => parseLanguageArray(synthetic, "const NOT_THERE")).toThrow(/anchor not found/);
        expect(() => parseLanguageArray("const LANGUAGES = [", "const LANGUAGES"))
            .toThrow(/unterminated array/);
    });

    it("the drift comparison notices a changed label (control)", () => {
        const a = [{ value: "en", label: "EN - English" }];
        const b = [{ value: "en", label: "EN - Englsh" }];
        expect(a).not.toEqual(b);
    });
});
