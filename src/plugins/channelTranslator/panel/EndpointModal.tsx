/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/EndpointModal.tsx
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, Select, TextInput } from "@webpack/common";
import type { CSSProperties } from "react";

import {
    appsScriptUrlProblem,
    guideTarget,
    openGuide,
    PROVIDER_OPTIONS,
    settings
} from "../settings";

/**
 * THE PROVIDER ID BEHIND THE OPERATOR'S "Google Free API".
 *
 * The two strings in PROVIDER_OPTIONS are UI copy; the ids are the contract
 * with core/providers/registry.ts, and "apps-script" is the same literal
 * provider.ts already spells in resolveAppsScriptCandidate(). It is written out
 * here rather than read off PROVIDER_OPTIONS[1] because the question it answers
 * is "is the user on the provider that needs an endpoint of their own?", which
 * is a fact about the PROVIDER and not about its position in a list — deriving
 * it from the array would move the Setup Guide link onto the other option the
 * day somebody reorders the dropdown.
 */
const APPS_SCRIPT_PROVIDER = "apps-script";

/**
 * The grey hint inside the box, and it must name BOTH shapes the validator
 * takes.
 *
 * checkDeploymentUrl() in core/providers/appsScript.ts accepts the bare
 * Deployment ID — the short value Google's own Deploy dialog puts a copy button
 * beside — as well as the whole /macros/s/<id>/exec URL. A placeholder showing
 * only the URL would teach a user that the ID they have in their clipboard is
 * the wrong thing, which is the exact confusion appsScriptUrlProblem()'s own
 * comment records as having cost a user two screens and a refusal.
 *
 * THE ID FORM LEADS, for the same reason it leads in the sibling row in
 * src/components/settings/tabs/vencord/index.tsx: it is the one with the copy
 * button and the one the setup guide tells the reader to take. That row's
 * placeholder is this string character for character. They are deliberately the
 * same sentence in two places rather than one import, because the panel must
 * not import a settings-tab module — see openEndpointModal() below on why this
 * whole screen exists instead of the plugin cog.
 */
const ENDPOINT_PLACEHOLDER =
    "AKfycb… (Deployment ID) or https://script.google.com/macros/s/…/exec";

/**
 * The guide link's visible text, matching the settings tab's own link exactly.
 *
 * U+2192 RIGHT ARROW, one space, two words — the form the operator specified
 * for the settings tab and which test/appsScriptRowSaveReset.test.ts pins there
 * character by character. A user who has seen one of these two links must
 * recognise the other; two spellings of one control is how a reader concludes
 * they open different things.
 */
const SETUP_GUIDE_LABEL = "→ Setup Guide";

/**
 * Where the link actually goes, said for a screen reader and on hover.
 *
 * Same four kinds guideTarget() can return, same honesty rule as the settings
 * tab: every destination shows the same visible text, so the difference has to
 * be available somewhere. A user clicking "→ Setup Guide" and landing on a
 * GitHub repository page has been surprised by a control that promised
 * something else.
 */
const SETUP_GUIDE_TITLE: Record<string, string> = {
    packaged: "Opens the setup guide bundled with this build",
    desktop: "Opens the setup guide bundled with this build, in its own window",
    hosted: "Opens the setup guide (opens in a new tab)",
    repo: "Opens the project page on GitHub, where the guide lives (opens in a new tab)"
};

/** One control and its label, stacked, with room between the two rows. */
const FIELD_STYLE: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "20px"
};

/** The word above a control. Discord's own form-label size and weight. */
const LABEL_STYLE: CSSProperties = {
    color: "var(--header-secondary)",
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: 1.33,
    textTransform: "uppercase"
};

/**
 * The refusal under the box. Red, because it is the reason the value in the box
 * has NOT been applied.
 */
const PROBLEM_STYLE: CSSProperties = {
    color: "var(--text-feedback-danger)",
    fontSize: "12px",
    lineHeight: 1.33
};

/** The link reads as a control, not as prose — the settings tab's own styling. */
const SETUP_GUIDE_LINK_STYLE: CSSProperties = {
    cursor: "pointer",
    color: "var(--text-link)",
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: 1.25,
    alignSelf: "flex-start"
};

/**
 * THE THREE CONTROLS THE RATE-LIMITED PANEL SENDS A USER TO, AND NOTHING ELSE.
 *
 * ── WHAT WAS WRONG WITH THE OLD DESTINATION ──────────────────────────────────
 *
 * The panel's "Use your own free endpoint" button used to call
 * openPluginModal(plugins["ChannelTranslator"]), i.e. the plugin cog: every
 * setting this plugin has, including the target language, the display mode, the
 * DM switch and four hidden bookkeeping strings. A user who pressed a button
 * about a rate limit was handed a screen they had not asked for and left to
 * find the two controls that answer it. Operator: the button should "pop-up a
 * window ONLY SHOW Provider … and provide a fill box for user put Client ID/URL
 * into it".
 *
 * ── WHAT IS HERE, AND WHAT DELIBERATELY IS NOT ───────────────────────────────
 *
 *   1. Provider — the two free choices, in PROVIDER_OPTIONS' own words.
 *   2. The endpoint box, with the grey hint above.
 *   3. "→ Setup Guide", shown ONLY on the provider that needs setting up.
 *
 * No language picker, no mode switch, no DM toggle. Every one of those is still
 * one click away in the plugin cog; none of them is an answer to "you have been
 * rate limited", and each one added here is one more thing between a stuck user
 * and the box they came for.
 *
 * ── WHY THE VALUES ARE NOT DRAFTED BEHIND A SAVE BUTTON ──────────────────────
 *
 * A Save button would be a fourth control, and this screen has no room for one.
 * So the writes are immediate — but only for a value the validator accepts. The
 * draft below is React state and settings.store.appsScriptUrl is written on the
 * keystroke that first makes appsScriptUrlProblem() return null; a half-typed
 * URL stays in the box, is explained underneath, and never reaches the setting.
 * That is what keeps the defect the settings tab's own Save button exists to
 * prevent — a truncated deployment URL going live and failing the next
 * translation — out of a screen that has no Save button to press.
 *
 * VALIDATION IS NOT RE-IMPLEMENTED HERE. appsScriptUrlProblem() in ../settings
 * is the adapter over checkDeploymentUrl(), which is the single authority on
 * what a usable endpoint is; its own comment records what happened the last time
 * two screens each had their own idea of that. This screen adds no rule and
 * rewords no refusal.
 */
function EndpointModal(props: RenderModalProps) {
    // Both are read through settings.use(), so this window repaints when the
    // value moves underneath it — the plugin cog and the client settings tab
    // both edit the same two settings.
    const store = settings.use(["provider", "appsScriptUrl"]);

    // Resolved on render rather than at module scope, for the reason
    // guideTarget() documents: it reads EXTENSION_BASE_URL, a live binding that
    // browser/content.js fills in after DOMContentLoaded, and it asks the main
    // process whether this build bundles the guide. A module-scope copy would
    // capture the answer from before either was true.
    const guide = guideTarget();

    const [draft, setDraft] = React.useState<string>(store.appsScriptUrl ?? "");

    // Derived, not a second piece of state. Two states that must agree is two
    // states that can disagree, and there is nothing here that a re-render
    // cannot recompute from the draft.
    const problem = appsScriptUrlProblem(draft);

    return (
        <Modal {...props} size="sm" title="Use your own free endpoint">
            <div style={FIELD_STYLE}>
                <span style={LABEL_STYLE}>Provider</span>
                <Select
                    // PROVIDER_OPTIONS ITSELF, not a copy of it. Its own comment
                    // in ../settings names the labels there "the only
                    // human-readable name a provider id has anywhere in this
                    // codebase" and warns that a second copy will drift; a
                    // literal array here would be exactly that copy, and this
                    // window would go on offering a name the plugin cog had
                    // stopped using.
                    options={PROVIDER_OPTIONS}
                    isSelected={(value: string) => value === store.provider}
                    serialize={(value: string) => value}
                    closeOnSelect={true}
                    // The same store the cog writes, so the choice is in force
                    // for the very next translation and survives a restart.
                    select={(value: string) => { settings.store.provider = value; }}
                />
            </div>

            <div style={FIELD_STYLE}>
                <span style={LABEL_STYLE}>Deployment ID or URL</span>
                <TextInput
                    // A PLAIN TEXT INPUT, AND IT IS NOT ALLOWED TO STOP BEING
                    // ONE. Declaring an input a password field is how you tell
                    // Chromium "this is the password box of a login form", and
                    // on the discord.com origin that is an invitation for the
                    // browser's own password manager to autofill an unrelated
                    // credential into this component's state — measured on the
                    // settings tab's row, which is why the type is declared
                    // there too rather than left to a default.
                    type="text"
                    placeholder={ENDPOINT_PLACEHOLDER}
                    value={draft}
                    onChange={(value: string) => {
                        setDraft(value);
                        // Committed only when the validator has no complaint.
                        // Trimmed, because that is the string checkDeploymentUrl()
                        // actually judged — storing the untrimmed paste would put a
                        // value in the setting that was never the one validated.
                        if (appsScriptUrlProblem(value) === null) {
                            settings.store.appsScriptUrl = value.trim();
                        }
                    }}
                    // Without this the input silently truncates at Discord's
                    // 999-character default, same as the settings tab's row.
                    maxLength={null}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Apps Script Deployment ID or Web App URL"
                />
                {problem !== null && <span style={PROBLEM_STYLE}>{problem}</span>}
            </div>

            {/* ONLY on "Google Free API", because it is the only provider with
                anything to set up — the other one needs no account, no key and
                no deployment, so a setup guide beside it is a control that
                answers a question nobody asked. `guide` may still be null on a
                build that carries no copy of the guide and has no hosted
                address (site/ is untracked, so such a build exists); nothing is
                rendered then, for the reason CredentialsSection gives in
                ../settings — a control whose only possible outcome is a failure
                is worse than the absence of one. */}
            {store.provider === APPS_SCRIPT_PROVIDER && guide && (
                <a
                    role="button"
                    // openGuide(), not a window.open() of guide.url: a "desktop"
                    // target has no url at all, because the renderer is never
                    // told where the bundled file is. The one opener in
                    // ../settings is the only thing that knows how to open all
                    // four kinds.
                    onClick={() => openGuide(guide)}
                    style={SETUP_GUIDE_LINK_STYLE}
                    title={SETUP_GUIDE_TITLE[guide.kind]}
                    aria-label={SETUP_GUIDE_TITLE[guide.kind]}
                >
                    {SETUP_GUIDE_LABEL}
                </a>
            )}
        </Modal>
    );
}

/**
 * THE ONE WAY THIS WINDOW IS OPENED, and it may not throw.
 *
 * It is called from an onClick handler inside the floating panel's own React
 * root. An exception there is not a failed button — it unmounts the panel's
 * tree, so the user loses the toggle, the language row and the very button they
 * just pressed. The old openOwnSettings() guarded a missing plugin-registry
 * entry for exactly this reason; that particular failure is now designed out,
 * since nothing here looks a plugin up by name, but `openModal` is still a
 * webpack find that a future Discord build can fail to resolve. A logged
 * console error and a button that does nothing is the worse button and the
 * better failure.
 */
export function openEndpointModal(): void {
    try {
        openModal(props => <EndpointModal {...props} />);
    } catch (err) {
        console.error("[ChannelTranslator] Could not open the endpoint window", err);
    }
}
