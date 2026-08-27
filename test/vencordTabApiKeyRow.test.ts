/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE DEFECT THIS FILE EXISTS TO PREVENT: TWO BOXES, TWO VALUES.
 *
 * The Discord Translator settings tab carries a row for one of the user's own
 * translation credentials. The plugin's own settings screen (Settings > Plugins
 * > ChannelTranslator > the cog) already had one for each of them. Those two
 * controls are only useful if they are two views of ONE stored value. If they
 * ever drift onto different keys they become the worst possible outcome — a user
 * pastes a credential into the row they found, the provider keeps reading the
 * other one, and nothing anywhere reports an error. It would be strictly better
 * not to have added the row at all.
 *
 * WHICH CREDENTIAL, AND WHY IT MOVED. The row used to bind to
 * `googleCloudApiKey`, the PAID Google Cloud Translation v2 key. It now binds to
 * `appsScriptUrl` — the FREE proxy a user deploys into their own Google account
 * — because the setup guide this screen links to is the Apps Script tutorial, so
 * the field and the link finally describe the same thing. Operator ruling: "the
 * row shall for 'Apps Script proxy', even our setup guide is dedicated for this
 * key." The paid key was not deleted; it stayed behind the plugin cog.
 *
 * THE CROSS-FILE CHECK IS UNCHANGED IN STRENGTH. It is the same assertion, aimed
 * at the ids the row actually names now: the credential it edits, and the
 * bookkeeping id Reset reads. Both must exist in the plugin's own definition.
 *
 * THIS FILE IS THE ONLY GUARD. That was not the plan and it is worth spelling
 * out, because the opposite is the obvious assumption. `DefinedSettings.use` is
 * declared
 * `use<F extends Extract<keyof Def, string>>(filter?: F[]): Pick<SettingsStore<Def>, F>`
 * in src/utils/types.ts, which reads as though a wrong id could not compile.
 * MEASURED: the tab's id was changed to "googleCloudApiKeyMUTANT" and
 * `node node_modules/typescript/bin/tsc --noEmit` exited 0. A type probe on the
 * plugin's exported `settings` shows `keyof typeof settings.def` resolving to
 * `string | number | symbol` and `typeof settings.store` to `any` — `Def` never
 * carries the literal keys, so nothing is checked. The same mutant turned two
 * assertions below red, which is the whole reason they exist.
 *
 * EVERYTHING HERE READS SOURCE TEXT rather than importing the modules. The tab
 * is TSX and both files resolve Vencord build aliases (@api/Settings,
 * @webpack/common, @plugins/*) that do not exist under vitest. Static reading is
 * the only way to assert on them from this suite at all — the same reason
 * test/settingsCopy.test.ts and test/no-module-scope-settings.test.ts read
 * source.
 *
 * THE ROW IS NOT MASKED, AND THE TEST THAT SAID IT WAS HAD ROTTED INTO A TRAP.
 * Operator ruling: "The API doesn't need to be masked." The reveal toggle, the
 * `revealed` state and the password input type were all removed; the input is a
 * declared `type="text"`. The assertion here that read
 * `expect(src).toContain('revealed ? "text" : "password"')` therefore asserted
 * the OPPOSITE of intended behaviour — and it went on passing, because it
 * scanned the whole file and the tab keeps a long comment explaining why that
 * expression must never come back. It was matching the EXPLANATION of the
 * defect, not the defect. Anyone tidying that comment would have turned this
 * file red with a message pointing at masking, which is not what they touched.
 *
 * SO EACH DIRECTION IS NOW CHOSEN DELIBERATELY, AND THE CHOICE IS THE POINT:
 *
 *   - A claim about what the CODE DOES is asserted against `codeOf(...)`, with
 *     comment lines stripped. An assertion that comment prose can satisfy is not
 *     a test — prose is free to quote any string, including the one you are
 *     scanning for, which is exactly how this file broke.
 *   - A claim that a DANGEROUS CONSTRUCT IS ABSENT is asserted against the whole
 *     file, comments included, and is matched on SHAPE rather than on a word. A
 *     password-typed input pasted into a comment today is one somebody
 *     uncomments tomorrow, so the comments are in scope; but the tab must stay
 *     free to say the words "password manager" and to quote what it used to do,
 *     so the matcher keys on `type=…password…` and not on "password".
 *
 * THE COMMENT-STRIPPER IS THIS SUITE'S EXISTING ONE, taken verbatim from
 * test/appsScriptRowSaveReset.test.ts (its `isCommentLine`/`codeLines`/`codeOf`,
 * around lines 61-81), which is itself the same definition already standing in
 * test/panelSettingsOverlap.test.ts, test/selectionPrivacy.test.ts and
 * test/stateGates.test.ts. It is copied rather than imported because NOTHING in
 * test/ exports anything — `grep -rn "^export " test/` returns nothing — and
 * importing a sibling *.test.ts would register that file's whole suite into this
 * run. Copying the established definition is how this suite already shares it.
 * Its controls are below, not assumed.
 */

const TAB_PATH = join(
    process.cwd(), "src", "components", "settings", "tabs", "vencord", "index.tsx"
);
const PLUGIN_SETTINGS_PATH = join(
    process.cwd(), "src", "plugins", "channelTranslator", "settings.ts"
);

/** The credential the row is for, and the only one it may edit. */
const ROW_SETTING_ID = "appsScriptUrl";

/**
 * The bookkeeping id the row also names: Reset restores from it, and Save writes
 * it. `hidden: true` in the plugin, so it renders no second box in the cog — but
 * it is a real setting id and is held to exactly the same existence check as the
 * credential above.
 */
const LAST_GOOD_SETTING_ID = "lastGoodAppsScriptUrl";

/** Every id the row is allowed to subscribe to, in the order the tab lists them. */
const SUBSCRIBED_IDS = [ROW_SETTING_ID, LAST_GOOD_SETTING_ID];

/**
 * The two credentials this row must NOT edit.
 *
 * They used to be the other two settings in the same plugin — the DeepL and
 * Google Cloud API keys, both billed to the user's own account. Both have since
 * been DELETED from settings.ts along with the providers that read them, so the
 * assertion below has changed meaning rather than lost it: subscribing to one of
 * these is no longer "editing the wrong credential from this row", it is
 * subscribing to a setting that does not exist at all — which the shared store
 * would answer with undefined rather than an error.
 */
const OTHER_CREDENTIAL_IDS = ["deeplApiKey", "googleCloudApiKey"];

function read(path: string): string {
    return readFileSync(path, "utf8");
}

/**
 * A whole-line comment. Verbatim from test/appsScriptRowSaveReset.test.ts — see
 * the header for why it is copied rather than imported.
 */
function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function codeLines(source: string): string[] {
    return source.split("\n").filter(line => !isCommentLine(line));
}

/** Only the executable and user-visible lines — see the header. */
function codeOf(source: string): string {
    return codeLines(source).join("\n");
}

/**
 * An input whose TYPE is "password", in any spelling — static, braced, or
 * conditional on some reveal state.
 *
 * Deliberately keyed on the `type=` ATTRIBUTE and not on the word "password".
 * The tab must stay free to name the password MANAGERS it opts out of
 * (`PASSWORD_MANAGER_OPT_OUTS`, `data-lpignore`), to explain that Chromium's
 * password manager ignores `autocomplete="off"`, and to quote the exact
 * expression it used to carry. A matcher that fired on the word would forbid the
 * file from documenting its own incident — and a matcher that scanned for that
 * quoted expression would be satisfied BY the documentation, which is the defect
 * this rewrite removes.
 *
 * Same shape as PASSWORD_TYPE in test/appsScriptRowSaveReset.test.ts, on purpose:
 * that file guards the row's Save/Reset behaviour, this one guards the row's
 * binding, and a construct this dangerous should fail both rather than rely on
 * whichever file a future editor happens to run.
 */
const PASSWORD_TYPED_INPUT =
    /type\s*=\s*(?:["']password["']|\{[^}]*["']password["'][^}]*\})/;

/**
 * Executable traces of a mask or a reveal toggle.
 *
 * Applied to STRIPPED code only. The tab's comments discuss `revealed`, masking
 * and the eight masked characters the operator found at length, and must go on
 * being allowed to.
 */
const REVEAL_STATE = /\b(?:revealed|setRevealed|masked|MASKED_INPUT_CLASS)\b|text-security|aria-pressed/;

/**
 * Top-level setting ids of `definePluginSettings({ ... })`, taken from the
 * plugin source.
 *
 * Deliberately keyed on the file's own 4-space formatting rather than on a list
 * written here: the point of the test is that the tab's id must exist IN THE
 * PLUGIN, so the plugin's spelling has to be the thing that is read.
 */
function pluginSettingIds(src: string): string[] {
    const start = src.indexOf("definePluginSettings({");
    if (start === -1) return [];
    const body = src.slice(start);
    return [...body.matchAll(/^ {4}([A-Za-z_$][\w$]*):\s*\{\s*$/gm)].map(m => m[1]);
}

/**
 * The ids the tab passes to `translatorSettings.use([...])`.
 *
 * A `use()` call with no filter subscribes to everything and returns an
 * unrestricted store, which would defeat the type check the comment above relies
 * on — so "no match" returns [] and the assertions below fail loudly rather than
 * passing vacuously.
 */
function tabSubscribedIds(src: string): string[] {
    const call = /translatorSettings\.use\(\s*\[([^\]]*)\]\s*\)/.exec(src);
    if (!call) return [];
    return [...call[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

describe("Discord Translator tab: the credential row and the plugin share one setting", () => {
    it("both files it claims to read actually exist", () => {
        expect(existsSync(TAB_PATH), `settings tab not found at ${TAB_PATH}`).toBe(true);
        expect(
            existsSync(PLUGIN_SETTINGS_PATH),
            `plugin settings not found at ${PLUGIN_SETTINGS_PATH}`
        ).toBe(true);
    });

    it("the plugin-settings scan finds a plausible set of ids (the scan is measuring something)", () => {
        const ids = pluginSettingIds(read(PLUGIN_SETTINGS_PATH));
        expect(ids.length, "no setting ids parsed out of definePluginSettings").toBeGreaterThan(5);
        // Ids unrelated to this row, so this control keeps working even if the
        // credential set is reorganised.
        expect(ids).toContain("provider");
        expect(ids).toContain("targetLanguage");
    });

    it("the plugin still defines the credential the row edits", () => {
        const ids = pluginSettingIds(read(PLUGIN_SETTINGS_PATH));
        expect(
            ids,
            `the tab's row edits "${ROW_SETTING_ID}", which no longer exists in the plugin. ` +
            "Renaming it splits one credential into two. Update the tab too."
        ).toContain(ROW_SETTING_ID);
    });

    it("the plugin still defines the bookkeeping id Reset restores from", () => {
        const ids = pluginSettingIds(read(PLUGIN_SETTINGS_PATH));
        expect(
            ids,
            `the tab's row reads "${LAST_GOOD_SETTING_ID}", which no longer exists in the plugin. ` +
            "Reset would silently restore undefined."
        ).toContain(LAST_GOOD_SETTING_ID);
    });

    it("the row subscribes to exactly those ids, and to no other credential", () => {
        const subscribed = tabSubscribedIds(read(TAB_PATH));
        expect(
            subscribed,
            "no `translatorSettings.use([...])` call with an explicit id list was found in the tab"
        ).toEqual(SUBSCRIBED_IDS);
    });

    it("every id the tab subscribes to exists in the plugin's own definition", () => {
        const pluginIds = new Set(pluginSettingIds(read(PLUGIN_SETTINGS_PATH)));
        const unknown = tabSubscribedIds(read(TAB_PATH)).filter(id => !pluginIds.has(id));
        expect(
            unknown,
            `the tab subscribes to setting ids the plugin does not define: ${unknown.join(", ")}`
        ).toEqual([]);
    });

    it("the tab reads AND writes that id — a read-only row would silently drop what the user types", () => {
        const src = read(TAB_PATH);
        expect(src).toMatch(new RegExp(`translator\\.${ROW_SETTING_ID}\\s*\\?\\?`));
        // The write is no longer per-keystroke: the row is draft state and only
        // Save commits, so the assignment's right-hand side is a checked value
        // rather than the raw `value` the old onChange wrote. It is still an
        // assignment, and a row that never assigns is still the defect.
        expect(src).toMatch(new RegExp(`translator\\.${ROW_SETTING_ID}\\s*=\\s*\\w`));
    });

    it("the tab reads AND writes the bookkeeping id too", () => {
        const src = read(TAB_PATH);
        expect(src).toMatch(new RegExp(`translator\\.${LAST_GOOD_SETTING_ID}\\s*\\?\\?`));
        expect(src).toMatch(new RegExp(`translator\\.${LAST_GOOD_SETTING_ID}\\s*=\\s*\\w`));
    });

    it("the store comes from the plugin module, not from a copy declared in the tab", () => {
        const src = read(TAB_PATH);
        expect(src).toContain('from "@plugins/channelTranslator/settings"');
        expect(src).toMatch(/settings as translatorSettings/);
        // The failure mode this forbids: someone hits a type error after a
        // rename and "fixes" it by giving the tab its own settings object or its
        // own top-level Vencord setting. Either produces a second stored value.
        expect(src).not.toContain("definePluginSettings");
        expect(src).not.toMatch(/useSettings\(\s*\[[^\]]*ApiKey/);
    });

    it("the row does not touch the two deleted paid credentials", () => {
        const src = read(TAB_PATH);
        const subscribed = new Set(tabSubscribedIds(src));
        for (const id of OTHER_CREDENTIAL_IDS) {
            expect(
                subscribed.has(id),
                `the tab subscribes to ${id}, which this row is not for`
            ).toBe(false);
            // Naming them in a comment is fine and useful; reading or writing
            // them from this row is not.
            expect(
                src,
                `the tab reads or writes ${id}, which this row is not for`
            ).not.toMatch(new RegExp(`translator\\.${id}\\b`));
        }
    });

    it("the row shows its value in clear, and its heading names the provider unambiguously", () => {
        const src = read(TAB_PATH);
        const code = codeOf(src);

        // CODE DIRECTION — comments stripped. The input's type is DECLARED
        // rather than left to whatever TextInput defaults to, so the plain-text
        // decision is visible in the source instead of inherited. Stripped,
        // because the tab's own comment quotes the old conditional type and a
        // whole-file scan could not tell the two apart.
        expect(
            code,
            'the TextInput no longer declares type="text" — the row\'s plain-text ' +
            "decision has to be written down, not inherited from a default"
        ).toContain('type="text"');

        // CODE DIRECTION. No mask and no reveal toggle survive in executable
        // code: no `revealed`/`setRevealed` state, no `masked` flag or mask
        // class, no CSS text-security, no aria-pressed toggle. The comments say
        // all of those words and are allowed to.
        expect(
            REVEAL_STATE.test(code),
            "a mask or reveal toggle is back in executable code — the operator ruled " +
            '"The API doesn\'t need to be masked", and a ~100-character deployment ' +
            "URL you cannot read back is one you cannot proof-read"
        ).toBe(false);

        // ABSENCE DIRECTION — WHOLE FILE, comments included, matched on shape.
        // A password-typed input pasted into a comment today is one somebody
        // uncomments tomorrow, and this row's incident came from exactly that
        // construct: Chromium autofilled a real saved discord.com credential
        // into it. Keyed on `type=…password…`, so the file stays free to
        // explain itself in prose.
        expect(
            PASSWORD_TYPED_INPUT.test(src),
            "a password-typed input is back somewhere in this file (comments count) — " +
            "that is what a browser password manager autofills"
        ).toBe(false);

        // CODE DIRECTION. The heading has to NAME the provider on screen. A
        // whole-file scan would be satisfied by the comment above the component,
        // which discusses the Apps Script proxy at length — so this asserts on
        // rendered text, where it means something.
        expect(
            code,
            'nothing rendered names the "Apps Script proxy" — the row would not say ' +
            "which of the three credentials it edits"
        ).toContain("Apps Script proxy");

        // ABSENCE DIRECTION — WHOLE FILE. The row is no longer the paid key's,
        // so its old heading must be gone everywhere: a screen that names a
        // credential it does not edit sends the user's Cloud key into the free
        // proxy's box. Comments included on purpose — a heading commented out
        // "for now" is a heading one edit away from returning.
        expect(
            src,
            'the paid key\'s old heading "Google Cloud Translation API Key" is back — ' +
            "this row edits appsScriptUrl and must not claim otherwise"
        ).not.toContain("Google Cloud Translation API Key");
    });

    it("the guide link reuses the plugin's own resolver rather than a second URL constant", () => {
        const src = read(TAB_PATH);
        expect(src).toMatch(/\bguideTarget\b/);
        // No hand-typed guide address. github.com appears in this file already,
        // for "View Source Code", so the check is for a *guide* URL literal.
        expect(src).not.toMatch(/https:\/\/[^"'\s]*(?:guide|setup)/i);
    });

    // ---------------------------------------------------------------------
    // Controls. Every extractor above is run against text that must match and
    // text that must not, so a silently-broken regex cannot pass this file by
    // returning nothing.
    // ---------------------------------------------------------------------

    it("pluginSettingIds finds a setting in a synthetic definition (positive control)", () => {
        const synthetic = [
            "export const settings = definePluginSettings({",
            `    ${ROW_SETTING_ID}: {`,
            "        type: OptionType.STRING,",
            "        default: \"\"",
            "    }",
            "});"
        ].join("\n");
        expect(pluginSettingIds(synthetic)).toEqual([ROW_SETTING_ID]);
    });

    it("pluginSettingIds reports a renamed setting as renamed (negative control)", () => {
        const renamed = [
            "export const settings = definePluginSettings({",
            "    appsScriptDeploymentUrl: {",
            "        type: OptionType.STRING,",
            "        default: \"\"",
            "    }",
            "});"
        ].join("\n");
        expect(pluginSettingIds(renamed)).not.toContain(ROW_SETTING_ID);
    });

    it("tabSubscribedIds reads the ids out of a use() call (positive control)", () => {
        const call =
            "const translator = translatorSettings.use([" +
            `"${ROW_SETTING_ID}", "${LAST_GOOD_SETTING_ID}"]);`;
        expect(tabSubscribedIds(call)).toEqual(SUBSCRIBED_IDS);
    });

    it("tabSubscribedIds returns nothing for an unfiltered use() call (negative control)", () => {
        expect(tabSubscribedIds("const t = translatorSettings.use();")).toEqual([]);
    });

    it("codeOf() drops comment lines and keeps rendered copy (positive and negative control)", () => {
        const sample = [
            "                // the type was written `revealed ? \"text\" : \"password\"`.",
            "                /* masked by default */",
            "                 * aria-pressed={revealed}",
            "                type=\"text\"",
            "                    Apps Script proxy — the free option"
        ].join("\n");
        const code = codeOf(sample);
        // The three comment lines go, INCLUDING the one quoting the old type —
        // that is the whole reason this stripper is here.
        expect(code).not.toContain("password");
        expect(code).not.toContain("masked");
        expect(code).not.toContain("aria-pressed");
        // Executable and user-visible lines stay.
        expect(code).toContain('type="text"');
        expect(code).toContain("Apps Script proxy");
    });

    it("PASSWORD_TYPED_INPUT fires on every shape the defect could take (positive control)", () => {
        // The exact expression this row used to carry.
        expect(PASSWORD_TYPED_INPUT.test('type={revealed ? "text" : "password"}')).toBe(true);
        expect(PASSWORD_TYPED_INPUT.test('type="password"')).toBe(true);
        expect(PASSWORD_TYPED_INPUT.test("type='password'")).toBe(true);
        expect(PASSWORD_TYPED_INPUT.test('type={masked ? "password" : "text"}')).toBe(true);
        expect(PASSWORD_TYPED_INPUT.test('type = "password"')).toBe(true);
        expect(PASSWORD_TYPED_INPUT.test('type={"password"}')).toBe(true);
        // And it fires from inside a comment, which is why the assertion above
        // scans the whole file rather than codeOf().
        expect(PASSWORD_TYPED_INPUT.test('// TODO restore type="password"')).toBe(true);
    });

    it("PASSWORD_TYPED_INPUT abstains on the fix and on prose about it (negative control)", () => {
        // A matcher that fired on the word "password" would forbid the tab from
        // documenting the incident that produced the fix.
        expect(PASSWORD_TYPED_INPUT.test('type="text"')).toBe(false);
        expect(PASSWORD_TYPED_INPUT.test("Chromium's password manager ignores autocomplete=off")).toBe(false);
        expect(PASSWORD_TYPED_INPUT.test("const PASSWORD_MANAGER_OPT_OUTS = {")).toBe(false);
        expect(PASSWORD_TYPED_INPUT.test("data-lpignore")).toBe(false);
        // The tab's line 488 comment, near enough: a backticked quotation with
        // no `type=` attribute. It must NOT fire, or tidying that comment could
        // not be told apart from reintroducing the input.
        expect(PASSWORD_TYPED_INPUT.test('// the type was written `revealed ? "text" : "password"`.')).toBe(false);
    });

    it("REVEAL_STATE fires on each reveal/mask trace, and abstains on the fix (controls)", () => {
        expect(REVEAL_STATE.test("const [revealed, setRevealed] = useState(false);")).toBe(true);
        expect(REVEAL_STATE.test('const masked = !revealed && draft !== "";')).toBe(true);
        expect(REVEAL_STATE.test("className={MASKED_INPUT_CLASS}")).toBe(true);
        expect(REVEAL_STATE.test("-webkit-text-security: disc;")).toBe(true);
        expect(REVEAL_STATE.test("aria-pressed={revealed}")).toBe(true);
        // Negative: the fix, and words that merely resemble the subject.
        expect(REVEAL_STATE.test('type="text"')).toBe(false);
        expect(REVEAL_STATE.test("Showing the whole URL is deliberate")).toBe(false);
        expect(REVEAL_STATE.test("unmaskedValue")).toBe(false);
    });

    /*
     * 🔴 THIS CONTROL USED TO READ NO FILE AND CALL NO EXTRACTOR.
     *
     * It was three lines: a hand-written `new Set(["appsScriptDeploymentUrl",
     * "provider"])` and a filter over the SUBSCRIBED_IDS constant. Neither
     * pluginSettingIds() nor tabSubscribedIds() appeared in it — so it proved
     * only that JavaScript's Set.has works, and would have stayed green with
     * both extractors returning [] for every input. A control that does not
     * exercise the matcher controls nothing, and this one is the control for the
     * assertion that keeps the tab and the plugin storing the same value.
     *
     * It now drives the REAL pair, on source text shaped like the two files, in
     * both directions.
     */
    it("the drift the suite exists to catch would actually fail it", () => {
        // The plugin, with the credential RENAMED and the tab left alone.
        const driftedPlugin = [
            "export const settings = definePluginSettings({",
            "    appsScriptDeploymentUrl: {",
            "        type: OptionType.STRING,",
            "        default: \"\"",
            "    },",
            `    ${LAST_GOOD_SETTING_ID}: {`,
            "        type: OptionType.STRING,",
            "        hidden: true,",
            "        default: \"\"",
            "    }",
            "});"
        ].join("\n");
        const unchangedTab =
            "const translator = translatorSettings.use([" +
            `"${ROW_SETTING_ID}", "${LAST_GOOD_SETTING_ID}"]);`;

        // The real extractors, on that pair — the same two calls the live
        // assertion makes against the real files.
        const pluginIds = new Set(pluginSettingIds(driftedPlugin));
        const unknown = tabSubscribedIds(unchangedTab).filter(id => !pluginIds.has(id));

        expect(pluginIds.has("appsScriptDeploymentUrl"), "the plugin extractor read nothing").toBe(true);
        expect(
            unknown,
            "the drift check would not have noticed the credential being renamed"
        ).toEqual([ROW_SETTING_ID]);
    });

    it("…and stays quiet when the two agree (negative control for the same pair)", () => {
        // Without this, an extractor pair that reported EVERY id as unknown
        // would satisfy the assertion above while failing the real files for the
        // wrong reason.
        const alignedPlugin = [
            "export const settings = definePluginSettings({",
            `    ${ROW_SETTING_ID}: {`,
            "        type: OptionType.STRING,",
            "        default: \"\"",
            "    },",
            `    ${LAST_GOOD_SETTING_ID}: {`,
            "        type: OptionType.STRING,",
            "        hidden: true,",
            "        default: \"\"",
            "    }",
            "});"
        ].join("\n");
        const tab =
            "const translator = translatorSettings.use([" +
            `"${ROW_SETTING_ID}", "${LAST_GOOD_SETTING_ID}"]);`;

        const pluginIds = new Set(pluginSettingIds(alignedPlugin));
        expect([...pluginIds].sort()).toEqual([...SUBSCRIBED_IDS].sort());
        expect(tabSubscribedIds(tab).filter(id => !pluginIds.has(id))).toEqual([]);
    });
});
