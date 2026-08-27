/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/settings.ts
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { OptionType } from "@utils/types";
import { EXTENSION_BASE_URL } from "@utils/web-metadata";
import { React } from "@webpack/common";

import gitRemote from "~git-remote";

/**
 * The target languages this app actually supports.
 *
 * Value is the BCP-47 tag sent to the provider; label is what the user reads.
 *
 * WHY THIS IS A LIST AND NOT FREE TEXT. A provider returns HTTP 400 when it
 * receives a language code it does not recognize. A text field would let the user
 * type an unknown code, so a 400 becomes possible. A SELECT makes it structural
 * — the unknown code can no longer be entered, so the 400 can no longer be caused.
 *
 * ON DUPLICATION. The identical 15 entries are also a literal in
 * panel/Panel.tsx (`LANGUAGES`), which this lane does not own and has not
 * edited. Panel.tsx already imports from this module, so the one-line fix is for
 * its owner to delete that literal and `import { TARGET_LANGUAGES } from
 * "../settings"` — no new dependency edge, no cycle. Until that lands,
 * test/settingsCopy.test.ts compares the two lists entry-by-entry and fails the
 * suite the moment they diverge, so the duplication cannot drift unnoticed.
 */
export const TARGET_LANGUAGES: Array<{ value: string; label: string; default?: boolean; }> = [
    { value: "en", label: "EN - English", default: true },
    { value: "zh-TW", label: "ZH-TW - 繁體中文" },
    { value: "zh-CN", label: "ZH-CN - 简体中文" },
    { value: "ja", label: "JP - 日本語" },
    { value: "ko", label: "KO - 한국어" },
    { value: "es", label: "ES - Español" },
    { value: "fr", label: "FR - Français" },
    { value: "de", label: "DE - Deutsch" },
    { value: "pt", label: "PT - Português" },
    { value: "ru", label: "RU - Русский" },
    { value: "it", label: "IT - Italiano" },
    { value: "th", label: "TH - ไทย" },
    { value: "vi", label: "VI - Tiếng Việt" },
    { value: "id", label: "ID - Bahasa Indonesia" },
    { value: "ar", label: "AR - العربية" }
];

/**
 * The providers the `provider` dropdown offers, and the wording it offers them in.
 *
 * EXPORTED BECAUSE THERE IS A SECOND READER. provider.ts's
 * migrateUnavailableProvider() has to tell a user which provider it moved them
 * TO, and the only human-readable name a provider id has anywhere in this
 * codebase is the label sitting right here — core/providers/registry.ts is keyed
 * by id and knows nothing about UI copy. A second copy of these labels over
 * there would drift the first time one is reworded, and the user would be told
 * they had been switched to something the dropdown does not call that.
 *
 * THIS IS NOT THE SET OF PROVIDERS THAT WORK, and nothing may treat it as one.
 * That set is core/providers/registry.ts's map and only that map. This array is
 * UI copy for it — labels, order, and which one a fresh install gets. The
 * migration therefore asks the REGISTRY whether an id can still be served and
 * never asks this list, because deriving "does it work?" from a label list is
 * exactly how removing a provider stranded people in the first place: the
 * dropdown and the registry are two lists, and only one of them decides whether
 * a translation happens.
 *
 * An id here but absent from the registry is a bug — the dropdown would offer a
 * provider that refuses every translation. An id in the registry but absent here
 * is merely a provider with no dropdown entry yet, which is inert.
 */
export const PROVIDER_OPTIONS: Array<{ value: string; label: string; default?: boolean; }> = [
    { label: "Google (free)", value: "google", default: true },
    { label: "Google Apps Script (your own free proxy)", value: "apps-script" }
];

/**
 * What `provider` means when nothing has been chosen — read off the option
 * marked `default` above rather than written out a second time.
 *
 * It has to be the same value @api/Settings hands a fresh install, and that one
 * is not a constant either: Settings.ts's getDefaultValue() resolves a SELECT by
 * `setting.options.find(o => o.default)`. Deriving it the same way is what makes
 * "the dropdown's default" and "what the migration switches you to" one fact
 * rather than two that can disagree.
 */
export const DEFAULT_PROVIDER_ID: string =
    PROVIDER_OPTIONS.find(option => option.default)?.value ?? PROVIDER_OPTIONS[0].value;

/**
 * The setup guide, under the name the extension package carries it as.
 *
 * ONE spelling, referenced from both sides of the boundary:
 * scripts/build/buildWeb.mjs copies site/free/index.html into every extension
 * package under exactly this name (GUIDE_PACKAGED_NAME there), and
 * scripts/checkExtensionPackages.mjs refuses to pass a package that does not
 * contain it. If the two names ever disagree this button opens a 404 in the
 * user's face, and nothing in the build would notice — which is precisely why
 * the packaging check exists rather than being left to a code review.
 */
const GUIDE_FILE = "guide.html";

/**
 * Where the guide is HOSTED, for builds that are not the browser extension.
 *
 * ⚠ PLACEHOLDER — THIS ONE LINE IS THE WHOLE KNOB. Put your own https:// URL
 * here once you have somewhere serving site/free/index.html, and every
 * non-extension build points at it. Nothing else in this file changes, and the
 * button below goes back to saying "Open the setup guide".
 *
 * EMPTY IS THE HONEST VALUE UNTIL THEN, AND IT IS EMPTY DELIBERATELY. This line
 * used to read "https://example.invalid/discord-translator/setup-guide". The
 * reasoning was that RFC 6761 reserves .invalid so it can never resolve and
 * therefore fails loudly — which is a fine property for a comment and a
 * terrible one for a shipped control. On the desktop and plain-web builds it
 * put a button on the settings screen whose only possible outcome was a DNS
 * failure (measured: ENOTFOUND). Worse, that button is the TERMINUS of the
 * rate-limit escape route — the panel's "Rate limited" state opens this
 * settings screen, and this screen offered the guide — so the entire way out of
 * a rate limit ended at a dead link. Inventing a plausible domain instead has
 * the same defect and hides it better.
 *
 * "" is not a URL, so resolveGuideTarget() falls through to the project page
 * rather than opening nothing. This is still the only place the plugin spells a
 * hosted address.
 */
export const HOSTED_GUIDE_URL = "";

/**
 * The project's own page, and the fallback the desktop build actually uses
 * today.
 *
 * NOT A URL TYPED INTO THIS FILE. `gitRemote` is the origin remote baked in at
 * build time by gitRemotePlugin in scripts/build/common.mjs, and
 * `https://github.com/${gitRemote}` is the identical expression already used by
 * src/main/updater/http.ts and src/components/settings/tabs/vencord/index.tsx.
 * github.com is likewise already an approved click target in
 * scripts/allowed-hosts.txt, under "Link targets shown to the user; navigated
 * only on an explicit click" — so this ships no new third party and adds no
 * line to that file. (Removing example.invalid takes one AWAY: it was neither
 * listed there nor first-party.)
 *
 * GUARDED, because gitRemote is "" on a build machine with no origin remote and
 * no DISCORD_TRANSLATOR_REMOTE — src/shared/vencordUserAgent.ts guards its two
 * readers of it for the same reason. "" here means "no project target", not
 * "https://github.com/".
 */
export const PROJECT_REPO_URL = gitRemote ? `https://github.com/${gitRemote}` : "";

/** Which of the three possible sources a resolved guide target came from. */
export type GuideKind =
    /** The copy packaged inside the browser extension. The real guide. */
    | "packaged"
    /** HOSTED_GUIDE_URL, once the operator has set it. The real guide. */
    | "hosted"
    /** The project page. Where the guide LIVES, not the guide itself. */
    | "repo";

export interface GuideTarget {
    url: string;
    kind: GuideKind;
}

/** RFC 6761 special-use names that are guaranteed never to resolve. */
const RESERVED_TLDS = new Set(["invalid", "test", "example", "localhost"]);
/** RFC 2606 documentation domains, reserved for exactly this misuse. */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

/**
 * A candidate address, or null if it could not open anything.
 *
 * PARSE, DO NOT PATTERN-MATCH. The check that matters is that the string is an
 * absolute https URL at all — "" , "TODO", "coming soon" and a bare hostname
 * all fail it without anyone having to have predicted them.
 *
 * The reserved-name test on top of that is narrow and specific: RFC 6761 and
 * RFC 2606 permanently reserve .invalid, .test, .example and .localhost, and
 * example.com/.net/.org, precisely so they can be used in documentation without
 * ever resolving. A string ending in one is by definition a placeholder someone
 * left in, which is the exact regression this whole comment exists because of.
 * It is a last line, not the first: it can only catch names that are reserved
 * by standard, and it is not a guess at which real domains are dead.
 */
function usableHttpsUrl(candidate: string): string | null {
    const trimmed = candidate.trim();
    if (trimmed === "") return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    const tld = host.slice(host.lastIndexOf(".") + 1);
    if (RESERVED_TLDS.has(tld)) return null;
    if (RESERVED_DOMAINS.has(host)) return null;

    return url.toString();
}

/**
 * The non-extension half of the decision, kept pure and free of build-time
 * globals so that test/guideTarget.test.ts can drive it directly.
 *
 * ORDER IS THE POLICY: a hosted copy of the actual guide beats the project page,
 * and BOTH beat rendering a button. Returning null is a supported outcome, not
 * an error — CredentialsSection renders a sentence instead of an affordance.
 */
export function resolveHostedOrRepo(hostedUrl: string, repoUrl: string): GuideTarget | null {
    const hosted = usableHttpsUrl(hostedUrl);
    if (hosted) return { url: hosted, kind: "hosted" };

    const repo = usableHttpsUrl(repoUrl);
    if (repo) return { url: repo, kind: "repo" };

    return null;
}

/**
 * What the button below opens, or null when nothing reachable exists.
 *
 * IS_EXTENSION is a build-time constant (src/globals.d.ts) and is tested here on
 * the literal global so the branch not taken is still dropped by the bundler.
 *
 * EXTENSION_BASE_URL is a LIVE BINDING, not a value: browser/content.js posts
 * `browser.runtime.getURL("")` into the page on DOMContentLoaded and
 * @utils/web-metadata assigns it then. It is therefore read here, inside a
 * function body that only runs on a render or a click — a module-scope copy
 * would capture `undefined` before that message ever arrives and stay undefined
 * forever. The truthiness test is not belt-and-braces: a settings screen opened
 * in the fraction of a second before the meta message lands would otherwise
 * build the string "undefinedguide.html".
 */
export function guideTarget(): GuideTarget | null {
    if (IS_EXTENSION && EXTENSION_BASE_URL) {
        return { url: new URL(GUIDE_FILE, EXTENSION_BASE_URL).toString(), kind: "packaged" };
    }
    return resolveHostedOrRepo(HOSTED_GUIDE_URL, PROJECT_REPO_URL);
}

/**
 * The address alone. Null, never "" — an empty string is a value a caller can
 * hand to window.open by accident, and null is one it cannot.
 */
export function guideUrl(): string | null {
    return guideTarget()?.url ?? null;
}

/**
 * Opened with the same options the floating panel already uses for external
 * links (panel/Panel.tsx). `noopener` is the load-bearing half: without it the
 * opened document gets a `window.opener` handle back into the logged-in
 * discord.com page.
 *
 * Takes the target it was rendered with rather than re-resolving, so the button
 * can never open something other than what its own label promised.
 */
function openGuide(target: GuideTarget): void {
    window.open(target.url, "_blank", "noopener,noreferrer");
}

/**
 * Why an Apps Script deployment URL is unusable, or null if it looks like one.
 *
 * An empty string is not a problem — it is the default, and it is what every
 * user who has not chosen this provider has.
 *
 * The `/exec` requirement is the one worth spelling out. Apps Script hands out
 * two URLs: `/exec` is the deployment, reachable by "Anyone"; `/dev` is the head
 * revision and requires the owner's own signed-in session. Pasting `/dev`
 * produces a redirect to accounts.google.com, which the transport refuses
 * outright (redirects are not followed), so the user sees a blocked-request
 * failure with nothing pointing at the URL they pasted. Catching it here turns
 * that into a sentence.
 */
export function appsScriptUrlProblem(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return "That is not a URL. Paste the whole Web App URL, starting with https://.";
    }

    if (url.protocol !== "https:") {
        return "The deployment URL must start with https:// — Apps Script serves nothing over http.";
    }
    if (url.hostname !== "script.google.com") {
        return "An Apps Script Web App URL is hosted at script.google.com. " +
            `This one points at ${url.hostname || "no host at all"}.`;
    }
    if (!url.pathname.endsWith("/exec")) {
        return "Use the URL ending in /exec from Deploy > New deployment, not the /dev one. " +
            "The /dev URL only works while you are signed in as the deployment's owner.";
    }
    return null;
}

/**
 * The heading for the credential setting below it, and the way into the guide.
 *
 * It used to introduce three credential boxes — a DeepL key, a Google Cloud key
 * and the Apps Script deployment URL — because a settings screen is a flat list
 * of controls and "these belong together" can only be said by putting something
 * between them and what came before. Both API keys are gone with the providers
 * that billed for them, so it introduces one box now, and the section is what
 * puts the setup guide within reach of the field it explains.
 */
/**
 * The button's label, said so that clicking it cannot surprise anyone.
 *
 * A "repo" target is NOT the guide — it is the page the guide lives on — and
 * labelling it "Open the setup guide" would be the same lie the dead
 * example.invalid link told, just with a working destination. Naming GitHub in
 * the label is also what tells a user the click leaves Discord.
 */
const GUIDE_BUTTON_LABEL: Record<GuideKind, string> = {
    packaged: "Open the setup guide",
    hosted: "Open the setup guide",
    repo: "Open the project page on GitHub"
};

/**
 * The sentence under the button, or the sentence INSTEAD of it.
 *
 * The no-target case is the whole point of this function: a build with nowhere
 * to send the user gets a line of text saying where the guide is, not a control
 * that fails when pressed.
 */
function guideBlurb(kind: GuideKind | null): string {
    switch (kind) {
        case "packaged":
        case "hosted":
            return "";
        case "repo":
            return "This build carries no copy of the guide, so that opens the project page " +
                "instead — the guide is site/free/index.html there, and the browser-extension " +
                "build opens it directly.";
        default:
            return "The setup guide is not reachable from this build: it ships inside the " +
                "browser extension, and this one has no packaged or hosted copy. Its source is " +
                "site/free/index.html in the project's repository.";
    }
}

function CredentialsSection() {
    const target = guideTarget();
    const blurb = guideBlurb(target?.kind ?? null);

    return React.createElement(
        "section",
        { style: { marginBottom: 16 } },
        React.createElement(Heading, { tag: "h5" }, "Your own provider credentials"),
        React.createElement(
            Paragraph,
            null,
            "One setting below, and it belongs to the one provider that needs something of yours: " +
            "Google Apps Script. It is read only when you have picked that provider, is stored " +
            "locally in this client's own settings, is sent only to script.google.com, and is " +
            "never shared with anyone — this app ships no key, no URL and no account of its own."
        ),
        React.createElement(
            Paragraph,
            null,
            "Both options are free and neither can bill you. Google (free) needs nothing at all. " +
            "Google Apps Script is a small proxy you deploy once into your own Google account, " +
            "with no API key and no card on file — its daily allowance is yours rather than " +
            "shared with everyone using the free endpoint. It is more setup than picking the " +
            "default, which is what the guide is for."
        ),
        // No target, no button. A control whose only outcome is a failure is
        // worse than the sentence that replaces it.
        target && React.createElement(
            Button,
            {
                size: "small",
                variant: "secondary",
                onClick: () => openGuide(target)
            },
            GUIDE_BUTTON_LABEL[target.kind]
        ),
        blurb !== "" && React.createElement(Paragraph, null, blurb)
    );
}

export const settings = definePluginSettings({
    targetLanguage: {
        type: OptionType.SELECT,
        description:
            "Language to translate into. These are the languages this app supports — the same " +
            "list the floating panel offers. It is a list rather than a text box on purpose: " +
            "a provider returns a 400 for a language code it does not recognise, and a code you " +
            "cannot type is a 400 you cannot cause.",
        options: TARGET_LANGUAGES
    },
    mode: {
        type: OptionType.SELECT,
        description: "How translations are shown",
        options: [
            { label: "Replace the original", value: "replace", default: true },
            { label: "Show both languages", value: "bilingual" }
        ]
    },
    provider: {
        type: OptionType.SELECT,
        description:
            "Translation provider. Both are free and neither can bill you — the two paid " +
            "options that used to be here, DeepL and Google Cloud Translation, have been " +
            "removed. Google (free) is Google's unofficial gtx endpoint: no key, no signup, no " +
            "guarantee, and it can rate-limit you. Google Apps Script is a proxy you deploy once " +
            "into your own Google account — still no key and no card, but the daily allowance is " +
            "yours rather than shared with everyone else using the free endpoint. Pick Apps " +
            "Script and you must fill in its Web App URL in the credentials section below.",
        options: PROVIDER_OPTIONS
    },
    // The credential setting below is a section, not a loose box. The component
    // is the only thing a flat list of controls can use to say so, and it is also
    // where the setup guide is reachable from.
    credentials: {
        type: OptionType.COMPONENT,
        component: () => React.createElement(CredentialsSection)
    },
    appsScriptUrl: {
        type: OptionType.STRING,
        description:
            "GOOGLE APPS SCRIPT — the deployment URL of the proxy you deployed to your own Google " +
            "account. Read only when Provider is Google Apps Script. It is the Web App URL the " +
            "deployment gives you, of the form " +
            "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec, deployed with " +
            "\"Execute as: Me\" and \"Who has access: Anyone\". There is no API key and no card: a " +
            "consumer Google account allows about 5,000 translation calls a day, and going past " +
            "that fails the request rather than charging you, because Apps Script has no billing " +
            "at all. Stored locally on this machine, sent only to script.google.com, and never " +
            "shared — this app ships no proxy of its own and deploys nothing for you. The " +
            "deployment steps are in the setup guide; the section above says where this build " +
            "can reach it.",
        default: "",
        isValid: (value: string) => appsScriptUrlProblem(value) ?? true
    },
    // deeplApiKey, googleCloudApiKey, usageSummary and monthlyCharacterCap used
    // to sit here. They went with the two paid providers: there is no API key
    // left to store, no spend to meter, and nothing for a cap to refuse. Note
    // that removing a setting does NOT erase what a user already had in it — any
    // key they pasted before this change is still in this client's settings file
    // under its old name, unread by anything. Deleting stored values is a
    // migration, not a settings edit, and it is not done here.

    // The one switch that turns DMs on. The per-server panel toggle cannot: a DM
    // has no guild id to toggle. This setting is read only through
    // core/modes.ts's translationEnabled(), which both the rendered path and the
    // double-click path go through — it governed nothing at all until they did,
    // while the first-run notice in index.tsx and PRIVACY.md both described it
    // as working.
    includeDMs: {
        type: OptionType.BOOLEAN,
        description:
            "Also translate direct messages, including group DMs. This sends private messages to " +
            "your translation provider — Google's free endpoint, or the Apps Script deployment in " +
            "your own Google account. Off by " +
            "default, and it is the only control that turns DMs on — the per-server panel toggle " +
            "cannot reach a DM. It governs the whole plugin: channel translation and double-click " +
            "translation alike.",
        default: false
    },
    consentGiven: {
        type: OptionType.BOOLEAN,
        description: "First-run notice acknowledged",
        default: false,
        hidden: true
    },
    serverState: {
        type: OptionType.STRING,
        description: "Which servers have translation on (managed by the panel)",
        default: "[]",
        hidden: true
    },
    cacheBlob: {
        type: OptionType.STRING,
        description: "Persisted translation cache (managed automatically)",
        default: "[]",
        hidden: true
    },
    /**
     * Bookkeeping, not a second URL field.
     *
     * `hidden: true` is honoured: src/api/PluginManager.ts's isSettingHidden()
     * reads the flag, and src/components/settings/tabs/plugins/PluginModal.tsx
     * line 124 returns null for a setting it reports on — so this renders no
     * control at all in the plugin cog, exactly like the three bookkeeping
     * settings above it. Checked by reading those two files rather than assumed;
     * the same pair is what keeps cacheBlob invisible today.
     *
     * A SECOND VISIBLE BOX WOULD BE THE DEFECT. appsScriptUrl is the one the user
     * types into. If this one rendered, the settings screen would show two Apps
     * Script URL fields with no way to tell which is read, and a user would
     * reasonably edit the wrong one.
     *
     * "LAST GOOD" IS MEANT LITERALLY. It is written only after
     * validateAppsScriptUrl() in state.ts has resolved { ok: true } — i.e. after
     * a real request reached the deployment and came back with a translation. It
     * is never written on typing, on blur, or on save, so it can never mean
     * "last thing pasted". Anything that starts writing it from a field's
     * onChange has broken the only promise the name makes.
     */
    lastGoodAppsScriptUrl: {
        type: OptionType.STRING,
        description:
            "The last Apps Script deployment URL that was VERIFIED to work — written only after " +
            "a check actually reached the deployment and got a translation back, never merely " +
            "because a URL was typed or saved. Bookkeeping kept by the plugin, not a setting to " +
            "edit: paste your deployment URL into the Apps Script field above instead. Stored " +
            "locally on this machine like the URL itself, and never shared.",
        default: "",
        hidden: true
    }
});

// usageStore() used to live here — two functions over an opaque string, so
// core/usage.ts could persist the spend meter without ever learning what a
// Discord setting is. Both the meter and the usageBlob setting it wrote to are
// gone with the paid providers, and nothing else needed that indirection.
