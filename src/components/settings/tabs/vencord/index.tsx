/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./VencordTab.css";

import { openNotificationLogModal } from "@api/Notifications/notificationLog";
import { plugins } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { FolderIcon, GithubIcon, LogIcon, PaintbrushIcon, RestartIcon } from "@components/Icons";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { openPluginModal, SettingsTab, wrapTab } from "@components/settings";
import { QuickAction, QuickActionCard } from "@components/settings/QuickAction";
import { GoatBanner } from "@plugins/channelTranslator/panel/goatBanner";
import { guideTarget, settings as translatorSettings } from "@plugins/channelTranslator/settings";
import { validateAppsScriptUrl } from "@plugins/channelTranslator/state";
import { gitRemote } from "@shared/vencordUserAgent";
import { IS_WINDOWS } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import { relaunch } from "@utils/native";
import { Alerts, React, TextInput, useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { MacOSVibrancySettings } from "./MacVibrancySettings";
import { NotificationSection } from "./NotificationSettings";
import { WindowsMaterialSettings } from "./WindowsMaterialSettings";

const cl = classNameFactory("vc-vencord-tab-");

type KeysOfType<Object, Type> = {
    [K in keyof Object]: Object[K] extends Type ? K : never;
}[keyof Object];

function Switches() {
    const settings = useSettings(["useQuickCss", "enableReactDevtools", "mainWindowFrameless", "frameless", "winNativeTitleBar", "transparent", "winCtrlQ", "disableMinSize"]);

    const Switches = [
        {
            key: "useQuickCss",
            title: "Enable Custom CSS",
            description: "Load custom CSS from the QuickCSS editor. This allows you to customize Discord's appearance with your own styles.",
        },
        !IS_WEB && {
            key: "enableReactDevtools",
            title: "Enable React Developer Tools",
            description: "Enable the React Developer Tools extension for debugging Discord's React components. Useful for plugin development.",
            restartRequired: true,
        },
        (!IS_WEB && !IS_DISCORD_DESKTOP || !IS_WINDOWS) && {
            key: "mainWindowFrameless",
            title: "Disable the Main Window Frame",
            description: "Remove the native window frame for a cleaner look. You can still move the window by dragging the title bar area.",
            restartRequired: true,
        },
        !IS_WEB && (!IS_DISCORD_DESKTOP || !IS_WINDOWS
            ? {
                key: "frameless",
                title: "Disable All Window Frames",
                description: "Remove the native window frame for a cleaner look. You can still move the window by dragging the title bar area.",
                restartRequired: true,
            }
            : {
                key: "winNativeTitleBar",
                title: "Use Windows' native title bar instead of Discord's custom one",
                description: "Replace Discord's custom title bar with the standard Windows title bar. This may improve compatibility with some window management tools.",
                restartRequired: true,
            }
        ),
        !IS_WEB && {
            key: "transparent",
            title: "Enable Window Transparency",
            description: "Make the Discord window transparent. A theme that supports transparency is required or this will do nothing.",
            restartRequired: true,
            warning: IS_WINDOWS
                ? "This will stop the window from being resizable and prevents you from snapping the window to screen edges."
                : "This will stop the window from being resizable.",
        },
        IS_DISCORD_DESKTOP && {
            key: "disableMinSize",
            title: "Disable Minimum Window Size",
            description: "Allow the Discord window to be resized smaller than its default minimum size. Useful for tiling window managers or small screens.",
            restartRequired: true,
        },
        !IS_WEB && IS_WINDOWS && {
            key: "winCtrlQ",
            title: "Register Ctrl+Q as shortcut to close Discord",
            description: "Add Ctrl+Q as a keyboard shortcut to close Discord. This provides an alternative to Alt+F4 for quickly closing the application.",
            restartRequired: true,
        },
    ] satisfies Array<false | {
        key: KeysOfType<typeof settings, boolean>;
        title: string;
        description?: string;
        restartRequired?: boolean;
        warning?: string;
    }>;

    return Switches.map(setting => {
        if (!setting) {
            return null;
        }

        const { key, title, description, restartRequired, warning } = setting;

        return (
            <FormSwitch
                key={key}
                title={title}
                description={
                    warning ? (
                        <>
                            {description}
                            <Notice.Warning className={Margins.top8} style={{ width: "100%" }}>
                                {warning}
                            </Notice.Warning>
                        </>
                    ) : (
                        description
                    )
                }
                value={settings[key]}
                onChange={v => {
                    settings[key] = v;

                    if (restartRequired) {
                        Alerts.show({
                            title: "Restart Required",
                            body: "A restart is required to apply this change",
                            confirmText: "Restart now",
                            cancelText: "Later!",
                            onConfirm: relaunch
                        });
                    }
                }}
                hideBorder
            />
        );
    });
}

/**
 * The guide link's label, exactly as the operator specified it.
 *
 * U+2192 RIGHT ARROW, one space, two words. Pinned character-for-character by
 * test/appsScriptRowSaveReset.test.ts — "→ Setup Guide" was given as a string,
 * not as a description of a string, so an em-dash, an ASCII "->" or a different
 * capitalisation is a defect rather than a variation.
 */
const SETUP_GUIDE_LABEL = "→ Setup Guide";

/**
 * Heading and guide link on ONE line, the link immediately to the right.
 *
 * `flexWrap` so a narrow settings pane drops the link under the heading instead
 * of overflowing it; `alignItems: center` so the two different font sizes sit on
 * a shared centre line rather than a shared baseline.
 */
const HEADING_ROW_STYLE: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: 8
};

/**
 * The link reads as a control, not as prose.
 *
 * 16px is .vc-h5's own size (src/components/Heading.css), which is what
 * `<Heading>` renders here; a `<Paragraph>` is smaller. Weight 600 is heavier
 * than the heading's 500, so the link is the boldest thing on its row without
 * being bigger than the heading it belongs to.
 */
const SETUP_GUIDE_LINK_STYLE: CSSProperties = {
    cursor: "pointer",
    color: "var(--text-link)",
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: 1.25,
    whiteSpace: "nowrap"
};

/**
 * Where the link actually goes, said for a screen reader and on hover.
 *
 * Both destinations now show the SAME visible text, which the operator asked
 * for. That is only honest if the difference is still available somewhere — a
 * user clicking "→ Setup Guide" and landing on a GitHub repository page has been
 * surprised by a control that promised something else. guideTarget() returns
 * "repo" precisely when this build carries no copy of the guide.
 */
const SETUP_GUIDE_TITLE: Record<string, string> = {
    packaged: "Opens the setup guide bundled with this build",
    hosted: "Opens the setup guide (opens in a new tab)",
    repo: "Opens the project page on GitHub, where the guide lives (opens in a new tab)"
};

/** The sentence shown INSTEAD of the link when this build can reach no guide. */
const NO_GUIDE_SENTENCE =
    "The setup guide is not reachable from this build — it ships inside the browser " +
    "extension, and its source is site/free/index.html in the project's repository.";

/**
 * Best-effort opt-outs for the third-party password managers.
 *
 * These are the vendors' own documented attributes — 1Password, LastPass,
 * Bitwarden, Dashlane. They are CONVENTIONS that those extensions choose to
 * respect, not a platform guarantee: an extension is free to ignore them, and a
 * vendor not listed here has never heard of them. They are worth having because
 * they are free and they work for the common cases; they are not the reason this
 * field is safe. Not declaring the input a password field is — see the comment on
 * the TextInput below.
 *
 * They also still earn their place on a plain text field: what they suppress is a
 * manager offering to SAVE what you type here into its vault, which is a
 * different event from the autofill that caused the incident.
 */
const PASSWORD_MANAGER_OPT_OUTS = {
    "data-1p-ignore": "",
    "data-lpignore": "true",
    "data-bwignore": "",
    "data-form-type": "other"
} as const;

/**
 * Said only when the stored setting is empty and the box is not.
 *
 * The draft is seeded from `stored` and moved by nothing except the user's own
 * typing and the reconciliation effect. So if this plugin has saved nothing and
 * there is text in the box, that text came from outside this plugin. "Unsaved
 * changes" is true but says nothing about WHERE the text came from, and a user who
 * assumes the plugin pre-filled its own field will press Save on somebody else's
 * credential.
 */
const NOTHING_STORED_SENTENCE =
    "Nothing is saved here yet, so this box was empty when the page opened. If it " +
    "already had text in it, that text came from outside this plugin — a browser or " +
    "password manager autofill is the usual cause. Clear it unless you recognise it " +
    "as your own deployment URL.";

type RowStatus = { kind: "ok" | "error"; message: string; };

/**
 * The FREE Apps Script proxy's deployment URL, on the screen the user actually
 * opens.
 *
 * WHY THIS ROW IS FOR THIS CREDENTIAL. It used to bind to `googleCloudApiKey`,
 * the PAID Google Cloud Translation v2 key. The bundled setup guide
 * (site/free/index.html, shipped as guide.html) is the APPS SCRIPT tutorial, so
 * the row and the link beside it described two different things. Operator
 * ruling: "the row shall for 'Apps Script proxy', even our setup guide is
 * dedicated for this key." After this change the field, the guide link and the
 * body copy are all about one thing.
 *
 * THE PAID KEY IS GONE, AND SO IS THE SETTING IT LIVED IN. `googleCloudApiKey`
 * and `deeplApiKey` were deleted along with the two paid providers, so there is
 * nowhere left in this client to edit either one and nothing for this row to
 * have moved a Cloud key TO. The retarget above stopped being the interesting
 * part the moment the provider itself went.
 *
 * THE CONCERN BEHIND IT SURVIVES THE KEYS, which is why this paragraph was
 * corrected rather than deleted: a user who pasted a Cloud key into this box
 * still deserves to learn what became of it, and the answer is no longer in the
 * copy below — that copy is now about Apps Script and nothing else. Two live
 * things carry it instead. The provider dropdown's own description in
 * src/plugins/channelTranslator/settings.ts names DeepL and Google Cloud
 * Translation as removed, and migrateUnavailableProvider() in
 * src/plugins/channelTranslator/provider.ts moves anyone still persisted onto a
 * retired provider id and says so in a notice.
 *
 * THE SAME VALUE, NOT A SECOND ONE. `translatorSettings` is literally the object
 * src/plugins/channelTranslator/settings.ts exports and the plugin cog renders,
 * so `.use(["appsScriptUrl", "lastGoodAppsScriptUrl"])` resolves through
 * @api/Settings to `Settings.plugins.ChannelTranslator.*` — one value, one store,
 * one file on disk. Both screens rerender because `use()` subscribes to those
 * exact settings paths.
 *
 * THE TYPECHECKER DOES NOT GUARD THE IDS — MEASURED, NOT ASSUMED. It looks as if
 * it should: `DefinedSettings.use` is declared
 * `use<F extends Extract<keyof Def, string>>(filter?: F[]): Pick<SettingsStore<Def>, F>`
 * in src/utils/types.ts. It does not, here. The id was changed to
 * "googleCloudApiKeyMUTANT" and `node node_modules/typescript/bin/tsc --noEmit`
 * still exited 0. That measurement is quoted as it was actually run and is NOT
 * restated against today's id: it predates the retarget above, back when this
 * row bound to `googleCloudApiKey`, and that setting no longer exists. Mutating
 * `appsScriptUrl` is how a reader reproduces it now. A type probe says why: for
 * this plugin's exported `settings`,
 * `keyof typeof settings.def` resolves to `string | number | symbol` and
 * `typeof settings.store` resolves to `any`, so `Def` never carries the literal
 * keys and every id — and every property read off the result — is accepted.
 *
 * SO THE ONLY GUARD IS test/vencordTabApiKeyRow.test.ts, and it is not a
 * belt-and-braces extra. It reads this file and the plugin's settings source and
 * fails if an id here is not one the plugin still defines. Rename
 * `appsScriptUrl` in the plugin without changing this line and nothing but that
 * test stands between the user and two boxes holding two different values.
 *
 * DRAFT STATE, AND WHY IT IS NOT OPTIONAL HERE. The old row wrote the setting on
 * every keystroke. That is defensible for a field with no Save button and
 * indefensible with one: a half-pasted deployment URL would go live, and the
 * next translation would fail against a truncated URL the user believed they had
 * not committed yet. The TextInput below is therefore React state, and only
 * onSave() writes.
 *
 * THE RECONCILIATION RULE, because the cog still writes on every keystroke and
 * can move `appsScriptUrl` underneath this draft:
 *
 *   - stored changed externally AND the draft has no unsaved edits
 *         → the draft follows the store. Nothing of the user's is lost, and the
 *           box does not sit there showing a stale value.
 *   - stored changed externally AND the draft HAS unsaved edits
 *         → the user's typing wins and is kept, and a notice says the stored
 *           value moved. Silently discarding what someone typed to make two
 *           screens agree is the worse of the two failures: one is a surprise,
 *           the other is lost work.
 *
 * `reconciled` is the last stored value this component has accounted for, which
 * is what makes "changed externally" answerable at all — our OWN writes update it
 * first, so a Save or a Reset never looks like somebody else's edit.
 */
function TranslationApiKeySection() {
    const translator = translatorSettings.use(["appsScriptUrl", "lastGoodAppsScriptUrl"]);
    // Resolved on render, not at module scope: guideTarget() reads
    // EXTENSION_BASE_URL, which is a live binding the content script fills in
    // after DOMContentLoaded.
    const guide = guideTarget();

    const stored = translator.appsScriptUrl ?? "";
    const lastGood = (translator.lastGoodAppsScriptUrl ?? "").trim();

    const [draft, setDraftValue] = useState(stored);
    const [checking, setChecking] = useState(false);
    const [status, setStatus] = useState<RowStatus | null>(null);
    const [movedElsewhere, setMovedElsewhere] = useState(false);

    // Read inside the effect below, which must see the draft as it is NOW rather
    // than as it was when that effect was created.
    const draftRef = useRef(stored);
    const reconciled = useRef(stored);

    function setDraft(next: string) {
        draftRef.current = next;
        setDraftValue(next);
    }

    useEffect(() => {
        if (stored === reconciled.current) return;
        const hadUnsavedEdits = draftRef.current !== reconciled.current;
        reconciled.current = stored;
        if (hadUnsavedEdits) {
            setMovedElsewhere(true);
            return;
        }
        setDraft(stored);
        setStatus(null);
    }, [stored]);

    const dirty = draft !== stored;
    const saveDisabled = checking || draft.trim() === "" || !dirty;

    async function onSave() {
        if (checking) return;
        const candidate = draft.trim();
        setChecking(true);
        setStatus(null);
        try {
            // TWO STAGES, and the first one is the reason this button can exist
            // at all. validateAppsScriptUrl() checks the URL's SHAPE locally and
            // instantly through checkDeploymentUrl(); only a well-formed URL gets
            // as far as one real request to the user's own deployment.
            const result = await validateAppsScriptUrl(candidate);
            if (!result.ok) {
                // NOTHING IS COMMITTED. Not the URL, not the "last good" record —
                // a failed check must leave the settings exactly as it found
                // them, or "Reset to last working" stops meaning anything.
                setStatus({ kind: "error", message: result.reason });
                return;
            }

            // state.ts already stored the CANONICAL form of the URL — rebuilt by
            // checkDeploymentUrl() from the parsed host and path, with any query,
            // fragment or embedded credentials dropped — and that is the string
            // the successful request was actually made against. Preferring it
            // over the raw paste is why this reads the setting back instead of
            // writing `candidate` twice. The fallback covers only the case where
            // the read comes back empty, which would mean the contract moved.
            const verified = (translator.lastGoodAppsScriptUrl ?? "").trim() || candidate;

            // Ours, not somebody else's: accounted for BEFORE the writes, so the
            // effect above does not read them back as an external change.
            reconciled.current = verified;
            translator.appsScriptUrl = verified;
            translator.lastGoodAppsScriptUrl = verified;
            setDraft(verified);
            setMovedElsewhere(false);
            setStatus({
                kind: "ok",
                message:
                    "Checked and applied. The deployment answered with a translation, so this " +
                    "URL is now both the one in use and the one Reset returns to. If you pasted " +
                    "a Deployment ID, the box now shows the full Web App URL it stands for — " +
                    "the same deployment, written out in full."
            });
        } catch {
            // validateAppsScriptUrl() turns every failure it can see into a
            // reason string, so reaching here means something threw that it did
            // not expect. Say that, rather than showing a raw internal message.
            setStatus({
                kind: "error",
                message:
                    "The check stopped unexpectedly and gave no reason. Nothing was changed. " +
                    "Please try again, and report it if it keeps happening."
            });
        } finally {
            setChecking(false);
        }
    }

    /**
     * "Reset to last working" — and "working" is meant literally.
     *
     * `lastGoodAppsScriptUrl` is written in exactly one place, after the await in
     * state.ts's validateAppsScriptUrl(), i.e. only once a real request reached
     * the deployment and came back with a translation.
     *
     * SO THIS BUTTON IS DISABLED UNTIL ONE SAVE HAS SUCCEEDED, and it is NOT
     * seeded from whatever is currently stored. A deliberate decision: the stored
     * URL has never been checked by anything, so calling it "last working" would
     * be a lie told by the button's own label — and the one moment a user presses
     * Reset is the moment they most need it to be true. An empty last-good is
     * explained on screen rather than left as a mysteriously dead control.
     */
    function onReset() {
        if (lastGood === "") return;
        reconciled.current = lastGood;
        translator.appsScriptUrl = lastGood;
        setDraft(lastGood);
        setMovedElsewhere(false);
        setStatus({
            kind: "ok",
            message: "Restored the last URL that was verified to work, and applied it."
        });
    }

    return (
        <section className={Margins.top16}>
            <div style={HEADING_ROW_STYLE}>
                <Heading style={{ marginBottom: 0 }}>
                    Apps Script proxy — the free option, deployed to your own Google account
                </Heading>
                {guide
                    ? (
                        <a
                            role="button"
                            onClick={() => window.open(guide.url, "_blank", "noopener,noreferrer")}
                            style={SETUP_GUIDE_LINK_STYLE}
                            title={SETUP_GUIDE_TITLE[guide.kind]}
                            aria-label={SETUP_GUIDE_TITLE[guide.kind]}
                        >
                            {SETUP_GUIDE_LABEL}
                        </a>
                    )
                    : null}
            </div>
            <Paragraph className={Margins.bottom8}>
                The Apps Script proxy you deploy once into your own Google account, named in
                either of the two forms its Deploy dialog hands you. Paste the Deployment ID —
                the short code with its own copy button — or the whole Web App URL, which looks
                like https://script.google.com/macros/s/&lt;DEPLOYMENT_ID&gt;/exec. Both name the
                same deployment: an ID is expanded into that URL before anything is sent, so the
                box shows the full URL once it has been checked. Either way it is read only when
                the translator's provider is Google Apps Script. A Google Workspace account has
                to paste the whole URL — its address carries the organisation's domain, and that
                cannot be recovered from the ID on its own. There is
                no API key and no card: a consumer Google account allows about 5,000 translation
                calls a day, and going past that fails the request rather than charging you,
                because Apps Script has no billing at all. Stored locally in this client's settings,
                sent only to script.google.com, and never shared. This is the same setting as the
                Apps Script URL in the translator plugin's own settings, at Settings &gt; Plugins
                &gt; ChannelTranslator &gt; the cog, so a value entered in either place shows up in
                the other.
                {guide ? null : " " + NO_GUIDE_SENTENCE}
            </Paragraph>
            <TextInput
                // A PLAIN TEXT INPUT, AND IT IS NOT ALLOWED TO STOP BEING ONE.
                //
                // WHAT IS TRUE NOW. The value is shown in clear, exactly as the
                // plugin's own settings cog has always shown it. Operator ruling:
                // "The API doesn't need to be masked." That also happens to be the
                // right call for this particular value — a deployment URL is about
                // a hundred characters and a bad paste is the commonest failure
                // here, so a box you can read back is a box you can check. A value
                // you cannot see is a value you cannot proof-read.
                //
                // THE HISTORY, WHICH IS THE PART THAT MUST NOT BE UNDONE. This row
                // once declared itself a password field: the type was written
                // `revealed ? "text" : "password"`. The operator opened the tab on
                // a FRESH INSTALL — `appsScriptUrl` has `default: ""` in
                // src/plugins/channelTranslator/settings.ts, so the box is empty by
                // construction — and found roughly eight masked characters already
                // in it, with "Unsaved changes" underneath. A deployment URL is
                // about a hundred characters, so those eight were not ours.
                //
                // WHERE THEY CAME FROM. Declaring an input a password field is how
                // you tell a browser "this is the password box of a login form".
                // Discord desktop is Electron, i.e. Chromium, on the discord.com
                // origin — an origin Chromium is very likely to hold a saved
                // password for — and Chromium's own password manager is documented
                // as ignoring `autocomplete="off"`, so the `autoComplete="off"`
                // this row already carried never stood a chance. An unrelated real
                // credential landed in this component's React state, rendered by
                // this component, one click away from onSave() putting it on the
                // wire. It also teaches a user that this plugin's credential box
                // arrives pre-filled, which is the shape of a phishing UI.
                //
                // SO: the password input type must never come back here, in any
                // spelling, static or conditional. The type below is declared
                // rather than left to whatever TextInput happens to default to,
                // and test/appsScriptRowSaveReset.test.ts fails on the whole file
                // — comments included — if the password form reappears.
                type="text"
                // THE ID FORM LEADS, because it is the one Google's Deploy dialog
                // gives a copy button to and the one the setup guide now tells the
                // reader to take. The URL is still shown, because a user who
                // already has one — or who is on Workspace and must use one —
                // needs to see that it is still accepted.
                placeholder="AKfycb… (Deployment ID) or https://script.google.com/macros/s/…/exec"
                value={draft}
                onChange={value => {
                    setDraft(value);
                    setStatus(null);
                }}
                // Same as TextSetting: without this the input silently
                // truncates at Discord's 999-character default.
                maxLength={null}
                autoComplete="off"
                // Best effort, and only that — see the constant.
                {...PASSWORD_MANAGER_OPT_OUTS}
                spellCheck={false}
                aria-label="Apps Script proxy Deployment ID or Web App URL"
            />
            <Paragraph className={Margins.top8} style={{ color: "var(--text-muted)" }}>
                Save checks what you pasted here first — an ID or a URL, the shape is verified
                locally, instantly, and without contacting anyone. Only a well-formed value is
                then tried for real against your own deployment, which uses one call out of that
                day's ~5,000 and nothing else.
            </Paragraph>
            {dirty && (
                <Paragraph className={Margins.top8} style={{ color: "var(--text-feedback-warning)" }}>
                    Unsaved changes — what you have typed is not in use yet. Press Save to check
                    and apply it.
                    {stored === "" ? " " + NOTHING_STORED_SENTENCE : null}
                </Paragraph>
            )}
            <Flex gap="8px" className={Margins.top8} style={{ flexWrap: "wrap", alignItems: "center" }}>
                <Button
                    size="small"
                    onClick={onSave}
                    disabled={saveDisabled}
                    aria-busy={checking}
                    aria-label="Check this Apps Script Deployment ID or Web App URL and apply it"
                >
                    {checking ? "Checking…" : "Save"}
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={onReset}
                    disabled={checking || lastGood === ""}
                    aria-label="Reset to the last Apps Script URL that was verified to work"
                >
                    Reset
                </Button>
            </Flex>
            {lastGood === "" && (
                <Paragraph className={Margins.top8} style={{ color: "var(--text-muted)" }}>
                    Reset is unavailable until one Save has succeeded. "Working" here means
                    verified — a URL that a real request actually reached — and nothing has been
                    verified on this machine yet, so there is no known-good URL to go back to.
                </Paragraph>
            )}
            {movedElsewhere && (
                <Notice.Warning className={Margins.top8} style={{ width: "100%" }}>
                    This URL was changed somewhere else — the plugin's own settings edit the same
                    value — while you had unsaved edits here. Your typing was kept. Press Save to
                    check and apply what is in the box, or Reset to go back to the last verified
                    URL.
                </Notice.Warning>
            )}
            {status && (status.kind === "ok"
                ? (
                    <Notice.Positive className={Margins.top8} style={{ width: "100%" }}>
                        {status.message}
                    </Notice.Positive>
                )
                : (
                    // VERBATIM, and given room to breathe. appsScript.ts and the
                    // transports write several sentences of specific, actionable
                    // prose — they name the sign-in page, the daily allowance, the
                    // deleted deployment and the /exec-vs-/dev mistake, each with
                    // the menu path to fix it. Truncating that into a toast would
                    // throw away the only part the user can act on.
                    <Notice.Danger className={Margins.top8} style={{ width: "100%" }}>
                        {status.message}
                    </Notice.Danger>
                ))}
        </section>
    );
}

function EquicordSettings() {
    return (
        <SettingsTab>
            <Heading className={Margins.top16}>Quick Actions</Heading>
            <Paragraph className={Margins.bottom16}>
                Common actions you might want to perform. These shortcuts give you quick access to frequently used features without navigating through menus.
            </Paragraph>

            <QuickActionCard>
                <QuickAction
                    Icon={LogIcon}
                    text="Notification Log"
                    action={openNotificationLogModal}
                />
                <QuickAction
                    Icon={PaintbrushIcon}
                    text="Edit QuickCSS"
                    action={() => VencordNative.quickCss.openEditor()}
                />
                {!IS_WEB && (
                    <QuickAction
                        Icon={RestartIcon}
                        text="Relaunch Discord"
                        action={relaunch}
                    />
                )}
                {!IS_WEB && (
                    <QuickAction
                        Icon={FolderIcon}
                        text="Open Settings Folder"
                        action={() => VencordNative.settings.openFolder()}
                    />
                )}
                <QuickAction
                    Icon={GithubIcon}
                    text="View Source Code"
                    action={() =>
                        VencordNative.native.openExternal(
                            "https://github.com/" + gitRemote,
                        )
                    }
                />
            </QuickActionCard>

            {/* Light DOM: GoatBanner injects its own stylesheet into document.head,
                so nothing has to be wired up here beyond the spacing. */}
            <div className={Margins.top16}>
                <GoatBanner variant="settings" />
            </div>

            <Divider className={Margins.top20} />

            <Heading className={Margins.top20}>Client Settings</Heading>
            <Paragraph className={Margins.bottom16}>
                Configure how Discord Translator behaves and integrates with Discord. These settings affect the Discord client's appearance and behavior.
            </Paragraph>
            <Notice.Info className={Margins.bottom20} style={{ width: "100%" }}>
                You can customize where this settings section appears in Discord's settings menu by configuring the{" "}
                <a
                    role="button"
                    onClick={() => openPluginModal(plugins.Settings)}
                    style={{ cursor: "pointer", color: "var(--text-link)" }}
                >
                    Settings Plugin
                </a>.
            </Notice.Info>

            <TranslationApiKeySection />

            <Switches />

            <MacOSVibrancySettings />
            <WindowsMaterialSettings />

            <NotificationSection />
        </SettingsTab >
    );
}

export default wrapTab(EquicordSettings, "Discord Translator");
