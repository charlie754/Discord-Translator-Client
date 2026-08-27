/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE ROW ON THE CLIENT SETTINGS TAB, AFTER IT WAS REPOINTED AT THE FREE PATH.
 *
 * The row used to edit `googleCloudApiKey` — the PAID Google Cloud Translation
 * v2 key — while the "setup guide" link beside it opened the APPS SCRIPT
 * tutorial (site/free/index.html, shipped as guide.html). Two controls, one
 * screen, two different products. Operator ruling: "the row shall for 'Apps
 * Script proxy', even our setup guide is dedicated for this key."
 *
 * So this file pins the four things that change together and cannot be allowed
 * to drift apart again:
 *
 *   1. WHAT IT EDITS  — `appsScriptUrl`, never `googleCloudApiKey`.
 *   2. WHERE THE LINK IS — "→ Setup Guide", on the heading's own row, and NOT
 *      buried in the paragraph where it used to live.
 *   3. WHAT SAVE DOES — validateAppsScriptUrl(), then BOTH ids on success and
 *      NEITHER on failure. A failed check that writes anything destroys the only
 *      promise Reset makes.
 *   4. WHAT THE COPY CLAIMS — that this path costs money is a FACTUAL ERROR.
 *      Apps Script has no billing at all. This used to be checked against
 *      core/usage.ts's BILLED set, which was { "google-cloud", "deepl" } and did
 *      not contain "apps-script". Both of those providers have since been
 *      deleted and core/usage.ts with them, so the same question is now asked of
 *      core/providers/registry.ts: the copy is true because the registry holds
 *      nothing that can bill anybody. Read out of the code either way, never
 *      restated here.
 *
 *      The other half of (4) INVERTED when they went. The row used to carry a
 *      paragraph reassuring the reader that the Google Cloud and DeepL keys were
 *      "still editable in the translator plugin's own settings", and this file
 *      pinned it. Those settings no longer exist, so the sentence is now a
 *      shipped lie and the assertion is inverted — see the describe at the end
 *      of "the copy does not claim this path costs money".
 *
 * A SOURCE SCAN, and the same instrument test/panelSettingsOverlap.test.ts and
 * test/vencordTabApiKeyRow.test.ts use, for the same reason: the tab is TSX and
 * resolves Vencord build aliases (@api/Settings, @webpack/common, @plugins/*)
 * that do not exist under vitest, so it cannot be imported here at all.
 *
 * EVERY MATCHER BELOW IS CONTROLLED. A source scan that silently stops matching
 * passes vacuously and is worse than no test, so each extractor is run against
 * text it must find AND text it must not.
 */

const ROOT = process.cwd();
const TAB = join(ROOT, "src", "components", "settings", "tabs", "vencord", "index.tsx");
const TAB_CSS = join(ROOT, "src", "components", "settings", "tabs", "vencord", "VencordTab.css");
const PLUGIN_SETTINGS = join(ROOT, "src", "plugins", "channelTranslator", "settings.ts");
const PLUGIN_STATE = join(ROOT, "src", "plugins", "channelTranslator", "state.ts");
/**
 * The provider registry. This used to be core/usage.ts, whose BILLED set was
 * what "apps-script is not billed" was read out of. That module is deleted along
 * with every provider that could bill anyone, so the question it answered is now
 * answered one level up: what CAN this plugin talk to at all.
 */
const REGISTRY = join(ROOT, "src", "plugins", "channelTranslator", "core", "providers", "registry.ts");
const DELETED_USAGE = join(ROOT, "src", "plugins", "channelTranslator", "core", "usage.ts");
/**
 * The provider module that decides what this credential may look like.
 *
 * Read for the same reason REGISTRY is read: the row's copy now PROMISES that a
 * bare Deployment ID is accepted, and a promise about behaviour has to be checked
 * against the code that behaves, not against a second copy of the belief written
 * out here.
 */
const APPS_SCRIPT = join(ROOT, "src", "plugins", "channelTranslator", "core", "providers", "appsScript.ts");
const HEADING_CSS = join(ROOT, "src", "components", "Heading.css");
const BASE_TEXT = join(ROOT, "src", "components", "BaseText.tsx");

/** The label the operator specified, character for character. U+2192, space, two words. */
const EXPECTED_LINK_TEXT = "→ Setup Guide";

function read(path: string): string {
    return readFileSync(path, "utf8");
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/**
 * Only the executable and user-visible lines.
 *
 * This section is heavily commented and its comments necessarily discuss the
 * paid providers, billing and the old Google Cloud row. A matcher that cannot
 * tell an explanation from a rendered sentence would forbid the file from
 * explaining itself — which is the same defect panelSettingsOverlap.test.ts
 * documents for its own subject.
 */
function codeLines(source: string): string[] {
    return source.split("\n").filter(line => !isCommentLine(line));
}

function codeOf(source: string): string {
    return codeLines(source).join("\n");
}

/** The slice from `startMarker` up to and including the first `endMarker` after it. */
function sliceBetween(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, `no ${JSON.stringify(endMarker)} after ${startMarker}`).toBeGreaterThan(start);
    return source.slice(start, end + endMarker.length);
}

/**
 * The WHOLE `<Button …> … </Button>` element containing `marker`, opening tag
 * included.
 *
 * 🔴 WHY THIS EXISTS. The assertion "Save is not the secondary button" was
 * written as sliceBetween(src, "onClick={onSave}", "</Button>"), which starts the
 * slice AT the onClick prop — so every prop written ABOVE it is outside the scan.
 * JSX props have no required order and this codebase writes `variant` before
 * `onClick` (the Reset button does exactly that), so the one attribute the
 * assertion was looking for was in the one place it could not look. It could not
 * fail, whatever the Save button carried.
 *
 * Scanning back to the opening `<Button` fixes it in the direction that keeps
 * working when the props are reordered again.
 */
function buttonContaining(sectionSrc: string, marker: string): string {
    const at = sectionSrc.indexOf(marker);
    expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
    const open = sectionSrc.lastIndexOf("<Button", at);
    expect(open, `no opening <Button before ${marker}`).toBeGreaterThan(-1);
    const close = sectionSrc.indexOf("</Button>", at);
    expect(close, `no closing </Button> after ${marker}`).toBeGreaterThan(at);
    return sectionSrc.slice(open, close + "</Button>".length);
}

/** The whole `function TranslationApiKeySection() { ... }`, comments included. */
function section(src: string): string {
    return sliceBetween(src, "function TranslationApiKeySection() {", "\n}");
}

/** The one-line flex container the heading and the guide link share. */
function headingRow(sectionSrc: string): string {
    return sliceBetween(sectionSrc, "<div style={HEADING_ROW_STYLE}>", "</div>");
}

/** Every `<Paragraph …>…</Paragraph>` block in the section. */
function paragraphs(sectionSrc: string): string[] {
    const found: string[] = [];
    let from = 0;
    for (;;) {
        const start = sectionSrc.indexOf("<Paragraph", from);
        if (start === -1) return found;
        const end = sectionSrc.indexOf("</Paragraph>", start);
        if (end === -1) return found;
        found.push(sectionSrc.slice(start, end + "</Paragraph>".length));
        from = end + 1;
    }
}

/** The body of `async function onSave()`. Its own closing brace is the only one at 4 spaces. */
function onSaveBody(sectionSrc: string): string {
    return sliceBetween(sectionSrc, "async function onSave() {", "\n    }");
}

/** The `if (!result.ok) { … }` block — everything the FAILURE path runs. */
function failurePath(saveBody: string): string {
    return sliceBetween(saveBody, "if (!result.ok) {", "\n            }");
}

/** Everything after that block — the SUCCESS path. */
function successPath(saveBody: string): string {
    const guard = failurePath(saveBody);
    return saveBody.slice(saveBody.indexOf(guard) + guard.length);
}

/**
 * The `placeholder="…"` string the input actually renders.
 *
 * A LITERAL ONLY, on purpose. If the placeholder ever becomes an expression this
 * throws rather than returning the empty string a lenient regex would hand back —
 * an extractor that silently returns "" makes every assertion about the
 * placeholder's CONTENT pass vacuously, which is the failure mode this whole file
 * exists to refuse. Run it over comment-stripped source so a comment discussing
 * the placeholder cannot be mistaken for the placeholder.
 */
function placeholderOf(sectionCode: string): string {
    const at = sectionCode.indexOf("placeholder=");
    expect(at, "the input has no placeholder at all").toBeGreaterThan(-1);
    const literal = /placeholder="((?:[^"\\]|\\.)*)"/.exec(sectionCode.slice(at));
    expect(literal, "the placeholder is no longer a plain string literal").not.toBeNull();
    return literal![1].replace(/\\"/g, "\"");
}

/**
 * The plugin cog's `appsScriptUrl` description, flattened.
 *
 * The description is written as `"…" + "…"` across a dozen lines to stay inside
 * the codebase's line length, so a raw `toContain` on the FILE cannot see any
 * sentence that happens to straddle a break — it would report a perfectly good
 * sentence as missing, or worse, pass because the fragment it happened to pick
 * fits on one line. Slice the block, join its literals, then match.
 */
function cogDescription(pluginSrc: string): string {
    return stringLiterals(sliceBetween(pluginSrc, "    appsScriptUrl: {", "        default: \"\",")).join("");
}

/** The body of `function onReset()`. */
function onResetBody(sectionSrc: string): string {
    return sliceBetween(sectionSrc, "function onReset() {", "\n    }");
}

/** Every `"…"` literal in a fragment of source, in order, unescaped only for `\"`. */
function stringLiterals(fragment: string): string[] {
    return [...fragment.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, "\""));
}

/**
 * The value of a top-level `const NAME = …;` string constant.
 *
 * Concatenation-aware on purpose: this file's constants are written as
 * `"…" + "…"` across lines to stay inside the line length the rest of the
 * codebase uses, and a matcher that only understood a single literal would
 * report a perfectly good constant as missing. (It did, on the first run.)
 */
function stringConst(src: string, name: string): string {
    const start = src.indexOf(`const ${name} =`);
    expect(start, `const ${name} = … was removed or renamed`).toBeGreaterThan(-1);
    const end = src.indexOf(";", start);
    expect(end, `const ${name} has no terminating semicolon`).toBeGreaterThan(start);
    return stringLiterals(src.slice(start, end)).join("");
}

/**
 * Every `message:` expression in the section, continuation lines included.
 *
 * This is how "the deployment URL is never put on screen" is actually measured.
 * Grepping for the word `verified` cannot do it — the success copy contains the
 * word — so what is checked instead is that a message expression is built from
 * STRING LITERALS ONLY, with the single exception of `result.reason`, which is
 * the provider's own prose and is documented in state.ts as never containing the
 * URL. A `${draft}`, a `+ candidate` or a bare identifier leaves a residue.
 *
 * 🔴 THE ANCHOR USED TO BE `/^\s*message:/`, AND THAT MADE THIS SCAN BLIND TO
 * EXACTLY THE CASE THE DOC-BLOCK ABOVE SINGLES OUT.
 *
 * Requiring `message:` to be the first non-space token on its line means an
 * expression written inline — `setStatus({ kind: "error", message: result.reason });`
 * — was never collected. That is the ONE message in the whole section carrying a
 * non-literal, so the test claiming "the candidate URL is never rendered, logged
 * or copied into the status line" was measuring three of the four messages and
 * silently skipping the interesting one. It could not have failed: the three it
 * did see are literal-only by construction, so the loop passed on an empty
 * residue every time no matter what the inline expression said.
 *
 * The anchor is now the PROPERTY POSITION rather than the line start: after `{`,
 * after `,`, or at the beginning of a line. That reaches the inline form without
 * matching `message:` inside a string or a type alias (`{ kind: …; message:
 * string; }` lives at module scope, outside section(), and would in any case
 * leave the residue "string" rather than passing).
 */
function messageExpressions(sectionSrc: string): string[] {
    const lines = sectionSrc.split("\n");
    const found: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        // A property position: line start, or immediately after `{` or `,`.
        const at = /(?:^|[{,])\s*message:/.exec(lines[i]);
        if (!at) continue;
        // Slice from the `message:` token itself, so an inline expression is not
        // dragged in with the `setStatus({ kind: "error",` that precedes it —
        // which carries a string literal of its own and would mask a residue.
        const head = lines[i].slice(at.index + at[0].length - "message:".length);
        const chunk = [head];
        for (let j = i + 1; j < lines.length && /^\s*"/.test(lines[j]); j++) chunk.push(lines[j]);
        found.push(chunk.join("\n"));
    }
    return found;
}

/** What is left of a message expression once its string literals are removed. */
function messageResidue(expr: string): string {
    return expr
        .replace(/^\s*message:/, "")
        .replace(/"(?:[^"\\]|\\.)*"/g, "")
        .replace(/[\s+,;)}]/g, "");
}

/**
 * Wordings that would assert this path costs the user money.
 *
 * NEGATIONS ARE NOT DEFECTS, and that is the whole difficulty. "there is no
 * billing at all" and "rather than charging you" are the TRUE sentences and must
 * survive; "Google bills you" is the false one and must not. So each pattern
 * targets an AFFIRMATIVE claim, and the controls below run the whole set over
 * both the real copy (must abstain) and the old paid-key copy (must fire).
 */
const MONEY_CLAIMS: Array<{ label: string; pattern: RegExp; }> = [
    { label: "somebody bills you", pattern: /\bbills?\s+you\b/i },
    { label: "you are billed", pattern: /\b(?:is|are)\s+billed\b|\bbilled\s+to\s+you\b/i },
    { label: "it costs money", pattern: /\bcosts?\b[^.]{0,40}\b(?:money|dollars?|USD)\b/i },
    { label: "a currency amount", pattern: /(?:USD|\$)\s?\d/ },
    { label: "per-character pricing", pattern: /per\s+1[,.]?000[,.]?000\b/i },
    { label: "a card is required", pattern: /\b(?:credit|debit)\s+card\b/i },
    { label: "a payment method or billing account", pattern: /\bpayment\s+method\b|\bbilling\s+account\b/i },
    { label: "plan framing", pattern: /\bpaid\s+plan\b|\bfree\s+trial\b/i },
    { label: "a charge will be made", pattern: /\bwill\s+be\s+charged\b|\bcharges\s+you\b|\bwe\s+charge\b/i }
];

function moneyClaimsIn(text: string): string[] {
    return MONEY_CLAIMS.filter(c => c.pattern.test(text)).map(c => c.label);
}

/**
 * An input whose TYPE is "password", in any shape this file could write it.
 *
 * THIS IS THE REGRESSION THAT MATTERS. The row shipped
 * `type={revealed ? "text" : "password"}`. The password input type is how you tell
 * a browser "this is a login password field", Chromium's own password manager is
 * documented as ignoring `autocomplete="off"`, and Discord desktop is Chromium on
 * the discord.com origin. The operator opened this tab on a fresh install — where
 * `appsScriptUrl` has `default: ""` and the box is empty by construction — and
 * found about eight masked characters in it with "Unsaved changes" showing. An
 * Apps Script deployment URL is roughly a hundred characters, so those eight were
 * not ours. An unrelated real credential in this component's state, one click from
 * onSave().
 *
 * The static form `type="password"` and the conditional form are both matched,
 * either way round, because the ternary is what was actually there and a
 * well-meaning "fix" could easily reintroduce it flipped.
 *
 * NO `g` FLAG: `RegExp.prototype.test` is stateful with one, and this pattern is
 * reused across several assertions.
 */
const PASSWORD_TYPE = /type\s*=\s*(?:["']password["']|\{[^}]*["']password["'][^}]*\})/;

/**
 * A mask, or a control for revealing what a mask hides.
 *
 * OPERATOR RULING: "The API doesn't need to be masked." Between the password-type
 * defect and that ruling there was an interim build which kept the field plain
 * text but hid it behind `-webkit-text-security`, with a Show/Hide button beside
 * it. That is the machinery this set forbids.
 *
 * WHY FORBID IT RATHER THAN JUST NOT HAVE IT. A mask is the archetypal thing a
 * later "hardening" pass adds back on sight of a field it reads as a credential,
 * and a Show/Hide toggle is what a reviewer asks for once a mask exists. Nothing
 * in the code would then be wrong; it would simply disagree with the ruling and
 * with the plugin's own cog, which renders this same value in clear.
 *
 * These run over COMMENT-STRIPPED source, because the tab's own comment must stay
 * free to say what it used to do — unlike PASSWORD_TYPE above, whose subject is a
 * security defect and is therefore pinned over the whole file.
 */
const REVEAL_CONTROLS: Array<{ label: string; pattern: RegExp; }> = [
    { label: "a `revealed` state", pattern: /\brevealed\b/ },
    { label: "a `setRevealed` setter", pattern: /\bsetRevealed\b/ },
    { label: "a `masked` value", pattern: /\bmasked\b/ },
    { label: "the mask class", pattern: /MASKED_INPUT_CLASS|masked-secret/ },
    { label: "a CSS text mask", pattern: /text-security/ },
    { label: "a toggle's pressed state", pattern: /aria-pressed/ },
    { label: "a Show/Hide control label", pattern: /["'>]\s*(?:Show|Hide)\b/ }
];

function revealControlsIn(text: string): string[] {
    return REVEAL_CONTROLS.filter(c => c.pattern.test(text)).map(c => c.label);
}

// ---------------------------------------------------------------------------

describe("instrument checks — the scan is measuring the thing it names", () => {
    it("every file it reads exists and is not empty", () => {
        for (const file of [TAB, TAB_CSS, PLUGIN_SETTINGS, PLUGIN_STATE, REGISTRY, APPS_SCRIPT, HEADING_CSS, BASE_TEXT]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("and the module it no longer reads really is gone", () => {
        // The negative half of the check above. core/usage.ts held the spend
        // meter, the monthly cap and the BILLED set; existsSync() returning true
        // here would mean the deletion was reverted and the copy on this row is
        // being checked against the wrong authority.
        expect(existsSync(DELETED_USAGE), `still present: ${DELETED_USAGE}`).toBe(false);
    });

    it("it is reading the tab it thinks it is", () => {
        const src = read(TAB);
        expect(src).toContain("function TranslationApiKeySection()");
        expect(src).toContain("export default wrapTab(EquicordSettings");
    });

    it("section() extracts one function and not the whole file", () => {
        const src = read(TAB);
        const body = section(src);
        expect(body.length).toBeGreaterThan(0);
        expect(body.length).toBeLessThan(src.length);
        expect(body).not.toContain("function EquicordSettings()");
        expect(body).not.toContain("function Switches()");
    });

    it("headingRow() stops at its own closing tag (positive and negative control)", () => {
        const sample = [
            "<div style={HEADING_ROW_STYLE}>",
            "    <Heading>Title</Heading>",
            "</div>",
            "<Paragraph>OUTSIDE</Paragraph>"
        ].join("\n");
        expect(headingRow(sample)).toContain("<Heading>Title</Heading>");
        expect(headingRow(sample)).not.toContain("OUTSIDE");
    });

    it("paragraphs() finds every block and only the blocks (positive control)", () => {
        const sample = "<Paragraph>one</Paragraph>\nX\n<Paragraph className={y}>two</Paragraph>";
        const found = paragraphs(sample);
        expect(found).toHaveLength(2);
        expect(found[0]).toContain("one");
        expect(found[1]).toContain("two");
        expect(found.join("")).not.toContain("\nX\n");
    });

    it("paragraphs() returns nothing when there are none (negative control)", () => {
        expect(paragraphs("<div>no paragraphs here</div>")).toEqual([]);
    });

    it("codeLines() drops comments and keeps rendered copy (positive control)", () => {
        const sample = [
            "// Google bills you for what you use.",
            " * Google bills you for what you use.",
            "/* Google bills you for what you use. */",
            "    Apps Script has no billing at all."
        ].join("\n");
        expect(codeOf(sample)).not.toContain("bills you");
        expect(codeOf(sample)).toContain("no billing at all");
    });

    it("onSave/onReset extractors return the right function and stop (positive control)", () => {
        const src = section(read(TAB));
        const save = onSaveBody(src);
        const reset = onResetBody(src);

        expect(save).toContain("validateAppsScriptUrl(");
        expect(save).not.toContain("function onReset()");
        expect(reset).toContain("lastGood");
        expect(reset).not.toContain("validateAppsScriptUrl(");
        expect(reset.length).toBeLessThan(save.length);
    });

    it("the failure and success paths are disjoint slices of onSave (positive control)", () => {
        const save = onSaveBody(section(read(TAB)));
        const fail = failurePath(save);
        const win = successPath(save);

        expect(fail).toContain("!result.ok");
        expect(fail).toContain("return;");
        expect(win).not.toContain("!result.ok");
        expect(win.length).toBeGreaterThan(0);
        expect(fail.length + win.length).toBeLessThanOrEqual(save.length);
    });

    it("stringConst() reads a literal, joins a concatenation, and reports a renamed one", () => {
        expect(stringConst('const FOO = "bar";', "FOO")).toBe("bar");
        expect(stringConst('const FOO =\n    "bar " +\n    "baz";', "FOO")).toBe("bar baz");
        expect(() => stringConst('const BAZ = "bar";', "FOO")).toThrow();
    });

    it("messageExpressions/messageResidue separate literals from identifiers (controls)", () => {
        // Safe: literals only, and the provider's own reason string.
        expect(messageResidue('message: "all good"')).toBe("");
        expect(messageResidue('message:\n    "one " +\n    "two"')).toBe("");
        expect(messageResidue("message: result.reason });")).toBe("result.reason");
        // Unsafe: the credential reaching the status line, in each shape it could.
        expect(messageResidue('message: "failed for " + candidate')).toContain("candidate");
        expect(messageResidue("message: `${draft} is bad`")).toContain("draft");
        expect(messageResidue("message: verified")).toContain("verified");

        // And the extractor finds the multi-line form it has to handle.
        const sample = 'x\n    message:\n        "one " +\n        "two"\ny';
        expect(messageExpressions(sample)).toHaveLength(1);
        expect(messageExpressions(sample)[0]).toContain("two");
        expect(messageExpressions("no messages here")).toEqual([]);

        // THE CASE THE OLD LINE-START ANCHOR COULD NOT SEE, and the reason the
        // privacy assertion below could not fail. This is the shape the section
        // actually ships for the failure path.
        const inline = '            setStatus({ kind: "error", message: result.reason });';
        expect(messageExpressions(inline)).toHaveLength(1);
        expect(messageResidue(messageExpressions(inline)[0])).toBe("result.reason");

        // …and the same shape leaking the draft must leave a residue naming it.
        const leaking = '            setStatus({ kind: "error", message: draft + ": " + result.reason });';
        expect(messageResidue(messageExpressions(leaking)[0])).toContain("draft");

        // The slice starts at `message:` and not at `setStatus(`, so the literal
        // in `kind: "error"` cannot pad the residue back to empty.
        expect(messageExpressions(inline)[0].startsWith("message:")).toBe(true);
    });

    it("PASSWORD_TYPE fires on every shape the defect could take (positive control)", () => {
        // The exact string this row shipped, and the three neighbours a careless
        // reintroduction would reach for.
        expect(PASSWORD_TYPE.test('type={revealed ? "text" : "password"}')).toBe(true);
        expect(PASSWORD_TYPE.test('type="password"')).toBe(true);
        expect(PASSWORD_TYPE.test("type='password'")).toBe(true);
        expect(PASSWORD_TYPE.test('type={masked ? "password" : "text"}')).toBe(true);
        expect(PASSWORD_TYPE.test('type = "password"')).toBe(true);
    });

    it("the reveal matchers fire on the masked build this row used to be (positive control)", () => {
        // Verbatim from the interim build, one line per matcher, so a matcher
        // that silently stopped matching is caught here rather than passing the
        // real assertion by finding nothing.
        expect(revealControlsIn("const [revealed, setRevealed] = useState(false);"))
            .toEqual(expect.arrayContaining(["a `revealed` state", "a `setRevealed` setter"]));
        expect(revealControlsIn('const masked = !revealed && draft !== "";'))
            .toContain("a `masked` value");
        expect(revealControlsIn("className={masked ? MASKED_INPUT_CLASS : undefined}"))
            .toContain("the mask class");
        expect(revealControlsIn(".vc-vencord-tab-masked-secret input,"))
            .toContain("the mask class");
        expect(revealControlsIn("-webkit-text-security: disc;"))
            .toContain("a CSS text mask");
        expect(revealControlsIn("aria-pressed={revealed}"))
            .toContain("a toggle's pressed state");
        expect(revealControlsIn('{revealed ? "Hide" : "Show"}'))
            .toContain("a Show/Hide control label");
        expect(revealControlsIn("<Button>Show</Button>"))
            .toContain("a Show/Hide control label");
    });

    it("the reveal matchers abstain on the plain-text row and on ordinary copy (negative control)", () => {
        // The row as it now stands, and the words that must not be mistaken for
        // the machinery. A matcher that fired on "shows up in the other" or on
        // "hidden" would forbid this row's own paragraphs.
        expect(revealControlsIn(codeOf(section(read(TAB))))).toEqual([]);
        expect(revealControlsIn('type="text"')).toEqual([]);
        expect(revealControlsIn("a URL entered in either place shows up in the other")).toEqual([]);
        expect(revealControlsIn("Showing the whole URL is deliberate")).toEqual([]);
        expect(revealControlsIn("unmasking is not a thing this row does")).toEqual([]);
    });

    it("PASSWORD_TYPE abstains on the fix and on prose about it (negative control)", () => {
        // A matcher that fired on the word "password" would forbid this file and
        // the tab from explaining what was wrong, which is the same defect the
        // codeLines() control above exists to prevent.
        expect(PASSWORD_TYPE.test('type="text"')).toBe(false);
        expect(PASSWORD_TYPE.test("Chromium's password manager ignores autocomplete=off")).toBe(false);
        expect(PASSWORD_TYPE.test('const PASSWORD_MANAGER_OPT_OUTS = {')).toBe(false);
        expect(PASSWORD_TYPE.test("data-lpignore")).toBe(false);
    });

    it("the money matchers fire on the copy this row USED to carry (positive control)", () => {
        // Verbatim from the row before it was repointed, and from the plugin's
        // own googleCloudApiKey description.
        expect(moneyClaimsIn("Google bills you for what you use.")).toContain("somebody bills you");
        expect(moneyClaimsIn("usage bills at USD 20.00 per 1,000,000 characters"))
            .toEqual(expect.arrayContaining(["a currency amount", "per-character pricing"]));
        expect(moneyClaimsIn("You will be charged for every request."))
            .toContain("a charge will be made");
        expect(moneyClaimsIn("Requires a credit card on file.")).toContain("a card is required");
        expect(moneyClaimsIn("This is billed to your Cloud billing account."))
            .toEqual(expect.arrayContaining(["you are billed", "a payment method or billing account"]));
    });

    it("the money matchers abstain on the TRUE sentences (negative control)", () => {
        // Negations of a charge are the correct copy for this path and must not
        // be mistaken for a claim of one.
        expect(moneyClaimsIn(
            "There is no API key and no card: a consumer Google account allows about 5,000 " +
            "translation calls a day, and going past that fails the request rather than " +
            "charging you, because Apps Script has no billing at all."
        )).toEqual([]);
        expect(moneyClaimsIn(
            "It uses one call out of that day's ~5,000 and nothing else."
        )).toEqual([]);
    });
});

describe("the row edits the FREE credential, and only it", () => {
    it("it subscribes to appsScriptUrl and to lastGoodAppsScriptUrl", () => {
        const src = read(TAB);
        expect(src).toContain('translatorSettings.use(["appsScriptUrl", "lastGoodAppsScriptUrl"])');
    });

    it("it never reads or writes the deleted Google Cloud key", () => {
        // It was the PAID Cloud Translation v2 key when this assertion was
        // written, and editing it was this row's original defect. The setting has
        // since been removed from settings.ts entirely, so reading it now would
        // not be "the wrong credential" — it would be a subscription to a setting
        // that does not exist, answered with undefined rather than an error.
        const src = codeOf(read(TAB));
        expect(src, "the row is back on the deleted paid key").not.toMatch(/translator\.googleCloudApiKey\b/);
        expect(src).not.toContain('use(["googleCloudApiKey"])');
        expect(src).not.toMatch(/translator\.deeplApiKey\b/);
    });

    it("both ids it names are ids the plugin actually defines", () => {
        // The typechecker does not constrain these — see
        // test/vencordTabApiKeyRow.test.ts, which measured a wrong id compiling
        // clean. Read the plugin's own spelling rather than a list written here.
        const plugin = read(PLUGIN_SETTINGS);
        for (const id of ["appsScriptUrl", "lastGoodAppsScriptUrl"]) {
            expect(plugin, `the plugin no longer defines ${id}`).toMatch(new RegExp(`^ {4}${id}: \\{$`, "m"));
        }
    });

    it("the heading names the free proxy, not a key you buy", () => {
        const heading = headingRow(section(read(TAB)));
        expect(heading).toContain("Apps Script proxy");
        expect(heading.toLowerCase()).toContain("free");
        expect(heading).not.toContain("API Key");
    });
});

describe("the guide link: exact text, and on the heading's row", () => {
    it("the visible text is exactly \"→ Setup Guide\"", () => {
        const label = stringConst(read(TAB), "SETUP_GUIDE_LABEL");
        expect(label).toBe(EXPECTED_LINK_TEXT);
        // Spelled out so a failure says which character moved: U+2192, U+0020,
        // then "Setup Guide". An em dash, an ASCII "->" or a lost space all fail.
        expect([...label].map(c => c.codePointAt(0)))
            .toEqual([0x2192, 0x20, 0x53, 0x65, 0x74, 0x75, 0x70, 0x20, 0x47, 0x75, 0x69, 0x64, 0x65]);
    });

    it("that constant is what the link actually renders", () => {
        expect(headingRow(section(read(TAB)))).toContain("{SETUP_GUIDE_LABEL}");
    });

    it("the link is in the heading row, immediately after the heading", () => {
        const row = headingRow(section(read(TAB)));
        expect(row).toContain("<Heading");
        expect(row).toContain("<a");
        expect(
            row.indexOf("</Heading>"),
            "the link is rendered before the heading, not to its right"
        ).toBeLessThan(row.indexOf("<a"));
    });

    it("the link is NOT inside the paragraph any more", () => {
        // Where it used to live, and the specific thing the operator asked to
        // change: "move it right next to Google Cloud Translation API key".
        for (const block of paragraphs(section(read(TAB)))) {
            expect(block, "the guide link is back inside a paragraph")
                .not.toContain("SETUP_GUIDE_LABEL");
            expect(block).not.toContain(EXPECTED_LINK_TEXT);
        }
    });

    it("the row is a vertically-centred flex row with a gap", () => {
        const src = read(TAB);
        const style = sliceBetween(src, "const HEADING_ROW_STYLE: CSSProperties = {", "};");
        expect(style).toContain('display: "flex"');
        expect(style).toContain('alignItems: "center"');
        expect(style).toMatch(/gap:\s*"\d+px"/);
    });

    it("the link is bigger than prose and weighted like a control", () => {
        const style = sliceBetween(read(TAB), "const SETUP_GUIDE_LINK_STYLE: CSSProperties = {", "};");
        expect(style).toContain('cursor: "pointer"');
        expect(style).toContain('color: "var(--text-link)"');
        expect(style).toMatch(/fontSize:\s*"16px"/);
        expect(style).toMatch(/fontWeight:\s*[6-9]00/);
    });

    it("\"bigger than prose\" is measured: a Paragraph here is 14px", () => {
        // The operator asked for a bigger font. The link used to inherit the
        // paragraph's size, so the claim is only true while `<Paragraph>`'s
        // default size ("sm", src/components/Paragraph.tsx) is smaller than the
        // 16px above. Read out of the type scale rather than believed.
        const smIs14 = /sm:\s*\{\s*fontSize:\s*"14px"/;
        const sizes = sliceBetween(read(BASE_TEXT), "const TextSizes", "};");
        expect(sizes).toMatch(smIs14);
        // Controls for the matcher itself: it must notice the scale moving.
        expect(smIs14.test('    sm: { fontSize: "14px", lineHeight: "1.28" },')).toBe(true);
        expect(smIs14.test('    sm: { fontSize: "16px", lineHeight: "1.28" },')).toBe(false);
    });

    it("16px is the heading's own size — checked against Heading.css, not asserted", () => {
        // `<Heading>` defaults to tag h5 (src/components/Heading.tsx), so the
        // claim "comparable to the heading" is only true while .vc-h5 is 16px.
        // If Discord's type scale moves, this fails instead of quietly lying.
        const css = read(HEADING_CSS);
        // The STANDALONE rule, not the grouped `.vc-h1, … .vc-h5 {` block above
        // it, which carries only colour and font-family. The blank line before
        // it is what distinguishes the two, and the first draft of this
        // assertion picked the wrong one.
        const h5 = sliceBetween(css, "\n\n.vc-h5 {", "}");
        expect(h5).toContain("font-size: 16px");
        expect(h5).toContain("font-weight: 500");
    });

    it("both destinations are still distinguishable, by title and aria-label", () => {
        const src = read(TAB);
        const titles = sliceBetween(src, "const SETUP_GUIDE_TITLE: Record<string, string> = {", "};");
        expect(titles).toContain("packaged:");
        expect(titles).toContain("hosted:");
        expect(titles).toContain("repo:");
        expect(titles, "the repo destination no longer says where it goes").toContain("GitHub");

        const row = headingRow(section(src));
        expect(row).toContain("title={SETUP_GUIDE_TITLE[guide.kind]}");
        expect(row).toContain("aria-label={SETUP_GUIDE_TITLE[guide.kind]}");
    });

    it("the no-guide honesty sentence survived", () => {
        const src = read(TAB);
        const sentence = stringConst(src, "NO_GUIDE_SENTENCE");
        expect(sentence).toContain("not reachable from this build");
        expect(sentence).toContain("site/free/index.html");
        // And it is actually rendered, not merely declared.
        expect(codeOf(section(src))).toContain("NO_GUIDE_SENTENCE");
    });

    it("the guide address still comes from the plugin's resolver", () => {
        const src = read(TAB);
        expect(src).toMatch(/\bguideTarget\(\)/);
        expect(src).not.toMatch(/https:\/\/[^"'\s]*(?:guide|setup)/i);
    });
});

describe("draft state: the store is not written on every keystroke any more", () => {
    it("the input renders the draft, not the stored value", () => {
        const src = section(read(TAB));
        expect(src).toContain("value={draft}");
        expect(src).not.toContain("value={translator.appsScriptUrl");
    });

    it("typing writes React state and nothing else", () => {
        const src = section(read(TAB));
        const onChange = sliceBetween(src, "onChange={value => {", "}}");
        expect(onChange).toContain("setDraft(value)");
        expect(
            onChange,
            "a half-pasted URL would go live: the input writes the setting again"
        ).not.toContain("translator.");
    });

    it("the draft is seeded from the stored value", () => {
        expect(section(read(TAB))).toContain("useState(stored)");
    });

    it("an external change with no unsaved edits moves the draft; with edits it does not", () => {
        // The documented rule, pinned so the two branches cannot be collapsed
        // into "always follow" (which discards the user's typing) or "never
        // follow" (which leaves a stale box).
        const effect = sliceBetween(section(read(TAB)), "useEffect(() => {", "}, [stored]);");
        expect(effect).toContain("draftRef.current !== reconciled.current");
        expect(effect).toContain("setMovedElsewhere(true)");
        expect(effect).toContain("setDraft(stored)");
        expect(
            effect.indexOf("setMovedElsewhere(true)"),
            "the draft is overwritten before the unsaved-edit branch can stop it"
        ).toBeLessThan(effect.indexOf("setDraft(stored)"));
    });

    it("unsaved changes are shown", () => {
        const src = section(read(TAB));
        expect(src).toContain("const dirty = draft !== stored;");
        expect(src).toMatch(/\{dirty && \(/);
        expect(src).toContain("Unsaved changes");
    });
});

describe("Save — confirm and apply", () => {
    it("it calls validateAppsScriptUrl, imported from the plugin's state module", () => {
        const src = read(TAB);
        expect(src).toContain('import { validateAppsScriptUrl } from "@plugins/channelTranslator/state"');
        expect(onSaveBody(section(src))).toContain("await validateAppsScriptUrl(candidate)");
    });

    it("that function is the one state.ts actually exports", () => {
        expect(read(PLUGIN_STATE))
            .toContain("export async function validateAppsScriptUrl(candidateUrl: string): Promise<EndpointCheck>");
    });

    it("the SUCCESS path writes BOTH setting ids", () => {
        const win = successPath(onSaveBody(section(read(TAB))));
        expect(win).toMatch(/translator\.appsScriptUrl\s*=/);
        expect(win).toMatch(/translator\.lastGoodAppsScriptUrl\s*=/);
    });

    it("the FAILURE path writes NEITHER, and shows the reason verbatim", () => {
        const fail = failurePath(onSaveBody(section(read(TAB))));
        expect(
            codeOf(fail),
            "a failed check committed something — Reset's promise is gone"
        ).not.toMatch(/translator\.\w+\s*=/);
        expect(fail).toContain("message: result.reason");
        expect(fail).toContain("return;");
    });

    it("the reason is rendered in full, not truncated", () => {
        const src = section(read(TAB));
        expect(src).toContain("{status.message}");
        // No slice/substring/ellipsis applied to it anywhere.
        expect(src).not.toMatch(/status\.message\.(?:slice|substring|substr)\b/);
    });

    it("the candidate URL is never rendered, logged or copied into the status line", () => {
        const sectionSrc = section(read(TAB));
        expect(codeOf(sectionSrc)).not.toMatch(/console\.(?:log|warn|error|info)/);

        // Every status message is string literals only, plus `result.reason` —
        // the provider's own prose, which state.ts documents as never carrying
        // the URL. Anything else on the right of `message:` is an identifier,
        // and the only identifiers in scope here hold the credential.
        const expressions = messageExpressions(sectionSrc);
        expect(expressions.length, "no status messages found — the scan is empty").toBeGreaterThan(2);
        for (const expr of expressions) {
            const residue = messageResidue(expr);
            expect(
                residue === "" || residue === "result.reason",
                `a status message is built from something other than literals: ${residue}`
            ).toBe(true);
        }
    });

    it("both buttons are disabled and a busy state is shown while it is in flight", () => {
        const src = section(read(TAB));
        expect(src).toContain("const saveDisabled = checking || draft.trim() === \"\" || !dirty;");
        expect(src).toContain("disabled={saveDisabled}");
        expect(src).toContain('disabled={checking || lastGood === ""}');
        expect(src).toContain("aria-busy={checking}");
        expect(src).toMatch(/checking \? "Checking/);
    });

    it("Save is disabled when the draft is empty or unchanged", () => {
        const disabled = sliceBetween(section(read(TAB)), "const saveDisabled =", ";");
        expect(disabled).toContain('draft.trim() === ""');
        expect(disabled).toContain("!dirty");
    });
});

describe("Reset — restore the last VERIFIED URL", () => {
    it("it reads lastGoodAppsScriptUrl", () => {
        const src = section(read(TAB));
        expect(src).toContain("const lastGood = (translator.lastGoodAppsScriptUrl ?? \"\").trim();");
        expect(onResetBody(src)).toContain("translator.appsScriptUrl = lastGood;");
        expect(onResetBody(src)).toContain("setDraft(lastGood);");
    });

    it("it restores BOTH the draft and the stored URL", () => {
        const reset = onResetBody(section(read(TAB)));
        expect(reset).toMatch(/translator\.appsScriptUrl\s*=\s*lastGood/);
        expect(reset).toMatch(/setDraft\(lastGood\)/);
    });

    it("it does not overwrite the record of what worked", () => {
        // Reset READS lastGoodAppsScriptUrl. Writing it here would make "last
        // working" mean "last restored", which is circular.
        expect(onResetBody(section(read(TAB)))).not.toMatch(/translator\.lastGoodAppsScriptUrl\s*=/);
    });

    it("it is disabled when nothing has ever been verified, and says why", () => {
        const src = section(read(TAB));
        expect(src).toContain('disabled={checking || lastGood === ""}');
        expect(src).toMatch(/\{lastGood === "" && \(/);
        expect(src).toContain("Reset is unavailable until one Save has succeeded");
    });

    it("it is NOT seeded from the merely-stored value", () => {
        // The deliberate controller decision: the stored URL has never been
        // checked, so presenting it as "last working" would be a lie on the
        // button's own label.
        const src = section(read(TAB));
        expect(src).not.toMatch(/lastGood\s*(?:\|\||\?\?)\s*stored/);
        expect(src).not.toMatch(/lastGoodAppsScriptUrl\s*(?:\|\||\?\?)\s*translator\.appsScriptUrl/);
    });

    it("it is visually secondary to Save", () => {
        // BOTH halves are read over the WHOLE element, opening tag included. The
        // "Save is not secondary" half used to start its slice at onClick={onSave}
        // and therefore never saw a `variant` prop written above it — which is
        // where this codebase writes it, as the Reset button below demonstrates.
        // The assertion could not fail. The control immediately after this one is
        // what keeps that from happening again.
        const src = section(read(TAB));

        const reset = buttonContaining(src, "onClick={onReset}");
        expect(reset).toContain("Reset");
        expect(reset).toContain('variant="secondary"');

        const save = buttonContaining(src, "onClick={onSave}");
        expect(save).toContain("Save");
        expect(save, "Save must not be the secondary button — Reset is").not.toContain('variant="secondary"');
    });

    it("the slice really does reach props written ABOVE onClick (control)", () => {
        // Both directions on a fixture whose variant sits above onClick, which is
        // exactly the arrangement the old forward-only slice was blind to.
        const above = [
            "<Button",
            '    size="small"',
            '    variant="secondary"',
            "    onClick={onSave}",
            ">",
            "    Save",
            "</Button>"
        ].join("\n");
        expect(buttonContaining(above, "onClick={onSave}")).toContain('variant="secondary"');

        const below = [
            "<Button",
            '    size="small"',
            "    onClick={onSave}",
            ">",
            "    Save",
            "</Button>"
        ].join("\n");
        expect(buttonContaining(below, "onClick={onSave}")).not.toContain('variant="secondary"');

        // And the old, defective slice would have missed the first one — recorded
        // so the reason this helper exists survives its own explanation.
        expect(sliceBetween(above, "onClick={onSave}", "</Button>")).not.toContain('variant="secondary"');
    });
});

describe("the copy does not claim this path costs money", () => {
    it("no money claim appears in anything the section renders", () => {
        const found = moneyClaimsIn(codeOf(section(read(TAB))));
        expect(
            found,
            `the section claims this free path costs money: ${found.join(", ")}`
        ).toEqual([]);
    });

    it("and it says the true thing instead", () => {
        const src = codeOf(section(read(TAB)));
        expect(src).toContain("no billing at all");
        expect(src).toContain("no API key and no card");
        expect(src).toMatch(/5,000/);
    });

    it("nothing this plugin can reach is billed — read out of the registry, not restated", () => {
        // THIS USED TO READ core/usage.ts's BILLED set and check that
        // "apps-script" was absent from it. That set is deleted along with the two
        // providers in it, so the question moved up a level and got easier to
        // answer honestly: the copy on this row says the free path costs nothing,
        // and what makes that true is that the registry holds NOTHING ELSE.
        //
        // Read out of registry.ts rather than restated here, for the same reason
        // the old version read the BILLED set: the copy has to be checked against
        // the code that decides it, not against a second copy of the same belief.
        const registry = sliceBetween(read(REGISTRY), "export const registry = new Map", "\n]);");
        expect(registry, "the registry literal was not found").toContain('["google"');
        expect(registry).toContain('["apps-script"');
        expect(
            registry,
            "a paid provider is back in the registry — the copy on this row is now false"
        ).not.toContain('"deepl"');
        expect(registry).not.toContain('"google-cloud"');
    });

    it("that registry slice is really the literal, and not the whole file (control)", () => {
        const registry = sliceBetween(read(REGISTRY), "export const registry = new Map", "\n]);");
        expect(registry.length).toBeGreaterThan(50);
        expect(registry.length).toBeLessThan(read(REGISTRY).length);
        // resolveProvider() is defined below the literal and must be outside it.
        expect(registry).not.toContain("export function resolveProvider(");
    });

    /**
     * THE ASSERTION THAT INVERTED, AND IT IS CURRENTLY RED ON PURPOSE.
     *
     * This used to read "the paid options are still findable, so nobody thinks
     * they were deleted", and it required the section to contain the sentence
     * "The Google Cloud Translation key and the DeepL key have not gone anywhere
     * — they are still editable in the translator plugin's own settings".
     *
     * THAT SENTENCE IS NOW FALSE. Both settings were removed from settings.ts
     * with the providers that read them: a user who follows it to Settings >
     * Plugins > ChannelTranslator > the cog finds no such fields. Keeping the old
     * assertion would pin a shipped lie in place and call it coverage, which is
     * the exact failure this suite exists to prevent — so it is inverted rather
     * than deleted.
     *
     * THE FIX IS ONE PARAGRAPH IN THE TAB, not a change here: delete the
     * `<Paragraph>` beginning "The Google Cloud Translation key and the DeepL key
     * have not gone anywhere" from TranslationApiKeySection() in
     * src\components\settings\tabs\vencord\index.tsx. It is a muted-colour
     * aside with no controls in it; nothing else reads it.
     */
    it("does not tell the user the deleted paid keys are still editable in the cog", () => {
        const src = codeOf(section(read(TAB)));
        for (const claim of ["Google Cloud Translation key", "the DeepL key", "have not gone anywhere"]) {
            expect(
                src,
                "this row still points the user at API-key settings that no longer exist — " +
                "delete the \"have not gone anywhere\" Paragraph from TranslationApiKeySection()"
            ).not.toContain(claim);
        }
    });

    it("still tells the user where the plugin's own settings are (negative control)", () => {
        // The paragraph above goes; the pointer to the plugin's settings stays,
        // because the same URL really is editable there. Without this control the
        // assertion above would be satisfied by deleting all of the copy.
        const src = codeOf(section(read(TAB)));
        expect(src).toContain("ChannelTranslator");
    });
});

/**
 * THE BOX TAKES TWO FORMS, AND THE COPY IS THE ONLY THING THAT SAYS SO.
 *
 * Operator ruling: the credential may be given as the whole Web App URL, exactly
 * as before, OR as the short Deployment ID that Google's own Deploy dialog puts a
 * copy button beside. checkDeploymentUrl() accepts both and normalises them to one
 * canonical /exec address, so nothing downstream can tell which was typed.
 *
 * A capability nobody is told about is not a feature. Every assertion here is
 * about what the user can READ — the body copy, the placeholder, the accessible
 * names — because that is the entire mechanism by which a user learns the shorter
 * form is allowed. The last two are the other direction: they check the PROMISE
 * against the code that keeps it, so this row cannot go on advertising an ID after
 * the parser stops taking one.
 *
 * STRICTLY ADDITIVE, and the negative controls are what pin that. The URL form was
 * valid before this change and must still be named, still be shown, and still be
 * accepted; an "improvement" that quietly drops it would break every existing
 * install, and a Google Workspace user has no other option at all.
 */
describe("the credential box takes a Deployment ID as well as a URL, and says so", () => {
    it("the rendered copy tells the user to paste the Deployment ID", () => {
        const src = codeOf(section(read(TAB)));
        expect(
            src,
            "nothing rendered names the Deployment ID — the shorter form is accepted in " +
            "silence, so nobody will use it"
        ).toContain("Paste the Deployment ID");
    });

    it("and the Web App URL is still offered, not replaced (negative control)", () => {
        // Without this, the assertion above is satisfied by copy that tells the
        // user the ID is now the ONLY accepted form. It is not: every stored URL
        // still works, and a Workspace account cannot use an ID at all.
        const src = codeOf(section(read(TAB)));
        expect(src).toContain("or the whole Web App URL");
        expect(src).toContain("https://script.google.com/macros/s/");
        expect(src, "the Workspace caveat went — those users have no working instruction")
            .toContain("Workspace");
    });

    it("the placeholder shows the ID form, and shows it first", () => {
        const ph = placeholderOf(codeOf(section(read(TAB))));
        expect(ph, "the placeholder does not name the Deployment ID").toContain("Deployment ID");
        const idAt = ph.indexOf("AKfycb");
        const urlAt = ph.indexOf("https://");
        expect(idAt, "the placeholder shows no example ID").toBeGreaterThan(-1);
        expect(urlAt, "the placeholder stopped showing the URL form entirely").toBeGreaterThan(-1);
        expect(
            idAt,
            "the URL form is shown before the ID form — the point of the change is that the " +
            "SHORTER value leads, because it is the one with a copy button"
        ).toBeLessThan(urlAt);
    });

    it("the accessible names cover both forms, not the URL alone", () => {
        // A screen-reader user gets the aria-label and nothing else. Leaving it
        // saying "deployment URL" tells them the ID is not allowed here.
        const src = codeOf(section(read(TAB)));
        expect(src).toContain('aria-label="Apps Script proxy Deployment ID or Web App URL"');
        expect(src).toContain("Check this Apps Script Deployment ID or Web App URL and apply it");
    });

    it("the provider really does accept a bare ID — read out of appsScript.ts, not restated", () => {
        // The copy above is a claim about behaviour. This is the behaviour.
        const provider = read(APPS_SCRIPT);
        expect(provider, "checkDeploymentId() is gone — the row's copy now promises a form " +
            "nothing implements").toContain("function checkDeploymentId(");
        expect(
            provider,
            "checkDeploymentUrl() no longer diverts a slash-less, scheme-less paste to the " +
            "ID branch, so a bare Deployment ID is refused again"
        ).toContain("return checkDeploymentId(trimmed);");
    });

    /**
     * 🔴 THE SECOND PARSER IS GONE, AND THIS IS WHAT KEEPS IT GONE.
     *
     * `appsScriptUrl` is wired to `isValid: appsScriptUrlProblem`. That function
     * used to be a parser of its own — NOT checkDeploymentUrl() — so this row
     * accepted a bare Deployment ID while the cog's own box answered the
     * identical string with "That is not a URL." One setting, two authorities,
     * two verdicts, kept in step by nothing but two people remembering to edit
     * both. It now delegates, so they agree by construction.
     *
     * WHAT IS PINNED HERE IS THE COPY TRACKING THE CODE, IN BOTH DIRECTIONS.
     * While the delegation is absent the cog's description must carry the caveat
     * that this box needs the whole URL; while it is present that caveat is a lie
     * and must be absent. Either half moving without the other fails this. The
     * BEHAVIOUR of the delegation — that the two validators return the same
     * verdict on the same input — is pinned separately and much harder in
     * test/settingsValidatorDelegation.test.ts, which calls both functions
     * instead of reading the source of either.
     */
    it("the cog's copy says exactly what the cog's own validator does", () => {
        const plugin = read(PLUGIN_SETTINGS);
        const delegates = plugin.includes("const shape = checkDeploymentUrl(trimmed);");
        const warnsItCannot = cogDescription(plugin).includes("THIS BOX still needs the whole URL");
        expect(
            delegates !== warnsItCannot,
            delegates
                ? "appsScriptUrlProblem() now accepts a bare Deployment ID, but the cog's own " +
                  "description still tells the user this box cannot take one — delete the " +
                  "\"THIS BOX still needs the whole URL\" sentence from settings.ts"
                : "appsScriptUrlProblem() still refuses a bare Deployment ID and the cog's " +
                  "description no longer says so — it is advertising a form that box rejects"
        ).toBe(true);
    });

    it("and the signpost to the other screen is gone, because this box takes the ID itself", () => {
        // This sentence used to be the least-bad answer available: the box could
        // not take an ID, so its refusal at least named a screen that could. Now
        // that the box takes one, sending the user somewhere else is a false
        // instruction — it costs them a navigation to reach a field no better
        // than the one they are already standing in.
        const plugin = read(PLUGIN_SETTINGS);
        expect(
            plugin,
            "the refusal still tells an ID-holding user to go and paste it on the settings " +
            "tab, but this box accepts it — delete that sentence from appsScriptUrlProblem()"
        ).not.toContain("If you copied the short Deployment ID instead");
        expect(
            cogDescription(plugin),
            "the cog description still redirects the user to the settings tab for the ID form"
        ).not.toContain("Apps Script proxy section on Discord Translator's own settings tab");
    });

    it("and the description still names BOTH forms, so that is not satisfied by deleting the copy "
        + "(negative control)", () => {
        // Without this, the assertions above pass for a description that says
        // nothing at all about which values the box takes — which is the failure
        // mode "delete the sentence" most easily turns into.
        const description = cogDescription(read(PLUGIN_SETTINGS));
        expect(description, "the description no longer names the Deployment ID form")
            .toContain("Deployment ID");
        expect(description, "the description no longer names the Web App URL form")
            .toContain("Web App URL");
        expect(description, "the Workspace caveat went — those users have no working instruction")
            .toContain("Workspace");
    });

    it("cogDescription() flattens the block and stops at it (controls)", () => {
        const description = cogDescription(read(PLUGIN_SETTINGS));
        // A sentence that straddles a concatenation break in the source: proof
        // the flattening is doing something a raw file scan could not.
        expect(description).toContain("There is no API key and no card");
        expect(description.length).toBeGreaterThan(400);
        // The next setting down must be outside the slice.
        expect(description).not.toContain("Also translate direct messages");
        expect(() => cogDescription("const x = 1;")).toThrow();
    });

    it("placeholderOf() reads a literal, and refuses a dynamic one (controls)", () => {
        expect(placeholderOf('<TextInput placeholder="abc" value={draft} />')).toBe("abc");
        expect(() => placeholderOf("<TextInput value={draft} />")).toThrow();
        expect(() => placeholderOf("<TextInput placeholder={PLACEHOLDER} />")).toThrow();
    });

    it("every assertion above fails on the copy this row USED to carry (positive control)", () => {
        // The exact strings that were there before the two forms were accepted. If
        // the matchers cannot tell the old row from the new one they are measuring
        // nothing, and the whole describe passes vacuously.
        const OLD_BODY = "The Web App URL of the Apps Script proxy you deploy once into your own " +
            "Google account. It looks like https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec";
        expect(OLD_BODY).not.toContain("Paste the Deployment ID");
        expect(OLD_BODY).not.toContain('aria-label="Apps Script proxy Deployment ID or Web App URL"');

        const OLD_INPUT = '<TextInput placeholder="https://script.google.com/macros/s/…/exec" />';
        const oldPh = placeholderOf(OLD_INPUT);
        expect(oldPh).not.toContain("Deployment ID");
        expect(oldPh.indexOf("AKfycb")).toBe(-1);
    });
});

describe("what the row kept from before", () => {
    it("the long-URL, no-autocomplete, no-spellcheck and label properties are all still there", () => {
        const src = section(read(TAB));
        expect(src, "a long deployment URL would be truncated at 999 characters")
            .toContain("maxLength={null}");
        expect(src).toContain('autoComplete="off"');
        expect(src).toContain("spellCheck={false}");
        // UPDATED, NOT WEAKENED. Still an exact-string pin on the input's
        // accessible name; only the name changed, because the box now takes a
        // Deployment ID as well as a URL and an aria-label saying "deployment URL"
        // tells a screen-reader user the shorter form is not allowed here.
        expect(src).toContain('aria-label="Apps Script proxy Deployment ID or Web App URL"');
    });

    it("every button is this codebase's own Button component", () => {
        const src = read(TAB);
        expect(src).toContain('import { Button } from "@components/Button"');
        // No hand-rolled <button> in the section.
        expect(codeOf(section(src))).not.toMatch(/<button\b/);
    });

    it("the store still comes from the plugin module", () => {
        const src = read(TAB);
        expect(src).toContain('from "@plugins/channelTranslator/settings"');
        expect(src).not.toContain("definePluginSettings");
    });
});

describe("the field is not something a password manager will fill", () => {
    it("the value is shown in clear — no mask, and so no reveal toggle to need", () => {
        // OPERATOR RULING: "The API doesn't need to be masked." An interim build
        // kept the field plain text but hid it behind `-webkit-text-security` and
        // put a Show/Hide button beside it. Both are gone, and this is the
        // assertion that keeps them gone: a mask is exactly what a later
        // "hardening" pass adds back on sight of a field it reads as a credential.
        //
        // The row now matches the plugin's own settings cog, which has rendered
        // this same value in clear throughout.
        const code = codeOf(section(read(TAB)));
        expect(
            revealControlsIn(code),
            "the mask or its reveal toggle is back on a row the operator ruled plain text"
        ).toEqual([]);
    });

    it("NOTHING in this file declares an input of type password — comments included", () => {
        // THE REGRESSION THAT MATTERS, AND IT IS PINNED OVER THE WHOLE FILE.
        //
        // An earlier version of this block stripped comments first, so the tab
        // stayed free to quote the old ternary verbatim while explaining it. That
        // is a nicer rule to write and a worse rule to hold: a source scan is
        // exactly as strong as the narrowest slice it looks at, and "the defect is
        // absent from the code lines" is a strictly weaker claim than "the defect
        // is absent". The whole file is scanned instead. The cost is that the tab
        // must describe the old type in prose rather than paste it as an
        // attribute, which its comment does — and that is a small price for a
        // check that cannot be slipped past by moving a line into a comment.
        const src = read(TAB);
        expect(
            src,
            "the literal type=\"password\" is back somewhere in this file"
        ).not.toContain('type="password"');
        expect(
            PASSWORD_TYPE.test(src),
            "a password-typed input is back — Chromium's password manager will autofill it"
        ).toBe(false);

        // And in EXECUTABLE code, not even the bare literal, in either quoting.
        // The prose above needs the word; the code has no honest use for it.
        expect(
            codeOf(src),
            'a "password" literal is back in executable code'
        ).not.toMatch(/["']password["']/);
    });

    it("the input positively declares itself text", () => {
        // Declared, not left to whatever TextInput happens to default to: an
        // implicit type is one webpack update away from being someone else's
        // decision, and this is the one prop whose value caused the incident.
        const input = sliceBetween(section(read(TAB)), "<TextInput", "/>");
        expect(input).toContain('type="text"');
    });

    it("the stylesheet carries no masking rule, and the tab still imports it", () => {
        // The mask lived in VencordTab.css against a `masked-secret` class. Both
        // are gone, and the file is back to exactly what it was before that build.
        // The import assertion is unrelated to masking and stays: the tab's other
        // classes come from this stylesheet.
        expect(read(TAB)).toContain('import "./VencordTab.css";');
        const css = read(TAB_CSS);
        expect(css, "the mask class is back in the stylesheet").not.toContain("masked-secret");
        expect(css, "a text-security mask is back in the stylesheet").not.toContain("text-security");
    });

    it("the third-party password managers are asked to skip it, best-effort", () => {
        const src = read(TAB);
        const optOuts = sliceBetween(src, "const PASSWORD_MANAGER_OPT_OUTS = {", "};");
        expect(optOuts).toContain('"data-1p-ignore": ""');
        expect(optOuts).toContain('"data-lpignore": "true"');
        expect(optOuts).toContain('"data-bwignore": ""');
        expect(optOuts).toContain('"data-form-type": "other"');

        // Declared is not applied: they must actually reach the input.
        const input = sliceBetween(section(src), "<TextInput", "/>");
        expect(input).toContain("{...PASSWORD_MANAGER_OPT_OUTS}");
        expect(input).toContain('autoComplete="off"');

        // And the file must not sell them as a guarantee. They are conventions
        // those extensions choose to honour; the fix is the missing password type.
        expect(
            src,
            "the opt-out attributes are presented as if they were a guarantee"
        ).toContain("not a platform guarantee");
    });

    it("an empty stored value says out loud where a pre-filled box came from", () => {
        const src = read(TAB);
        const sentence = stringConst(src, "NOTHING_STORED_SENTENCE");
        expect(sentence).toContain("Nothing is saved here yet");
        expect(sentence).toContain("came from outside this plugin");
        expect(sentence.toLowerCase()).toContain("password manager");

        // Declared AND rendered, and only on the empty-store case — the row must
        // not accuse a user with a perfectly good saved URL.
        const sectionSrc = section(src);
        expect(codeOf(sectionSrc)).toContain("NOTHING_STORED_SENTENCE");
        expect(sectionSrc).toContain('{stored === "" ? " " + NOTHING_STORED_SENTENCE : null}');
    });

    it("the reconciliation refs were not disturbed by any of this", () => {
        // The draft/stored reconciliation is the one piece of logic in this row
        // that is genuinely hard to get right, and nothing above needed to touch
        // it. Pinned here so a future "defensive" change to the masking cannot
        // quietly reach into it.
        const effect = sliceBetween(section(read(TAB)), "useEffect(() => {", "}, [stored]);");
        expect(effect).toContain("if (stored === reconciled.current) return;");
        expect(effect).toContain("const hadUnsavedEdits = draftRef.current !== reconciled.current;");
        expect(effect).not.toContain("masked");
        expect(effect).not.toContain("revealed");
    });
});
