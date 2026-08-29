/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformSync } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkDeploymentUrl } from "../src/plugins/channelTranslator/core/providers/appsScript";

/**
 * THE SHIPPED GUIDE MAY NOT NAME A CONTROL THIS BUILD NO LONGER HAS.
 *
 * WHAT SHIPPED. site/free/index.html is static HTML that the desktop build
 * bundles verbatim as guide.html and every extension package carries beside
 * guide.js. NOTHING RECOMPILES IT. So when the provider dropdown's second entry
 * was renamed from "Google Apps Script (your own free proxy)" to "Google Free
 * API", and the settings section's heading from "Apps Script proxy" to "Setup
 * Google Key", step 6 of the guide went on telling the reader to look for both
 * old names — and every build, every test and every type-check stayed green,
 * because a rename in TypeScript cannot reach a string in an HTML file. The
 * reader is left hunting a menu entry that does not exist, at the one step where
 * they have a credential on the clipboard and nowhere to put it.
 *
 * SO BOTH SIDES ARE DERIVED, AND NEITHER IS WRITTEN OUT HERE.
 *
 *   - THE GUIDE SIDE. Each name in the guide that a user has to find on screen
 *     is marked `data-ui="<kind>"` (see the HTML comment above step 6's list).
 *     This file reads those spans out of the file itself, so a name added to the
 *     guide later is checked without anybody remembering to add it here.
 *   - THE CODE SIDE. Each kind resolves to the set of strings the code actually
 *     renders — PROVIDER_OPTIONS is read by EXECUTING settings.ts, the headings
 *     and button labels by reading the settings tab that renders them, the tab
 *     and plugin names from the two files that declare them. Rename any of them
 *     and the set changes underneath the guide.
 *
 * WHY MARKING IS NEEDED AT ALL, i.e. why this is not simply "every bold span in
 * the guide must exist in the code". Most of the guide's bold spans are Google's
 * own console — Deploy, Who has access, Anyone, Make a copy, Manage deployments.
 * Nothing in this repository renders those, so there is nothing to compare them
 * against, and a rule that demanded it would fail on ninety correct spans to
 * catch two wrong ones. The marker is the one thing a general derivation cannot
 * supply: WHICH names are ours. Everything downstream of it is derived.
 *
 * THE MARKING CANNOT BE QUIETLY DROPPED. Deleting a marker would make its span
 * invisible to this file, which is the obvious way to "fix" a failure. Three
 * things forbid it: every kind in the table below must appear in the guide at
 * least once, the count of parsed spans must equal the count of `data-ui=`
 * occurrences in the file (so a span this parser cannot read is a failure rather
 * than a silent skip), and an unknown kind is a failure rather than a pass.
 *
 * THE RETIRED-NAME SWEEP AT THE END IS HARDCODED, DELIBERATELY. "Which names
 * used to exist" is not derivable from a codebase that no longer contains them —
 * that is what retired means. Those literals are historical facts, and each is
 * checked against the live sets first, so a name that comes BACK stops being
 * treated as retired instead of failing forever.
 */

const GUIDE_PATH = join(process.cwd(), "site", "free", "index.html");
const SETTINGS_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "settings.ts");
const PLUGIN_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "index.tsx");
const TAB_PATH = join(process.cwd(), "src", "components", "settings", "tabs", "vencord", "index.tsx");
const SECTIONS_PATH = join(process.cwd(), "src", "plugins", "_core", "settings.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

/**
 * The named entities this guide uses, decoded — the same small table
 * test/panelEndpointModal.test.ts carries, and for the same reason: an entity
 * nobody decoded stays visible as `&something;` in the failure message, where
 * dropping it would make two different strings compare equal.
 */
const GUIDE_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", rarr: "→", hellip: "…", lsquo: "‘", rsquo: "’"
};

function decodeEntities(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_whole, digits: string) => String.fromCodePoint(Number(digits)))
        .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => GUIDE_ENTITIES[name] ?? whole);
}

// ───────────────────────────────────────────────────────────────────────────
// The code side: what each kind of name resolves to, read out of the source
// that renders it.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compile and evaluate the real settings.ts far enough to read PROVIDER_OPTIONS.
 *
 * EXECUTED RATHER THAN PATTERN-MATCHED, because the labels are what the dropdown
 * is handed, not what the file happens to spell: `options: PROVIDER_OPTIONS` is
 * the wiring, and reading the evaluated array is the only way to be sure the
 * thing compared against the guide is the thing the user sees. Unknown module
 * ids THROW rather than returning a permissive stub — the reason
 * test/providerMigration.test.ts gives, whose loader this mirrors: a catch-all
 * would let this keep passing after settings.ts grew an import nobody here had
 * considered.
 */
function providerLabels(): string[] {
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
        "~git-remote": { __esModule: true, default: "charlie754/Discord-Translator-Client" },
        // The real one — a settings validator calls it, and stubbing it would be
        // stubbing part of the module under inspection.
        "./core/providers/appsScript": { checkDeploymentUrl }
    };

    const require_ = (id: string) => {
        if (!(id in modules)) throw new Error(`settings.ts imported ${JSON.stringify(id)}, unstubbed here`);
        return modules[id];
    };

    const module_ = { exports: {} as { PROVIDER_OPTIONS: Array<{ label: string; }>; } };
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "IS_EXTENSION", compiled)(
        require_, module_, module_.exports, false
    );
    return module_.exports.PROVIDER_OPTIONS.map(option => option.label);
}

/** Collapse the whitespace a JSX author's line wrapping leaves in a text node. */
function jsxText(inner: string): string {
    return inner.replace(/\s+/g, " ").trim();
}

/**
 * The TSX with its comment lines taken out, before anything looks for elements.
 *
 * THIS IS LOAD-BEARING, AND IT TOOK A RED RUN TO FIND. A doc-block above the
 * settings tab's link style writes the words `<Heading>` and `</Heading>` while
 * explaining what renders where. To an element scan that is a complete, empty
 * heading OPENING at line 178, whose lazy body then runs all the way to the first
 * real `</Heading>` three hundred lines later — swallowing "Setup Google Key",
 * the one heading this file exists to check, and leaving the derived set looking
 * perfectly plausible with two entries still in it. A sentence ABOUT a tag had
 * deleted that tag from the scan.
 *
 * LINE-PREFIX STRIPPING, the same shape as codeLines() in
 * test/appsScriptRowSaveReset.test.ts, rather than a block-comment regex: a
 * non-greedy match over a file this size eats real code the moment a string
 * literal contains the opening sequence. A comment TRAILING a line of code
 * survives this, which is a known and accepted narrowing — what it could cause is
 * a guide name with nothing to match it, which fails loudly rather than passing
 * quietly.
 */
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
 * Every top-level `const NAME = "…";` in a module, by name.
 *
 * ONE LITERAL ONLY — no concatenation, no template. A constant this cannot read
 * is simply absent from the map, and the caller below then treats the heading
 * that referenced it as unreadable rather than guessing. Deliberately not
 * clever: the moment this starts evaluating expressions it stops being evidence
 * about what the file renders and starts being a second, worse compiler.
 */
function stringConstants(source: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const match of source.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\]|\\.)*)";\s*$/gm)) {
        found.set(match[1], match[2].replace(/\\"/g, "\""));
    }
    return found;
}

/**
 * Every `<Heading …>` in the settings tab, by the text it renders.
 *
 * SOURCE-READ RATHER THAN RENDERED, unlike PROVIDER_OPTIONS above: this file is
 * TSX and imports the whole Vencord alias graph, which does not resolve under
 * vitest — the reason recorded at length in test/settingsCopy.test.ts.
 *
 * A HEADING WHOSE TEXT IS `{SOME_CONSTANT}` IS RESOLVED, and that is the one
 * expression form understood here. The settings section's heading is written
 * that way on purpose: the input's `aria-label` is built from the same constant,
 * so the name a screen-reader user hears cannot drift from the name a sighted
 * user reads — which it had, and which is what put "Apps Script proxy" in one
 * and "Setup Google Key" in the other. Resolving it keeps the guide check
 * pointed at the string that is actually rendered.
 *
 * ANY OTHER EXPRESSION IS SKIPPED RATHER THAN GUESSED AT — including a
 * `{CONSTANT}` naming something this file cannot read as a plain literal. A
 * skipped heading shows up as a guide name with nothing to match it, which is a
 * loud failure; inventing a value for it would be a quiet wrong answer.
 */
function headingTexts(source: string): string[] {
    const constants = stringConstants(source);
    return [...source.matchAll(/<Heading\b[^>]*>([\s\S]*?)<\/Heading>/g)]
        .map(match => {
            const text = jsxText(match[1]);
            const reference = /^\{([A-Za-z_$][\w$]*)\}$/.exec(text);
            if (reference) return constants.get(reference[1]) ?? "";
            return text;
        })
        .filter(text => text !== "" && !text.includes("{"));
}

/**
 * Every label a `<Button>` in the settings tab can show.
 *
 * BOTH ARMS OF A CONDITIONAL COUNT. The save button renders
 * `{checking ? "Checking…" : "Save"}`, and both strings are on screen at some
 * point, so both are legitimate for the guide to name. Quoted literals are
 * therefore taken from the children whatever expression surrounds them, and a
 * plain text child is taken as itself.
 */
function buttonLabels(source: string): string[] {
    const labels: string[] = [];
    for (const match of source.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)) {
        const inner = match[1];
        const quoted = [...inner.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        if (quoted.length > 0) labels.push(...quoted);
        else if (!inner.includes("{")) labels.push(jsxText(inner));
    }
    return labels.filter(Boolean);
}

/**
 * Every entry title in Discord's own settings sidebar that this client adds.
 *
 * `panelTitle` counts alongside `title` because it is what the opened panel is
 * headed with, and a reader following "Settings → X" is matching either.
 */
function settingsTabTitles(source: string): string[] {
    return [...source.matchAll(/\b(?:panelTitle|title):\s*"([^"]+)"/g)].map(match => match[1]);
}

/** The plugin's own registered name, off definePlugin and nowhere else. */
function pluginNames(source: string): string[] {
    return [...source.matchAll(/definePlugin\(\{\s*name:\s*"([^"]+)"/g)].map(match => match[1]);
}

/**
 * The whole contract, in one place: a data-ui kind, and where its permitted
 * values come from.
 *
 * A guide span whose kind is not here fails rather than being ignored — adding a
 * marker is therefore a deliberate act that has to say where the name lives.
 */
const KINDS: Record<string, () => string[]> = {
    "provider-label": providerLabels,
    "settings-heading": () => headingTexts(codeOnly(read(TAB_PATH))),
    "settings-button": () => buttonLabels(codeOnly(read(TAB_PATH))),
    "settings-tab": () => settingsTabTitles(codeOnly(read(SECTIONS_PATH))),
    "plugin-name": () => pluginNames(codeOnly(read(PLUGIN_PATH)))
};

// ───────────────────────────────────────────────────────────────────────────
// The guide side.
// ───────────────────────────────────────────────────────────────────────────

interface MarkedName {
    kind: string;
    /** What the reader sees, entities decoded. */
    text: string;
}

/**
 * Every marked name in a piece of guide HTML.
 *
 * DELIBERATELY STRICT: exactly one attribute, and text-only content. A span this
 * cannot read is not skipped quietly — the count check below turns it into a
 * failure, because "the parser stopped seeing it" and "the name is correct" must
 * never look the same from here.
 */
/**
 * What the guide SAYS TO THE READER: comments, `<script>` and `<style>` removed,
 * entities decoded. The same direction test/appsScriptRowSaveReset.test.ts's
 * visibleTextOf() takes, and for the same reason — the retired-name sweep below
 * is about a claim made to a reader, and nobody reads an HTML comment.
 *
 * IT MATTERS HERE IMMEDIATELY. The comment above step 6's list QUOTES both
 * retired names, because that is how it explains what the markers are for. A
 * sweep over the raw file would flag the very note that records the fix.
 */
function visibleText(html: string): string {
    return decodeEntities(
        html
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    );
}

function markedNames(html: string): MarkedName[] {
    return [...html.matchAll(/<([a-z]+)\s+data-ui="([a-z-]+)"\s*>([^<]*)<\/\1>/g)]
        .map(match => ({ kind: match[2], text: decodeEntities(match[3]).trim() }));
}

/**
 * The check itself, as a function of its two inputs, so the mutation controls at
 * the bottom can run it against a doctored guide without touching the disk.
 * Returns one line per problem; empty means clean.
 */
function drift(html: string, kinds: Record<string, () => string[]>): string[] {
    const problems: string[] = [];

    const marks = markedNames(html);
    const declared = (html.match(/data-ui="/g) ?? []).length;
    if (marks.length !== declared) {
        problems.push(
            `${declared} data-ui markers in the guide but only ${marks.length} could be read — ` +
            "a marked span is in a shape this test cannot parse, so it is going unchecked"
        );
    }

    for (const { kind, text } of marks) {
        const source = kinds[kind];
        if (!source) {
            problems.push(`unknown data-ui kind ${JSON.stringify(kind)} — nothing says where that name lives`);
            continue;
        }
        const live = source();
        if (!live.includes(text)) {
            problems.push(
                `the guide tells the reader to look for ${JSON.stringify(text)}, which is not one of ` +
                `the ${kind} values this build renders: ${JSON.stringify(live)}`
            );
        }
    }

    return problems;
}

const GUIDE = read(GUIDE_PATH);

describe("the instrument, before it is trusted", () => {
    it("every file this test derives from exists and is not a stub", () => {
        for (const path of [GUIDE_PATH, SETTINGS_PATH, PLUGIN_PATH, TAB_PATH, SECTIONS_PATH]) {
            expect(existsSync(path), `not found: ${path}`).toBe(true);
            expect(read(path).length, `suspiciously small: ${path}`).toBeGreaterThan(500);
        }
    });

    it("every kind resolves to a non-empty set of live names", () => {
        // A derivation that silently returned [] would fail every guide name for
        // the wrong reason — and, worse, would pass for the wrong reason on a
        // kind the guide happens not to use yet.
        for (const [kind, source] of Object.entries(KINDS)) {
            const live = source();
            expect(live.length, `${kind} derived nothing — the extractor no longer matches the source`)
                .toBeGreaterThan(0);
            for (const name of live) expect(typeof name, `${kind} yielded a non-string`).toBe("string");
        }
    });

    it("the guide really is marked, and every kind is exercised", () => {
        // Without this, deleting the markers is a way to make this file pass on a
        // guide full of dead names.
        const marks = markedNames(GUIDE);
        expect(marks.length, "no data-ui markers in the guide at all").toBeGreaterThan(0);
        for (const kind of Object.keys(KINDS)) {
            expect(
                marks.some(mark => mark.kind === kind),
                `no ${kind} is marked in the guide — this kind is checking nothing`
            ).toBe(true);
        }
    });

    it("the parser reads every marker the file declares", () => {
        expect(markedNames(GUIDE)).toHaveLength((GUIDE.match(/data-ui="/g) ?? []).length);
    });

    it("codeOnly() is what makes the heading scan work at all (control)", () => {
        // The measured failure, kept as a control so nobody deletes the stripper
        // as a tidy-up. Without it a doc-block's prose about `<Heading>` opens a
        // match that swallows the real heading, and the derived set comes back
        // shorter but entirely plausible — green tests, wrong answer.
        const raw = readFileSync(TAB_PATH, "utf8");
        expect(
            headingTexts(raw),
            "the doc-block that used to hide the heading is gone; this control no longer " +
            "proves the stripper does anything"
        ).not.toContain("Setup Google Key");
        expect(headingTexts(codeOnly(raw))).toContain("Setup Google Key");
    });
});

describe("every control the guide names still exists in this build", () => {
    it("no marked name has drifted", () => {
        expect(drift(GUIDE, KINDS)).toEqual([]);
    });

    it("the two names step 6 gets wrong most often are the live ones", () => {
        // Named explicitly because these two are the ones that actually shipped
        // stale, and because the general check above would pass vacuously if the
        // markers were ever moved off them. Both values are still DERIVED — what
        // is written here is which control the guide has to name, not what that
        // control is called.
        const labels = providerLabels();
        const headings = headingTexts(codeOnly(read(TAB_PATH)));
        const marks = markedNames(GUIDE);

        const providerNamed = marks.filter(mark => mark.kind === "provider-label").map(mark => mark.text);
        expect(providerNamed.length, "step 6 stopped naming a provider").toBeGreaterThan(0);
        for (const name of providerNamed) expect(labels).toContain(name);

        const headingNamed = marks.filter(mark => mark.kind === "settings-heading").map(mark => mark.text);
        expect(headingNamed.length, "step 6 stopped naming the settings section").toBeGreaterThan(0);
        for (const name of headingNamed) expect(headings).toContain(name);
    });
});

/**
 * The names that were replaced, and may not come back into the guide by any
 * route — marked, unmarked, in prose or in an alt attribute.
 *
 * HARDCODED ON PURPOSE, and it is the one thing here that is. A retired name is
 * by definition absent from the code, so there is nothing to derive it from; the
 * derived half above catches a name that drifts, and this half catches the same
 * old string reappearing somewhere the markers do not reach. The control below
 * keeps it honest by asserting each of these really is retired.
 */
const RETIRED_NAMES = [
    "Google Apps Script (your own free proxy)",
    "Apps Script proxy",
    "Google Default Public Key",
    "Google (free)"
];

describe("the names that were replaced stay replaced", () => {
    it("each of them really is retired (control)", () => {
        // If one is brought back deliberately, this fails first and says so,
        // rather than the sweep below failing forever on a name that is correct
        // again.
        const live = new Set(Object.values(KINDS).flatMap(source => source()));
        for (const name of RETIRED_NAMES) {
            expect(
                live.has(name),
                `${JSON.stringify(name)} is a live control name again — take it out of RETIRED_NAMES`
            ).toBe(false);
        }
    });

    it("none of them is said to the reader anywhere in the shipped guide", () => {
        const visible = visibleText(GUIDE);
        for (const name of RETIRED_NAMES) {
            expect(
                visible,
                `the guide still sends the reader looking for ${JSON.stringify(name)}`
            ).not.toContain(name);
        }
    });

    it("the sweep can actually find one (control)", () => {
        // Proof the search above is capable of failing: the same search, over a
        // document that does contain the old name in RENDERED copy.
        const doctored = GUIDE.replace(
            "<strong data-ui=\"provider-label\">",
            "<strong>Google Apps Script (your own free proxy)</strong> <strong data-ui=\"provider-label\">"
        );
        expect(doctored, "the substitution matched nothing").not.toBe(GUIDE);
        expect(visibleText(doctored)).toContain("Google Apps Script (your own free proxy)");
    });

    it("stripping comments does not strip the prose with them (control)", () => {
        // Otherwise "none of them appears" is satisfied by a strip that deletes
        // everything, and this whole describe measures nothing.
        expect(visibleText(GUIDE).length, "the strip removed most of the document")
            .toBeGreaterThan(GUIDE.length / 2);
        expect(visibleText(GUIDE), "rendered copy was lost").toContain("Google Free API");
        expect(visibleText(GUIDE), "rendered copy was lost").toContain("Setup Google Key");
        // …and the comment really did go, which is the half that lets the note
        // above step 6 quote the old names.
        expect(GUIDE, "the note stopped recording what was renamed")
            .toContain("Google Apps Script (your own free proxy)");
    });
});

describe("M-DRIFT: the check can fail (mutation controls)", () => {
    it("a stale provider label is reported", () => {
        const doctored = GUIDE.replace(
            /<strong data-ui="provider-label">[^<]*<\/strong>/,
            "<strong data-ui=\"provider-label\">Google Apps Script (your own free proxy)</strong>"
        );
        expect(doctored, "the substitution matched nothing").not.toBe(GUIDE);
        expect(drift(doctored, KINDS).join(" | ")).toContain("Google Apps Script (your own free proxy)");
    });

    it("a stale settings heading is reported", () => {
        const doctored = GUIDE.replace(
            /<strong data-ui="settings-heading">[^<]*<\/strong>/,
            "<strong data-ui=\"settings-heading\">Apps Script proxy</strong>"
        );
        expect(doctored, "the substitution matched nothing").not.toBe(GUIDE);
        expect(drift(doctored, KINDS).join(" | ")).toContain("Apps Script proxy");
    });

    it("a rename on the CODE side is reported, with the guide untouched", () => {
        // The direction that actually happened. The guide is exactly as it ships;
        // only the derived set moves, standing in for somebody editing
        // PROVIDER_OPTIONS.
        const renamed: Record<string, () => string[]> = {
            ...KINDS,
            "provider-label": () => providerLabels().map(label => label + " v2")
        };
        expect(drift(GUIDE, renamed).join(" | ")).toContain("which is not one of the provider-label values");
    });

    it("a marker the parser cannot read is a failure, not a skip", () => {
        const doctored = GUIDE.replace(
            "<strong data-ui=\"provider-label\">",
            "<strong class=\"x\" data-ui=\"provider-label\">"
        );
        expect(doctored, "the substitution matched nothing").not.toBe(GUIDE);
        expect(drift(doctored, KINDS).join(" | ")).toContain("going unchecked");
    });

    it("an unknown kind is a failure, not a pass", () => {
        const doctored = GUIDE.replace("data-ui=\"provider-label\"", "data-ui=\"something-else\"");
        expect(doctored, "the substitution matched nothing").not.toBe(GUIDE);
        expect(drift(doctored, KINDS).join(" | ")).toContain("unknown data-ui kind");
    });

    it("the real guide is clean under the same function (contrast)", () => {
        expect(drift(GUIDE, KINDS)).toEqual([]);
    });
});
