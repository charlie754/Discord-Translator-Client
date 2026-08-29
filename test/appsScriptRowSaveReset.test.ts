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
/**
 * THE THIRD SURFACE. The bundled setup guide, shipped as guide.html.
 *
 * This row's copy, the plugin cog's `appsScriptUrl` description and this file all
 * describe ONE box behind ONE validator. The guide is the only one of the three
 * that is not source code, so it is the one nobody greps when the validator
 * changes — and that is exactly how it went wrong. See the describe at the end of
 * this file for the sentence that shipped.
 */
const GUIDE = join(ROOT, "site", "free", "index.html");

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
 * The value of a top-level `const NAME = \`…\`;` TEMPLATE, with every
 * `${OTHER_CONST}` in it replaced by that constant's own text.
 *
 * WHY THIS EXISTS RATHER THAN A REGEX OVER THE JSX. The input's accessible name
 * is deliberately not a literal any more — it is built from the heading's
 * constant so the two cannot drift — and a matcher that could only read literals
 * would have to be pointed at the template SOURCE, i.e. at `${SETTINGS_HEADING}`
 * rather than at "Setup Google Key". Asserting on the source text of a
 * substitution proves the substitution is written; it says nothing about what
 * the user is told. This resolves it and the assertions stay about the sentence.
 *
 * STRICT ON PURPOSE: an unresolvable placeholder fails here rather than being
 * left in the string, because a leftover `${…}` would silently make every
 * `toContain` about the resolved text fail for the wrong reason, and every
 * `not.toContain` pass for the wrong reason.
 */
function templateConst(src: string, name: string): string {
    const pattern = new RegExp(`const ${name}\\s*=\\s*\`([^\`]*)\`;`);
    const match = pattern.exec(src);
    expect(match, `const ${name} = \`…\`; was removed, renamed or is no longer a template`)
        .not.toBeNull();

    return match![1].replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_whole, referenced: string) =>
        stringConst(src, referenced));
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
// THREE SURFACES, ONE VALIDATOR — the machinery for the guard at the end.
// ---------------------------------------------------------------------------

/**
 * The named entities this build's copy actually uses, plus the ASCII four.
 *
 * Enumerated rather than pulled from a library on purpose: the assertions below
 * are about SENTENCES, and a sentence with `&mdash;` still sitting in it is not
 * the sentence the reader sees. The list was taken from the shipped file — see
 * the instrument check that asserts nothing is left undecoded.
 */
const HTML_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", rarr: "→", larr: "←", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    middot: "·", times: "×", bull: "•", deg: "°"
};

function decodeEntities(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_whole, digits: string) => String.fromCodePoint(Number(digits)))
        .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => HTML_ENTITIES[name] ?? whole);
}

/**
 * Tags that end a thought on screen.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT JUST `<[^>]*>`. The claim this file forbids
 * is a CONTRADICTION, and a contradiction is asserted inside one sentence: "this
 * box takes either, but THAT one takes only the URL". The scan therefore matches
 * two things inside one statement, which means statement boundaries decide what
 * it can see. Flatten a whole document with no boundaries and an unrelated
 * heading ends up glued to an unrelated paragraph, and the conjunction fires on a
 * claim nobody made. `<h2>` and `<li>` carry no full stop, so without this the
 * guide's step list is one 700-character "sentence".
 *
 * `g` flag, and used only in `.replace()`. `RegExp.prototype.test` is stateful
 * with one — the same trap PASSWORD_TYPE's comment above documents.
 */
const BLOCK_LEVEL_TAG =
    /<\/?(?:p|div|li|ul|ol|dl|dt|dd|h[1-6]|br|tr|td|th|table|thead|tbody|section|article|figure|figcaption|blockquote|pre|summary|details|header|footer|main|aside|nav|form|label|option|select|button|title|desc|text|tspan|body|html|head|noscript)\b[^>]*>/gi;

/**
 * What the guide says ON SCREEN.
 *
 * COMMENTS COME OUT, and that is a deliberate direction. Every assertion built on
 * this is about a claim made to the READER; an HTML comment is not read by
 * anybody, so a `<!-- … -->` discussing the old wording must stay legal — the
 * same reason codeLines() drops `//` lines before the copy matchers run over the
 * tab. `<script>` and `<style>` bodies go for the same reason and one stronger:
 * they are 23 KB of CSS and JS that no reader sees, and leaving them in would let
 * a selector name or a string literal answer a question about prose.
 *
 * SVG `<title>`, `<desc>` and `<text>` STAY IN. They are the wireframes' labels
 * and their accessible descriptions — a screen-reader user is read them verbatim,
 * so a contradiction hidden in a `<desc>` is a contradiction that shipped.
 */
function visibleTextOf(html: string): string {
    return decodeEntities(
        html
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(BLOCK_LEVEL_TAG, ". ")
            .replace(/<[^>]*>/g, " ")
    );
}

/**
 * One statement per sentence, with the source's own line wrapping undone first.
 *
 * The collapse is the load-bearing half. The tab's paragraph is JSX hard-wrapped
 * at 100 columns, so "…at Settings > Plugins > ChannelTranslator > the cog, so a
 * value entered in either place shows up in the other." is four source lines. A
 * per-line scan would look for the contradiction in fragments that cannot contain
 * it, and would report a clean file for a paragraph that says the opposite of
 * what it should — the exact failure mode cogDescription()'s comment describes
 * for the concatenated cog copy.
 */
function statementsOf(text: string): string[] {
    return text
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map(statement => statement.trim())
        .filter(Boolean);
}

let cachedGuideText: string | null = null;

/** The guide's on-screen text. Read and flattened once — the file is ~340 KB. */
function guideText(): string {
    if (cachedGuideText === null) cachedGuideText = visibleTextOf(read(GUIDE));
    return cachedGuideText;
}

/**
 * A reference to a DIFFERENT box than the one this sentence is about.
 *
 * Half of the conjunction. On its own it is ordinary and correct copy — all three
 * surfaces are SUPPOSED to point at each other, because the value is shared and a
 * user who cannot find the other box will paste it twice.
 */
const OTHER_SURFACE: Array<{ label: string; pattern: RegExp; }> = [
    { label: "the cog", pattern: /\bcog\b/i },
    { label: "\"that one\"", pattern: /\bthat one\b/i },
    { label: "\"that box\"", pattern: /\bthat (?:box|field)\b/i },
    { label: "\"the other …\"", pattern: /\bthe other (?:box|one|field|screen|place|settings|tab)\b/i },
    { label: "the plugin's own settings", pattern: /\bplugin(?:'s|’s)?(?: own)? settings\b/i },
    { label: "the settings tab", pattern: /\bsettings tab\b/i },
    { label: "ChannelTranslator", pattern: /\bChannelTranslator\b/i },
    { label: "Settings → Discord Translator", pattern: /\bSettings\s*(?:→|->|>)\s*Discord Translator\b/i }
];

/**
 * A claim that one of the two accepted forms is NOT accepted.
 *
 * The other half. Also ordinary on its own — "a Workspace account has to paste
 * the whole URL" is true, and so is "if you took the Deployment ID rather than
 * the URL". Neither is about a box.
 *
 * TOGETHER they are the defect: a sentence that names another box AND says a form
 * is refused is a sentence asserting that the other box accepts less than this
 * one. Since 2026-08 there is exactly one authority — checkDeploymentUrl() in
 * core/providers/appsScript.ts — and both settings boxes delegate to it, so that
 * assertion cannot be true of any of them. It can only be stale.
 *
 * PINNED AS A CLASS, NOT AS A STRING, and that is not fastidiousness. A
 * `not.toContain("that one still wants the whole URL")` would be satisfied by
 * rewording the same lie, which is precisely what a copy edit does.
 */
const NARROWER_THAN_HERE: Array<{ label: string; pattern: RegExp; }> = [
    {
        label: "one form \"rather than\" the other",
        pattern: /\b(?:rather than|instead of|and not|but not|not)\s+(?:just\s+|only\s+)?(?:the|a|an)\s+(?:bare\s+|short\s+|whole\s+|full\s+|entire\s+|Deployment\s+|Web\s*[- ]?app\s+)*(?:ID|URL)\b/i
    },
    {
        label: "it takes ONLY one form",
        pattern: /\b(?:only\s+(?:accepts?|takes?|wants?|allows?|understands?|works with)|(?:accepts?|takes?|wants?|allows?|understands?)\s+only)\b/i
    },
    {
        label: "it refuses a form",
        pattern: /\b(?:will not|will only|won'?t|does not|doesn'?t|cannot|can'?t)\s+(?:accept|take|use|handle|expand|understand)\b/i
    },
    {
        label: "it demands the whole thing",
        pattern: /\b(?:wants?|needs?|requires?|expects?|must have|must be|has to be|still needs?)\s+(?:the\s+)?(?:whole|full|entire|complete)\b/i
    }
];

/**
 * Every statement in `text` that says another box accepts less than this one.
 *
 * Returns the offending statements, not a boolean, so the failure message names
 * the sentence to delete instead of leaving the reader to find it in 340 KB.
 */
function crossSurfaceRestrictionClaims(text: string): string[] {
    return statementsOf(text).flatMap(statement => {
        if (!OTHER_SURFACE.some(surface => surface.pattern.test(statement))) return [];
        const narrowings = NARROWER_THAN_HERE.filter(claim => claim.pattern.test(statement));
        if (narrowings.length === 0) return [];
        return [`[${narrowings.map(claim => claim.label).join(" + ")}] ${statement}`];
    });
}

/** The two forms, by name, and the shape of the longer one. */
const NAMES_THE_ID = /\bDeployment\s+ID\b/i;
const NAMES_THE_URL = /\bWeb\s*[- ]?App\s+URL\b/i;
const NAMES_THE_URL_SHAPE = /script\.google\.com\/macros\/s\//i;

/**
 * Wordings that tell the reader BOTH forms are allowed.
 *
 * Naming the two values is not the same as saying either will do — a page can
 * name the ID in step 6 and the URL in step 7 and still leave the reader
 * believing the box takes one of them. This is the sentence that does the work,
 * and the surface that loses it has drifted even though both nouns survive.
 */
const ACCEPTS_EITHER_FORM: Array<{ label: string; pattern: RegExp; }> = [
    { label: "takes/accepts either", pattern: /\b(?:takes?|accepts?|allows?|reads?|handles?)\s+(?:either|whichever|both)\b/i },
    { label: "\"either form/one\"", pattern: /\beither\s+(?:form|one|of (?:the two forms|them))\b/i },
    { label: "\"both forms\"", pattern: /\bboth\s+(?:forms?|values?|boxes)\b/i }
];

function acceptsEitherFormIn(text: string): string[] {
    return ACCEPTS_EITHER_FORM.filter(c => c.pattern.test(text)).map(c => c.label);
}

/**
 * The three places this one credential is described, and the on-screen text of
 * each.
 *
 * The guide is HTML and the other two are source, so each carries its own
 * extractor — but every one of them yields RENDERED COPY with comments removed,
 * because a guard about what the user is told must not be answerable by a
 * comment explaining what the user used to be told.
 */
const CREDENTIAL_SURFACES: Array<{ label: string; path: string; visible: () => string; }> = [
    {
        label: "the setup guide (site/free/index.html)",
        path: GUIDE,
        visible: guideText
    },
    {
        label: "the plugin cog's appsScriptUrl description",
        path: PLUGIN_SETTINGS,
        visible: () => decodeEntities(cogDescription(read(PLUGIN_SETTINGS)))
    },
    {
        label: "the client settings tab's Apps Script row",
        path: TAB,
        visible: () => decodeEntities(codeOf(section(read(TAB))))
    }
];

/**
 * Surfaces excused from "say that EITHER form is accepted", by path.
 *
 * ONE ENTRY, AND THE TEST BESIDE THE ASSERTION PINS THAT IT STAYS ONE. See the
 * describe at the end of this file for what the settings tab lost and why the
 * excuse is written down here rather than applied by deleting an assertion.
 */
const SILENT_ON_EITHER_FORM = new Set<string>([TAB]);

/**
 * THE SENTENCE THAT SHIPPED, restored verbatim as its own tiny document.
 *
 * Kept here as a fixture so the guard has a permanent positive control: the exact
 * markup that was live in site/free/index.html, at the moment the cog stopped
 * being stricter and nobody went back to the guide. Every assertion in the final
 * describe is run against this as well as against the real file, so "the real
 * file is clean" can never be reported by a matcher that stopped matching.
 */
const SHIPPED_CONTRADICTION =
    "<p class=\"note\">The plugin cog has a box for the same value, and that one still wants " +
    "the whole URL ending in <code>/exec</code> rather than the ID. Whichever box you fill in, " +
    "the other shows what you saved.</p>";

// ---------------------------------------------------------------------------

describe("instrument checks — the scan is measuring the thing it names", () => {
    it("every file it reads exists and is not empty", () => {
        for (const file of [TAB, TAB_CSS, PLUGIN_SETTINGS, PLUGIN_STATE, REGISTRY, APPS_SCRIPT, HEADING_CSS, BASE_TEXT, GUIDE]) {
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

    // -- the guide, and the three-surface matchers ---------------------------

    it("the guide it reads is the shipped guide, and it is the Apps Script one", () => {
        // GUIDE is the only path in this file that leaves src/. If it ever points
        // at a stub, a template or the wrong page, every assertion built on it
        // passes for the wrong reason — and does so quietly, because an empty
        // string contains no contradiction either.
        const html = read(GUIDE);
        expect(html.slice(0, 200).toLowerCase()).toContain("<!doctype html>");
        expect(html, "not the Apps Script guide").toContain("script.google.com");
        expect(html.length, "the guide shrank to a stub").toBeGreaterThan(100_000);
        expect(guideText().length, "nothing survived the markup strip").toBeGreaterThan(10_000);
    });

    it("visibleTextOf() keeps rendered copy and drops comments, script and style (controls)", () => {
        // THE COMMENT CARRIES A `>` ON PURPOSE, and it took a surviving mutant to
        // notice. Without one, `<[^>]*>` swallows the whole `<!-- … -->` by
        // itself, so deleting the comment rule changes nothing and this control
        // cannot tell. With a `>` inside, the generic tag strip stops at
        // "Settings >" and the remainder of the comment leaks into the prose scan
        // — which is the case that matters, and the one an editorial note like
        // "Settings > Plugins" hits first. The shipped guide has 15 comments and
        // none of them currently contains a `>`, so today the explicit rule is
        // defence in depth rather than a live leak.
        const sample =
            "<style>.note::after { content: \"the cog only takes the URL\"; }</style>" +
            "<script>const hint = \"that box wants the whole URL\";</script>" +
            "<!-- Settings > Plugins: the cog only takes the whole URL rather than the ID -->" +
            "<p>Paste the <strong>Deployment ID</strong> &mdash; either form is fine.</p>";
        // Collapsed, because that is what the matchers are handed: an inline
        // <strong> leaves two spaces behind and statementsOf() is what closes
        // them up. Asserting on the un-collapsed form would be testing a stage
        // nothing reads.
        const visible = statementsOf(visibleTextOf(sample)).join(" ");
        expect(visible, "a <style> body reached the prose scan").not.toContain("content:");
        expect(visible, "a <script> body reached the prose scan").not.toContain("const hint");
        expect(visible, "an HTML comment reached the prose scan").not.toContain("rather than the ID");
        expect(visible, "the rendered sentence was lost").toContain("Paste the Deployment ID");
        expect(visible, "&mdash; was left undecoded").toContain("—");
        // The negative half of the comment rule: the SAME words, rendered, must
        // survive. Without this, "drops comments" is satisfied by dropping
        // everything.
        expect(
            statementsOf(visibleTextOf("<p>the cog only takes the whole URL rather than the ID</p>")).join(" ")
        ).toContain("rather than the ID");
    });

    it("visibleTextOf() ends a statement at a block boundary (negative control)", () => {
        // Two unrelated blocks must not fuse into one sentence. If they did, any
        // heading naming the cog would combine with any later paragraph mentioning
        // a full URL and the conjunction would fire on a claim nobody made.
        // Both halves of the conjunction are present, one per block. Fused they
        // would read as a contradiction; separate they are two true statements.
        const twoBlocks = "<h2>In Settings &rarr; Plugins &rarr; ChannelTranslator &rarr; the cog</h2>"
            + "<p>A Google Workspace account needs the whole URL.</p>";
        const statements = statementsOf(visibleTextOf(twoBlocks));
        expect(statements.length).toBeGreaterThan(1);
        expect(
            statements.some(s => /\bcog\b/.test(s) && /needs the whole/.test(s)),
            "the two blocks fused into one statement — the boundary rule is not working"
        ).toBe(false);
        expect(crossSurfaceRestrictionClaims(visibleTextOf(twoBlocks))).toEqual([]);
        // …and the positive half: the SAME two halves inside ONE block are one
        // statement, and are caught. Without this the assertion above is satisfied
        // by a matcher that never fires at all.
        const oneBlock = "<p>In Settings &rarr; Plugins &rarr; ChannelTranslator &rarr; the cog, "
            + "a Google Workspace account needs the whole URL.</p>";
        expect(crossSurfaceRestrictionClaims(visibleTextOf(oneBlock))).toHaveLength(1);
    });

    it("statementsOf() reassembles copy the source hard-wraps (positive control)", () => {
        /*
         * THE CONTROL MOVED, and the file it points at is why.
         *
         * It used to ride on the row's body paragraph — "…the translator plugin's
         * own settings, at Settings > Plugins > ChannelTranslator > the cog…" —
         * which was four source lines long. That paragraph was deleted whole on
         * operator instruction (2026-08-29), and this test's own escape hatch
         * said what to do about it: "pick another control".
         *
         * This is the replacement, chosen for the same property and read out of
         * the tab rather than restated: the "changed somewhere else" warning is
         * still hard-wrapped, and its first sentence still spans two source lines.
         */
        const wrapped = codeOf(section(read(TAB)));
        const lines = wrapped.split("\n");
        const HEAD = "plugin's own settings";
        const TAIL = "unsaved edits here";
        expect(
            lines.some(line => line.includes(HEAD)),
            "the tab no longer carries this sentence — pick another control"
        ).toBe(true);
        expect(
            lines.some(line => line.includes(HEAD) && line.includes(TAIL)),
            "the sentence now fits on one line — this control no longer proves anything, so "
            + "either pick a longer one or drop it"
        ).toBe(false);
        expect(
            statementsOf(decodeEntities(wrapped)).some(s =>
                s.includes(HEAD) && s.includes(TAIL)),
            "the wrapped sentence was never rejoined — the scan is reading fragments"
        ).toBe(true);
    });

    it("the restriction matcher fires on the sentence that actually shipped (positive control)", () => {
        // THE DEFECT, verbatim. Both halves of the conjunction are asserted by
        // name, so a future edit that keeps the test green by gutting one of the
        // two lists fails here instead.
        const claims = crossSurfaceRestrictionClaims(visibleTextOf(SHIPPED_CONTRADICTION));
        expect(claims, "the guard cannot see the defect it was written for").toHaveLength(1);
        expect(claims[0]).toContain("rather than");
        expect(claims[0]).toContain("that one still wants the whole URL ending in /exec");
        expect(claims[0]).toContain("one form \"rather than\" the other");
        expect(claims[0]).toContain("it demands the whole thing");
    });

    it("the restriction matcher fires on the other shapes the same lie can take (positive control)", () => {
        for (const reworded of [
            "The plugin cog has a box for the same value, but that one only accepts the whole Web App URL.",
            "The other box will not accept a bare Deployment ID.",
            "In the translator plugin's own settings the same field needs the full URL.",
            "That box takes only the URL, not the ID."
        ]) {
            expect(
                crossSurfaceRestrictionClaims(reworded),
                `reworded contradiction slipped through: ${reworded}`
            ).toHaveLength(1);
        }
    });

    it("the restriction matcher abstains on the TRUE sentences (negative control)", () => {
        // Every one of these is live copy today, and every one carries HALF the
        // conjunction. If the matcher cannot tell them from the defect it will be
        // deleted by the first author it obstructs, and then it guards nothing.
        for (const trueSentence of [
            // names another box, claims no restriction
            "The plugin cog has a box for the same value, and it takes either form too — both " +
            "boxes ask the same question of the same checker.",
            "This is the same setting as the Apps Script URL in the translator plugin's own " +
            "settings, at Settings > Plugins > ChannelTranslator > the cog, so a value entered " +
            "in either place shows up in the other.",
            // claims a restriction, about a form or an account — not about a box
            "If you took the Deployment ID in step 6 rather than the URL, the address is " +
            "https://script.google.com/macros/s/ followed by that ID and then /exec.",
            "A Google Workspace account must use the whole URL either way, because its address " +
            "carries the organisation's domain.",
            "So an endpoint that requires any Google sign-in is an endpoint the plugin cannot " +
            "use, however valid the account."
        ]) {
            expect(
                crossSurfaceRestrictionClaims(trueSentence),
                `true sentence flagged as a contradiction: ${trueSentence}`
            ).toEqual([]);
        }
    });

    it("the both-forms matchers fire on copy that names both, and abstain on copy that names one "
        + "(controls)", () => {
        const both = "Paste the Deployment ID or the whole Web App URL, of the form " +
            "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec — the box takes either.";
        expect(NAMES_THE_ID.test(both)).toBe(true);
        expect(NAMES_THE_URL.test(both)).toBe(true);
        expect(NAMES_THE_URL_SHAPE.test(both)).toBe(true);
        expect(acceptsEitherFormIn(both)).toContain("takes/accepts either");

        const urlOnly = "The Web App URL of the Apps Script proxy, of the form " +
            "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec.";
        expect(NAMES_THE_ID.test(urlOnly), "the ID matcher fires on copy with no ID in it")
            .toBe(false);
        expect(acceptsEitherFormIn(urlOnly)).toEqual([]);

        const idOnly = "Press the Copy button on the Deployment ID row and paste it here.";
        expect(NAMES_THE_URL.test(idOnly), "the URL matcher fires on copy with no URL in it")
            .toBe(false);
        expect(acceptsEitherFormIn(idOnly)).toEqual([]);

        // Naming both nouns is NOT the same as saying either is accepted, and this
        // is the case that separates them.
        const namesBothSaysNeither = "Google's Deploy dialog shows a Deployment ID and a Web " +
            "App URL.";
        expect(NAMES_THE_ID.test(namesBothSaysNeither)).toBe(true);
        expect(NAMES_THE_URL.test(namesBothSaysNeither)).toBe(true);
        expect(acceptsEitherFormIn(namesBothSaysNeither)).toEqual([]);
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

    /**
     * 🔴 THE HEADING NO LONGER NAMES THE PROVIDER, AND THIS ASSERTION IS THE
     * RECORD OF WHAT THAT COST.
     *
     * It used to read "Apps Script proxy — the free option, deployed to your own
     * Google account", and this test required all three of those things: the
     * provider by name, the word "free", and NOT "API Key" — because the row had
     * just been repointed off the paid Google Cloud key, and a heading naming a
     * credential it does not edit is how a user's Cloud key ends up in the free
     * proxy's box.
     *
     * Operator instruction 2026-08-29: the heading is now exactly "Setup Google
     * Key". So two of the three properties are gone by decision:
     *
     *   - the provider is no longer named on the heading;
     *   - "free" is no longer said anywhere in the section at all.
     *
     * And the third is now uncomfortable rather than satisfied: the row still
     * does NOT edit a key — it edits an Apps Script deployment URL — while the
     * heading now contains the word "Key". `not.toContain("API Key")` still
     * passes on the literal string, which is the assertion, but the confusion it
     * was written against is closer than it was. That is a copy decision, not a
     * test failure, and it is recorded here rather than argued.
     *
     * WHAT IS STILL PINNED: the exact operator-specified text, so a later "clean
     * up" cannot drift it, and the paid key's old heading staying gone. The text
     * is now read out of the SETTINGS_HEADING constant rather than out of the
     * JSX, and the JSX is separately required to render that constant — the same
     * two-part shape this file already uses for SETUP_GUIDE_LABEL, and for the
     * same reason: one string, checked once, used everywhere it is claimed.
     */
    it("the heading is exactly the text the operator specified", () => {
        const heading = stringConst(read(TAB), "SETTINGS_HEADING");
        expect(heading).toBe("Setup Google Key");
        expect(heading, "the paid key's old heading is back").not.toContain("API Key");
        expect(
            heading,
            "the heading names the paid Cloud product — this row edits appsScriptUrl"
        ).not.toContain("Google Cloud");
    });

    it("that constant is what the heading actually renders", () => {
        // Without this the assertion above is about a constant nothing uses, and
        // the visible heading could say anything at all.
        expect(headingRow(section(read(TAB)))).toContain("{SETTINGS_HEADING}");
    });

    /**
     * 🔴 THE SCREEN READER IS TOLD THE SAME NAME THE SIGHTED USER READS.
     *
     * THIS TEST REPLACES ONE THAT REQUIRED THE OPPOSITE, and the replacement is
     * the point rather than a casualty of it. The old assertion was "the
     * provider is still named somewhere a screen reader will reach it": when the
     * heading stopped saying "Apps Script proxy", the input's `aria-label` was
     * the last rendered string that did, so it was pinned as the consolation.
     *
     * That made the defect permanent. A sighted user read "Setup Google Key" and
     * a screen-reader user was told "Apps Script proxy" — two names for one
     * control, one of them naming a section this build does not have — and the
     * suite REQUIRED the second one to stay. An accessible name is not a place
     * to keep copy that was cut from the screen; it is the name of the thing,
     * for the people who cannot see the heading.
     *
     * WHAT IS PINNED INSTEAD, and it is strictly stronger: the accessible name
     * is DERIVED from the heading, so the two cannot disagree by construction,
     * and it still has to say which values the box takes — the concern that
     * assertion was originally written for, which was never about the provider's
     * name at all.
     */
    it("the input's accessible name is the heading's own words, not a second name", () => {
        const tab = read(TAB);
        const heading = stringConst(tab, "SETTINGS_HEADING");
        const label = templateConst(tab, "ENDPOINT_INPUT_LABEL");

        expect(
            label,
            "the accessible name no longer starts with the heading a sighted user reads — " +
            "one control, two names, and the screen-reader user gets the one nobody can see"
        ).toContain(heading);
        // The half the old assertion was really protecting: the box takes either
        // form, and an accessible name that says "URL" alone tells a
        // screen-reader user the shorter one is refused here.
        expect(label).toContain("Deployment ID");
        expect(label).toContain("Web App URL");

        // Built from the constant, not spelled twice — a second literal is what
        // drifted last time.
        expect(
            codeOf(section(tab)),
            "the input stopped rendering ENDPOINT_INPUT_LABEL, so nothing ties its accessible " +
            "name to the heading any more"
        ).toContain("aria-label={ENDPOINT_INPUT_LABEL}");
        expect(
            tab,
            "the accessible name is a literal again instead of being derived from the heading"
        ).toContain("const ENDPOINT_INPUT_LABEL = `${SETTINGS_HEADING}");

        // And the retired section name is gone from everything this screen
        // renders, accessible names included — the direction the old assertion
        // had inverted.
        expect(
            codeOf(section(tab)),
            "the row renders the retired section name \"Apps Script proxy\" again"
        ).not.toContain("Apps Script proxy");
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

    /**
     * 🔴 INVERTED 2026-08-29. THE TRUE SENTENCES WERE DELETED FROM THIS ROW.
     *
     * This used to require the section to SAY the true thing — "no API key and no
     * card", "about 5,000 translation calls a day", "no billing at all" — on the
     * reasoning that a guard which only forbids a false claim is satisfied by
     * copy that says nothing, and a reader who is told nothing about cost assumes
     * the worst about a Google service.
     *
     * The paragraph carrying all three was deleted on operator instruction. So
     * the positive half cannot be asserted here any more without pinning copy the
     * operator removed. What replaces it:
     *
     *   - the ABSENCE direction, unchanged and still meaningful (above);
     *   - the same true sentences, asserted on the surface that DOES still carry
     *     them. The information was removed from this screen, not from the
     *     product, and this is what says so — if the cog's description loses it
     *     too, the claim "the user can still find this out" becomes false and
     *     this goes red.
     *
     * 🔴 WHAT IS NOW UNGUARDED: nothing requires this ROW to mention cost at all.
     * A future edit could add a false cost claim in a sentence with no "bill",
     * "card" or currency in it, and MONEY_CLAIMS above would abstain.
     */
    it("the true thing is still said where the user can still read it", () => {
        const row = codeOf(section(read(TAB)));
        // WHAT SURVIVED ON THIS ROW, and it is worth being precise about: the
        // muted paragraph under the input still names the daily allowance, in
        // the course of explaining what pressing Save spends. So the row is not
        // silent about the free tier — it just no longer says there is no key,
        // no card and no billing.
        expect(
            row,
            "the row stopped naming the daily allowance too — now nothing on this screen " +
            "says anything at all about what this costs"
        ).toMatch(/5,000/);
        expect(
            row,
            "a no-key / no-card / no-billing sentence is back on the row — good, but then " +
            "assert its wording here rather than leaving it to MONEY_CLAIMS, which only " +
            "catches the FALSE shapes"
        ).not.toMatch(/no billing|no API key/);

        const cog = cogDescription(read(PLUGIN_SETTINGS));
        expect(cog, "the cog stopped saying there is no billing").toContain("no billing at all");
        expect(cog, "the cog stopped saying there is no key and no card")
            .toContain("no API key and no card");
        expect(cog, "the cog stopped naming the daily allowance").toMatch(/5,000/);
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

    it("still tells the user the other box exists (negative control, weakened)", () => {
        /*
         * 🔴 WEAKENED 2026-08-29, and the weakening is the point of this comment.
         *
         * This required the section to contain "ChannelTranslator" — the menu
         * path, "Settings > Plugins > ChannelTranslator > the cog", so a user
         * looking at one box could find the other one holding the same value.
         * That sentence was in the deleted paragraph, and the path is now said
         * NOWHERE on this screen.
         *
         * What survives is the "changed somewhere else" warning, which names the
         * plugin's own settings but appears only in the one case where the value
         * moved underneath an unsaved edit. So the pointer still exists in code
         * and is invisible to a user who never hits that case.
         *
         * Kept rather than deleted because the original reasoning still holds:
         * without SOME control here, the assertions above are satisfied by
         * deleting every remaining word in the section.
         */
        const src = codeOf(section(read(TAB)));
        expect(
            src,
            "nothing in the section refers to the plugin's own settings any more — the two " +
            "boxes holding one value no longer acknowledge each other at all"
        ).toContain("plugin's own settings");
        expect(
            src,
            "the menu path came back — good, but then re-tighten this control to it"
        ).not.toContain("ChannelTranslator");
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
    it("the rendered copy still names the Deployment ID, though it no longer asks for it", () => {
        /*
         * 🔴 WEAKENED 2026-08-29. The instruction went; the noun stayed.
         *
         * This required the words "Paste the Deployment ID" — an instruction, in
         * body copy, telling the reader the shorter form is the one to take. It
         * was in the deleted paragraph. What is left is the placeholder and the
         * two accessible names, which NAME the form without ever telling anyone
         * to prefer it — and a placeholder disappears the moment the box has text
         * in it.
         *
         * The original reasoning — "a capability nobody is told about is not a
         * feature" — is now only half served. That is a copy decision rather than
         * a defect in the code, and it is recorded rather than argued.
         */
        const src = codeOf(section(read(TAB)));
        expect(
            src,
            "nothing rendered names the Deployment ID at all — the shorter form is now " +
            "accepted in complete silence"
        ).toContain("Deployment ID");
    });

    it("and the Web App URL is still offered, not replaced (negative control)", () => {
        // Without this, the assertion above is satisfied by copy that tells the
        // user the ID is now the ONLY accepted form. It is not: every stored URL
        // still works, and a Workspace account cannot use an ID at all.
        //
        // "or the whole Web App URL" was the phrase asserted here until the body
        // paragraph was deleted (2026-08-29). The placeholder and the accessible
        // names still carry both the noun and the shape, which is what these two
        // now read.
        const src = codeOf(section(read(TAB)));
        expect(src).toContain("Web App URL");
        expect(src).toContain("https://script.google.com/macros/s/");
    });

    /**
     * 🔴 THE WORKSPACE CAVEAT IS GONE FROM THIS SCREEN. THIS IS THE RECORD.
     *
     * The assertion above used to end with `.toContain("Workspace")`, on the
     * reasoning that a Google Workspace account CANNOT use a Deployment ID at all
     * — its Web App address carries the organisation's domain, which cannot be
     * rebuilt from the ID — so a screen that shows the ID form first and never
     * mentions the exception leaves those users following an instruction that
     * cannot work for them.
     *
     * That sentence was in the paragraph deleted on operator instruction
     * 2026-08-29. It is asserted here on the two surfaces that still carry it, so
     * "a Workspace user can find out" stays a checked claim rather than a hope —
     * but note what that means in practice: they have to open the cog or the
     * setup guide to learn it, having already been shown the wrong form on the
     * screen they were standing on.
     */
    it("a Workspace user is still told somewhere — just no longer here", () => {
        expect(
            codeOf(section(read(TAB))),
            "the caveat came back to the tab — good; re-tighten the assertion above to it"
        ).not.toContain("Workspace");
        expect(
            cogDescription(read(PLUGIN_SETTINGS)),
            "the cog lost the Workspace caveat too — no surface a user of this row is likely " +
            "to open now tells them the ID form cannot work for their account"
        ).toContain("Workspace");
        expect(guideText(), "the setup guide lost the Workspace caveat as well").toContain("Workspace");
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
        //
        // The input's name is RESOLVED rather than matched as a source string:
        // it is a template over the section's heading now, so the literal this
        // used to pin no longer exists in the file. See the describe above for
        // why it is derived, and templateConst() for why resolving it is what
        // keeps this assertion about the sentence the user hears.
        const tab = read(TAB);
        const src = codeOf(section(tab));
        const inputLabel = templateConst(tab, "ENDPOINT_INPUT_LABEL");
        expect(inputLabel).toContain("Deployment ID");
        expect(inputLabel).toContain("Web App URL");
        expect(src).toContain("aria-label={ENDPOINT_INPUT_LABEL}");
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
        expect(OLD_BODY).not.toContain("aria-label={ENDPOINT_INPUT_LABEL}");

        const OLD_INPUT = '<TextInput placeholder="https://script.google.com/macros/s/…/exec" />';
        const oldPh = placeholderOf(OLD_INPUT);
        expect(oldPh).not.toContain("Deployment ID");
        expect(oldPh.indexOf("AKfycb")).toBe(-1);
    });
});

/**
 * 🔴 THREE SURFACES DESCRIBE ONE BOX. NONE OF THEM MAY MAKE ANOTHER SOUND STRICTER.
 *
 * WHAT SHIPPED, AND HOW. The credential is described in three places — the
 * bundled setup guide (site/free/index.html), the plugin cog's `appsScriptUrl`
 * description, and this row. For a while they genuinely disagreed: this row took
 * a bare Deployment ID and the cog ran a second parser of its own that refused
 * one. The guide said so, correctly and helpfully:
 *
 *     "The plugin cog has a box for the same value, and that one still wants the
 *      whole URL ending in /exec rather than the ID."
 *
 * Then appsScriptUrlProblem() was rewritten to delegate to checkDeploymentUrl(),
 * the second parser went, and the two boxes started agreeing by construction. The
 * sentence above became FALSE at that moment — and stayed shipped, because it
 * lives in a 340 KB HTML file that nothing in this suite read. It was caught by an
 * adversarial reviewer after the change was committed.
 *
 * WHY A CLASS AND NOT A STRING. The sentence has already been fixed; pinning its
 * absence would guard against re-pasting one specific paragraph and nothing else.
 * What has to be forbidden is the SHAPE: a sentence that names another box and
 * asserts a form is refused. That claim was true once and can never be true again
 * while one validator answers for every surface, so the matcher is allowed to be
 * absolute about it.
 *
 * WHY IT ALSO CHECKS THE OTHER DIRECTION. A guard that only forbids sentences is
 * satisfied by deleting the copy, and a surface that says nothing about the two
 * forms has drifted just as far as one that lies about them — the reader simply
 * never learns the shorter form exists. So each surface must also NAME both forms
 * and SAY that either is accepted.
 *
 * WHAT THIS DOES NOT DO. It does not check that the two forms are actually
 * accepted — that is behaviour, it belongs to the code, and it is pinned by
 * test/settingsValidatorDelegation.test.ts (which calls both validators over a
 * table) and by the appsScript.ts assertions earlier in this file. This describe
 * is only about the three descriptions agreeing with each other.
 */
describe("three surfaces, one credential box: none of them may claim another takes less", () => {
    it("the one authority really is one authority — both settings boxes route to it", () => {
        // The premise. If the cog ever grows a parser of its own again, the
        // sentence this guard forbids could become TRUE, and forbidding a true
        // sentence is how a guard turns into a liability. Read out of the code, so
        // that day fails here with a reason rather than somewhere confusing.
        expect(read(APPS_SCRIPT), "checkDeploymentUrl() is gone — nothing arbitrates the forms")
            .toContain("export function checkDeploymentUrl(");
        expect(
            read(PLUGIN_SETTINGS),
            "the cog's validator stopped delegating to checkDeploymentUrl() — the surfaces can " +
            "disagree again, and the copy rule below may no longer be safe to enforce"
        ).toContain("const shape = checkDeploymentUrl(trimmed);");
        expect(
            read(PLUGIN_STATE),
            "the settings tab's validator stopped delegating to checkDeploymentUrl()"
        ).toContain("const shape = checkDeploymentUrl(trimmed);");
    });

    it("all three surfaces are in the scan — dropping one is a pass by omission", () => {
        // Every assertion below is a `for` over CREDENTIAL_SURFACES, so deleting an
        // entry turns each of them green without changing a word of the copy. This
        // is the assertion that notices, and it is the same guard
        // test/no-module-scope-settings.test.ts keeps over its own file list.
        expect(CREDENTIAL_SURFACES.map(surface => surface.path)).toEqual([GUIDE, PLUGIN_SETTINGS, TAB]);
        for (const surface of CREDENTIAL_SURFACES) {
            expect(existsSync(surface.path), `not found: ${surface.path}`).toBe(true);
        }
    });

    it("no surface says another box takes less than it does", () => {
        for (const surface of CREDENTIAL_SURFACES) {
            const claims = crossSurfaceRestrictionClaims(surface.visible());
            expect(
                claims,
                `${surface.label} tells the reader that another box accepts less than this one. ` +
                "There is one validator — checkDeploymentUrl() — and every box delegates to it, " +
                "so no box is stricter than any other and this sentence cannot be true:\n  " +
                claims.join("\n  ") +
                `\nFile: ${surface.path}`
            ).toEqual([]);
        }
    });

    it("…and that is not a matcher that stopped matching (positive control)", () => {
        // The instrument, re-run at the point of use. If the assertion above ever
        // passes because the scan lost its way into the file — a renamed section,
        // an extractor throwing on a shape it did not expect — this fails beside
        // it and says so.
        expect(
            crossSurfaceRestrictionClaims(visibleTextOf(SHIPPED_CONTRADICTION)),
            "the guard no longer recognises the exact sentence it exists to catch"
        ).toHaveLength(1);
        for (const surface of CREDENTIAL_SURFACES) {
            const text = surface.visible();
            expect(text.length, `${surface.label}: the extractor returned nothing`)
                .toBeGreaterThan(400);
            expect(
                crossSurfaceRestrictionClaims(text + " " + visibleTextOf(SHIPPED_CONTRADICTION)),
                `${surface.label}: the scan cannot find the defect even when it is planted in it`
            ).toHaveLength(1);
        }
    });

    it("every surface names the Deployment ID form", () => {
        for (const surface of CREDENTIAL_SURFACES) {
            expect(
                NAMES_THE_ID.test(surface.visible()),
                `${surface.label} no longer names the Deployment ID. A reader of this surface ` +
                `will not learn the shorter form is accepted at all.\nFile: ${surface.path}`
            ).toBe(true);
        }
    });

    it("every surface names the Web App URL form, and shows its shape", () => {
        // The other direction, and the one an "improvement" breaks: the ID is
        // shorter and nicer, so copy drifts towards showing only that. Every
        // existing install holds a URL, and a Workspace account cannot use an ID
        // at all.
        for (const surface of CREDENTIAL_SURFACES) {
            const text = surface.visible();
            expect(
                NAMES_THE_URL.test(text),
                `${surface.label} no longer names the Web App URL form\nFile: ${surface.path}`
            ).toBe(true);
            expect(
                NAMES_THE_URL_SHAPE.test(text),
                `${surface.label} no longer shows what a Web App URL looks like\nFile: ${surface.path}`
            ).toBe(true);
        }
    });

    it("every surface says EITHER is accepted, not merely that both exist", () => {
        // Naming the two values is what Google's own Deploy dialog does. Saying
        // the box takes whichever you have is the sentence that makes the shorter
        // form usable, and it is the one a copy edit drops first.
        for (const surface of CREDENTIAL_SURFACES) {
            if (SILENT_ON_EITHER_FORM.has(surface.path)) continue;
            expect(
                acceptsEitherFormIn(surface.visible()),
                `${surface.label} names both forms but never says either will do\n` +
                `File: ${surface.path}`
            ).not.toEqual([]);
        }
    });

    it("the exemption is exactly one surface, and it is the one the operator emptied", () => {
        /*
         * 🔴 THE SETTINGS TAB STOPPED SAYING IT ON 2026-08-29, AND THIS IS THE
         * ONLY THING STANDING BETWEEN THAT AND A SILENT THREE-SURFACE DRIFT.
         *
         * The sentence lived in the row's body paragraph — "Both name the same
         * deployment… so the box shows the full URL once it has been checked" —
         * which was deleted whole on operator instruction. Nothing that survives
         * on that screen tells a reader that EITHER form will do: the placeholder
         * shows "AKfycb… (Deployment ID) or https://…/exec", which a reader can
         * just as easily take as "one of these two, and I had better pick right".
         *
         * WHY AN EXEMPTION LIST RATHER THAN DELETING THE ASSERTION OR DROPPING
         * THE SURFACE. The describe above already refuses the second option: it
         * asserts CREDENTIAL_SURFACES is exactly [GUIDE, PLUGIN_SETTINGS, TAB],
         * precisely so a surface cannot be quietly removed from the scan. The
         * same reasoning applies one level down — so the skip is named, it is
         * pinned to one path, and this test fails the moment a second surface
         * joins it. Two silent surfaces out of three is not a copy decision any
         * more, it is the drift the whole describe exists to catch.
         *
         * TO REVERT: put a sentence like "the box takes whichever you have" back
         * on the row and delete SILENT_ON_EITHER_FORM. Nothing else is needed.
         */
        expect([...SILENT_ON_EITHER_FORM]).toEqual([TAB]);
        for (const path of SILENT_ON_EITHER_FORM) {
            expect(
                CREDENTIAL_SURFACES.some(surface => surface.path === path),
                "the exemption names a path that is not in the scan at all"
            ).toBe(true);
        }
        // The exemption is not vacuous: the tab really does still fail the
        // assertion it is excused from. If this stops being true, the excuse has
        // outlived the copy change and must be deleted.
        const tab = CREDENTIAL_SURFACES.find(surface => surface.path === TAB)!;
        expect(
            acceptsEitherFormIn(tab.visible()),
            "the settings tab says it again — delete SILENT_ON_EITHER_FORM"
        ).toEqual([]);
    });

    it("M-REGRESS: the guard is red on the guide exactly as it shipped (positive control)", () => {
        // The whole point, run end to end on a real document rather than a
        // fragment: take the guide's own markup, put the false sentence back where
        // it was, and confirm the assertion that guards it fails.
        const asShipped = read(GUIDE).replace(
            /<p class="note">The plugin cog has a box for the same value,[^<]*(?:<[^>]*>[^<]*)*?<\/p>/,
            SHIPPED_CONTRADICTION
        );
        expect(
            asShipped,
            "the paragraph this guard is named after is no longer in the guide in any form — " +
            "the substitution above matched nothing, so this control is measuring nothing"
        ).toContain("that one still wants the whole URL");
        const claims = crossSurfaceRestrictionClaims(visibleTextOf(asShipped));
        expect(claims, "the shipped defect no longer trips the guard").toHaveLength(1);
        expect(claims[0]).toContain("rather than the ID");
        // …and the file on disk is NOT that. The negative half: if the real guide
        // ever contains it again, this is the assertion that says so.
        expect(guideText()).not.toContain("that one still wants the whole URL");
    });
});

describe("what the row kept from before", () => {
    it("the long-URL, no-autocomplete, no-spellcheck and label properties are all still there", () => {
        const src = section(read(TAB));
        expect(src, "a long deployment URL would be truncated at 999 characters")
            .toContain("maxLength={null}");
        expect(src).toContain('autoComplete="off"');
        expect(src).toContain("spellCheck={false}");
        // UPDATED TWICE, NEVER WEAKENED. Still a pin on the input's accessible
        // name. It first changed because the box began taking a Deployment ID as
        // well as a URL, and an aria-label saying "deployment URL" tells a
        // screen-reader user the shorter form is not allowed here. It changed
        // again because the name it carried — "Apps Script proxy …" — was not the
        // one on the heading a sighted user reads, so the control had two names.
        // The pin is now on the wiring, and the resolved text is asserted where
        // that describe can explain itself.
        expect(src).toContain("aria-label={ENDPOINT_INPUT_LABEL}");
        expect(templateConst(read(TAB), "ENDPOINT_INPUT_LABEL"))
            .toContain(stringConst(read(TAB), "SETTINGS_HEADING"));
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
