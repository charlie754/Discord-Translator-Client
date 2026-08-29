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

// THE SINGLE AUTHORITY on what a valid Apps Script endpoint is, imported rather
// than re-implemented — see appsScriptUrlProblem() below for what re-implementing
// it cost. Safe in this direction and only this one: appsScript.ts imports
// ../scheduler, ../types, ./languageCodes and ./types, and NOTHING under core/
// imports settings.ts, so the plugin → core edge this adds is the one that was
// already there. It is a pure string check — no transport, no settings, no I/O —
// which is what makes it callable from a settings validator at all.
import { checkDeploymentUrl } from "./core/providers/appsScript";

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
 * EXPORTED BECAUSE THERE ARE TWO OTHER READERS. provider.ts's
 * migrateUnavailableProvider() has to tell a user which provider it moved them
 * TO, and the only human-readable name a provider id has anywhere in this
 * codebase is the label sitting right here — core/providers/registry.ts is keyed
 * by id and knows nothing about UI copy. A second copy of these labels over
 * there would drift the first time one is reworded, and the user would be told
 * they had been switched to something the dropdown does not call that. The
 * second reader is panel/EndpointModal.tsx, the small window the rate-limited
 * panel opens; it renders this array itself rather than listing the two
 * providers again, for the same reason.
 *
 * THE TWO NAMES ARE THE OPERATOR'S OWN WORDS, given verbatim and not to be
 * "improved": "Google (free, shared)" and "Google Free API". They replace
 * "Google (free)" and "Google Apps Script (your own free proxy)". Only the UI
 * copy moved — the ids below are untouched, so nothing a user has on disk, and
 * nothing core/providers/registry.ts is keyed by, changed with them. The
 * registry's own `label` fields (core/providers/google.ts, appsScript.ts) still
 * carry the old engineering names and are deliberately left alone: they name the
 * transport in developer-facing refusal text, not the choice on a dropdown.
 *
 * WHY THE FIRST NAME IS NO LONGER "Google Default Public Key". It named a key
 * that does not exist. That entry posts the message to the shared public
 * translate.googleapis.com gtx endpoint with NO key of any kind — not the
 * user's, not one baked into this bundle, not a "default" one belonging to
 * anybody — so a reader of the old name had to conclude a credential was in play
 * and go looking for where it was kept, and there is nowhere, because there is
 * none. "shared" replaces it because shared is the property that actually
 * predicts what the user will run into: that endpoint's allowance belongs to
 * everyone hitting it at once, which is WHY it rate-limits, which is why
 * panel/EndpointModal.tsx — the window the "Use your own free endpoint" button
 * opens — exists at all. The name now states the cause of the condition the rest
 * of this UI is built to get the user out of. The id is untouched, so nothing on
 * disk moved with the name.
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
    { label: "Google (free, shared)", value: "google", default: true },
    { label: "Google Free API", value: "apps-script" }
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
 * The project's own page, and the LAST RESORT for a build that carries no copy
 * of the guide anywhere.
 *
 * IT USED TO BE WHAT THE DESKTOP BUILD ALWAYS GOT, AND THAT WAS THE DEFECT.
 * With HOSTED_GUIDE_URL deliberately empty, every desktop click on "Setup Guide"
 * resolved here and opened the whole repository page — a repo, not a guide.
 * Operator: "In desktop version, Setup Guide should always link to a page which
 * dedicated on Setup Guide only, not entire repo page." The desktop build now
 * ships the guide beside itself and opens it in its own window (see the
 * "desktop" kind below), so this is reached only when there is genuinely nothing
 * else: no packaged copy, no bundled copy, no hosted address. Its wording is
 * still honest FOR THAT CASE, and must stay honest only about that case.
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

/** Which of the four possible sources a resolved guide target came from. */
export type GuideKind =
    /** The copy packaged inside the browser extension. The real guide. */
    | "packaged"
    /**
     * The copy bundled beside the desktop client, opened by the main process in
     * a window of its own. The real guide, and the only one that needs no
     * network at all.
     */
    | "desktop"
    /** HOSTED_GUIDE_URL, once the operator has set it. The real guide. */
    | "hosted"
    /** The project page. Where the guide LIVES, not the guide itself. */
    | "repo";

/**
 * What the control opens.
 *
 * A UNION RATHER THAN `url: string | null`, so that "there is no address" is a
 * state the type system enforces instead of a null every caller has to remember
 * to check. Three of the four kinds are addresses the renderer opens itself. The
 * fourth is not an address at all: the desktop guide is a file inside the
 * bundle, the main process is the only thing that knows where, and the renderer
 * is deliberately never told — see openGuide() below and the handler comment in
 * src/main/ipcMain.ts. Writing that as a string the renderer holds would be the
 * beginning of the renderer constructing a path.
 */
export type GuideTarget =
    | { url: string; kind: "packaged" | "hosted" | "repo"; }
    | { url: null; kind: "desktop"; };

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
 * The main-process bridge, or undefined on a build — or at a moment — that has
 * none.
 *
 * `typeof` rather than a truthiness test, because VencordNative is a global that
 * may never have been DECLARED, not one that is merely undefined: `VencordNative?.x`
 * on an unbound identifier throws a ReferenceError, which optional chaining does
 * not protect against. This runs inside a render, so it must not throw.
 */
function nativeBridge(): typeof VencordNative.native | undefined {
    const bridge = typeof VencordNative === "undefined" ? undefined : VencordNative;
    return bridge?.native;
}

/**
 * Whether THIS build carries its own copy of the guide and can open it in a
 * window of its own.
 *
 * ASKED OF THE MAIN PROCESS, NOT INFERRED FROM A BUILD FLAG. IS_DISCORD_DESKTOP
 * would answer a different question — "is this the desktop mod?" — and the two
 * come apart: site/ is untracked, so a desktop build made on a machine without
 * it is a working client with no guide inside it (scripts/build/build.mjs warns
 * and carries on rather than failing). Deriving this from the flag would put an
 * "Open the setup guide" button on that build whose only possible outcome is
 * nothing happening, which is the dead example.invalid link's defect wearing
 * different clothes.
 *
 * THE RENDERER NEVER LEARNS A PATH. The question is a yes/no and the open is a
 * no-argument call; src/main/ipcMain.ts owns the filename for both. That is the
 * same posture as the host allow-list in this plugin's native.ts — a capability
 * reachable from the page world is only safe while the page cannot aim it.
 *
 * MEMOISED ONLY ONCE THE BRIDGE EXISTS. Whether the bundle carries a file is a
 * fact about the process, so one answer is enough. But a "no" produced because
 * the bridge was not there yet is not that answer, and caching it would repeat
 * the EXTENSION_BASE_URL mistake documented on guideTarget() below in a new
 * place. A missing bridge is therefore re-asked; a real answer is kept.
 */
let bundledGuideAnswer: boolean | undefined;

function bundledGuideAvailable(): boolean {
    if (bundledGuideAnswer !== undefined) return bundledGuideAnswer;

    const native = nativeBridge();
    if (!native || typeof native.hasSetupGuide !== "function") return false;

    try {
        return bundledGuideAnswer = native.hasSetupGuide() === true;
    } catch (err) {
        // sendSync throws outright when the main process has no handler for the
        // channel — a renderer bundle newer than the main bundle, which is the
        // same partial-install case state.ts documents for pluginHelpers.
        console.error("[ChannelTranslator] Could not ask whether this build bundles the setup guide", err);
        return false;
    }
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

    // BEFORE the hosted address, not after it, and not merely because desktop is
    // the build that had no guide. A copy sitting in the bundle is the version
    // this exact build shipped with, it opens with no network at all, and it
    // cannot 404 the way a site can once it has been pointed somewhere. A hosted
    // URL is the fallback for builds that carry nothing, which is what
    // HOSTED_GUIDE_URL's own comment describes it as.
    if (bundledGuideAvailable()) {
        return { url: null, kind: "desktop" };
    }

    return resolveHostedOrRepo(HOSTED_GUIDE_URL, PROJECT_REPO_URL);
}

/*
 * THERE IS DELIBERATELY NO ADDRESS-ONLY ACCESSOR HERE.
 *
 * This file used to export guideUrl(), which returned `guideTarget()?.url ?? null`.
 * It was dead in both shipped bundles — tree-shaken out of dist/desktop/renderer.js
 * and dist/browser/browser.js, with its only remaining callers in this repo's own
 * tests — and it was a trap for the next caller who found it, because null is its
 * answer to TWO opposite states: nothing to open at all, and the desktop build's
 * bundled guide, whose url is null BY DESIGN because the renderer is never told
 * where the file is. Reading that null as "no guide" would hide the control on the
 * one build that definitely has a guide — the same defect the "desktop" kind exists
 * to fix, one accessor further out.
 *
 * So the address is only ever read off a target whose kind is in hand: take the
 * whole thing from guideTarget() and give it to openGuide() below, which is what
 * knows the two apart.
 */

/**
 * THE ONE WAY THE GUIDE IS OPENED, from either of the two screens that offer it.
 *
 * EXPORTED BECAUSE THERE IS A SECOND CALLER.
 * src/components/settings/tabs/vencord/index.tsx renders its own "→ Setup Guide"
 * link and used to do its own `window.open(guide.url, …)`. That stopped being
 * possible when a target gained the ability not to have a url at all, and it
 * should not have been duplicated in the first place: two call sites are two
 * places for the desktop branch to be forgotten.
 *
 * Takes the target it was rendered with rather than re-resolving, so the control
 * can never open something other than what its own label promised.
 *
 * The web kinds are opened with the same options the floating panel already uses
 * for external links (panel/Panel.tsx). `noopener` is the load-bearing half:
 * without it the opened document gets a `window.opener` handle back into the
 * logged-in discord.com page.
 *
 * NOTHING HERE MAY THROW. It runs inside an onClick handler, where an exception
 * is an unhandled rejection in the middle of Discord's own React tree, so the
 * missing-bridge case is logged rather than raised and the promise is caught.
 */
export function openGuide(target: GuideTarget): void {
    if (target.kind === "desktop") {
        const native = nativeBridge();
        if (!native || typeof native.openSetupGuide !== "function") {
            console.error("[ChannelTranslator] The setup guide cannot be opened: no native bridge");
            return;
        }

        // THE try/catch IS NOT REDUNDANT WITH THE .catch BELOW — they catch two
        // different failures, and only one of them is a rejected promise.
        // .catch handles openSetupGuide() REJECTING. This handles it THROWING
        // SYNCHRONOUSLY, or returning something that is not a promise at all: in
        // either case there is no promise to attach .catch to yet, so the
        // exception escapes past these lines and out of openGuide() into
        // Discord's own onClick handler — an unhandled rejection in the middle
        // of a React tree this plugin does not own. The contract above says
        // NOTHING HERE MAY THROW, and until this was added that held only for a
        // bridge that misbehaved politely. The sibling question hasSetupGuide()
        // is already known to throw for real when no handler is registered.
        try {
            native.openSetupGuide()
                .then(opened => {
                    // The main process answers false whenever the guide was not
                    // actually SHOWN: the file is not in this build, it was
                    // deleted from the bundle while the client was running, or
                    // it was found and then failed to load. Rare, and silent
                    // otherwise.
                    if (!opened) {
                        console.error("[ChannelTranslator] The setup guide could not be shown; nothing was opened");
                    }
                })
                .catch(err => console.error("[ChannelTranslator] Failed to open the setup guide", err));
        } catch (err) {
            console.error("[ChannelTranslator] The setup guide bridge threw when it was called", err);
        }
        return;
    }

    window.open(target.url, "_blank", "noopener,noreferrer");
}

/**
 * Why an Apps Script credential is unusable, or null if it looks like one.
 *
 * THIS FUNCTION NO LONGER DECIDES ANYTHING. It is an adapter, and the whole of
 * its judgement is checkDeploymentUrl()'s in core/providers/appsScript.ts. That
 * matters more than the four lines suggest: this used to be a SECOND PARSER over
 * the same setting, with its own idea of what a valid endpoint was, and the two
 * disagreed. The Apps Script section on the client settings tab took a bare
 * Deployment ID — the short value Google's own Deploy dialog puts a copy button
 * beside — while this box, the cog's own, answered the identical string with
 * "That is not a URL." and sent the user to the other screen to paste it. One
 * value, two authorities, two verdicts, and no mechanism that could ever have
 * made them agree except two people editing two rule sets in step.
 *
 * They now agree BY CONSTRUCTION rather than by maintenance. Every form
 * checkDeploymentUrl() accepts — the whole Web App URL, or the bare ID it
 * expands into one — this box accepts, on the day the provider learns it and
 * without an edit here. test/settingsValidatorDelegation.test.ts pins the
 * biconditional directly: appsScriptUrlProblem(x) === null exactly when
 * checkDeploymentUrl(x).ok, over a table that includes every refusal shape.
 *
 * THE REFUSAL TEXT IS PASSED THROUGH VERBATIM, not re-worded. checkDeploymentUrl()
 * already distinguishes the /dev URL from the editor URL from a wrong host from a
 * scheme-less paste from a truncated ID, and each refusal names the specific fix.
 * Re-wording any of them here would recreate the divergence in the copy instead of
 * the code. state.ts's validate button surfaces `shape.reason` the same way, so a
 * user meets identical wording whichever screen they are standing on.
 *
 * THE ONE DELIBERATE DIVERGENCE, and it is a contract difference rather than a
 * rule difference. An empty box is not an error — it is the default, and it is
 * what every user who has not chosen this provider has, so it must not paint the
 * cog red. checkDeploymentUrl("") is quite reasonably NOT ok, because its callers
 * are about to make a request and have nothing to send. So blank is answered here,
 * above the delegation, and never reaches it. That is the only input on which the
 * two functions differ, and the test table above asserts it explicitly rather than
 * excluding it.
 */
export function appsScriptUrlProblem(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;

    const shape = checkDeploymentUrl(trimmed);
    return shape.ok ? null : shape.reason;
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
    // The bundled copy IS the guide, so it is called the guide. The label makes
    // no promise about where it opens, because unlike the other three it does
    // not leave the app at all — it opens a window this client owns.
    desktop: "Open the setup guide",
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
        case "desktop":
        case "hosted":
            return "";
        // BOTH SENTENCES BELOW USED TO NAME THE EXTENSION AS THE ONLY BUILD THAT
        // CARRIES THE GUIDE, and both were shown on every desktop client, where
        // they were the reason the button opened a repository page. That is no
        // longer what a desktop build does: it bundles the guide and opens it in
        // its own window. These two are now reached only by a build that shipped
        // without the guide — an extension or desktop package built from a
        // checkout with no site/ directory, since site/ is untracked — so they
        // say that instead of blaming the build's shape.
        case "repo":
            return "This build shipped without a copy of the guide, so that opens the project " +
                "page instead — the guide is site/free/index.html there. The browser extension " +
                "and the desktop client both carry it when they are built from a checkout that " +
                "has it.";
        default:
            return "The setup guide is not reachable from this build: it ships inside the " +
                "browser extension and beside the desktop client, and this one carries no copy " +
                "and has no hosted address. Its source is site/free/index.html in the project's " +
                "repository.";
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
            // The two names below are the two labels in PROVIDER_OPTIONS, spelled the
            // same way here so this paragraph describes the entries the dropdown
            // above it actually shows. Each also carries the engineering name it
            // used to be listed under, because that is still what the setup guide,
            // Google's own console and this plugin's refusal messages call it — a
            // reader who arrived from any of those has to be able to tell which
            // entry is which.
            "Translation provider. Both are free and neither can bill you — the two paid " +
            "options that used to be here, DeepL and Google Cloud Translation, have been " +
            "removed. Google (free, shared), listed as Google (free) in earlier builds, is " +
            "Google's unofficial gtx endpoint: no key of any kind, no signup, no " +
            "guarantee, and the allowance is shared with everyone else using it — which is why " +
            "it can rate-limit you. Google Free API is a Google Apps Script " +
            "proxy you deploy once " +
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
            "GOOGLE APPS SCRIPT — the proxy you deployed to your own Google account. Its Deploy " +
            "dialog hands you two values for it, and Discord Translator takes either: the short " +
            "Deployment ID, which has its own copy button, or the whole Web App URL, of the form " +
            "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec. They name the same " +
            "deployment, and an ID is expanded into that URL before anything is sent, so this " +
            "box takes whichever one you have. A Google Workspace account must use the URL " +
            "either way, because its address carries the organisation's domain and that cannot " +
            "be recovered from the ID on its own. Read " +
            "only when Provider is Google Apps Script, and deployed with " +
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
    /*
     * `serverState` USED TO BE DECLARED HERE and is deliberately not any more.
     *
     * It held a JSON array of the guild ids with translation switched on, written
     * by persist() and read back by hydrate(). Operator ruling 2026-08-29:
     * "Default off shall persist across restart" — so the on/off decision is now
     * per session and lives only in the in-memory ToggleState. Both the read and
     * the write are gone from state.ts; this declaration went with them, because
     * a hidden setting nothing reads or writes is an invitation to wire it back up.
     *
     * WHAT HAPPENS TO THE VALUE ALREADY IN AN EXISTING USER'S CONFIG. Nothing, and
     * nothing needs to. The saved settings file is a plain object; a key with no
     * matching declaration is simply never read — definePluginSettings only ever
     * reaches for the ids it declares, and the plugin cog renders from the same
     * declarations, so a leftover `"serverState": "[\"123…\"]"` is inert rather
     * than an error. It is not migrated or deleted either: removing it would mean
     * writing a migration whose only effect is to make a file marginally tidier,
     * and this setting was `hidden: true`, so nobody ever sees it. The practical
     * consequence for such a user is exactly the intended one — the servers they
     * had on last session start off.
     */
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
