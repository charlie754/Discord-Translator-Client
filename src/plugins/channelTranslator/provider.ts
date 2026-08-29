/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/provider.ts — the adapter between plugin settings and the Discord-free
// provider registry in core/. Lives outside core/ deliberately: it reads
// settings and shows Discord notices, neither of which core/ may know about.
import { popNotice, showNotice } from "@api/Notices";

import { registry, resolveProvider } from "./core/providers/registry";
import type { HttpTransport, ProviderResolution } from "./core/providers/types";
import { DEFAULT_PROVIDER_ID, providerName, PROVIDER_OPTIONS, settings } from "./settings";

/**
 * The credential that belongs to this provider, and only to it.
 *
 * Each key-requiring provider reads its OWN setting. This used to have three
 * cases and the switch was load-bearing for a security reason as well as a
 * correctness one: handing every provider the same field meant selecting Google
 * Cloud with only a DeepL key configured would satisfy the registry's
 * needs-a-key check and then send the user's DeepL credential to Google. Both
 * paid providers have since been deleted, so one case remains — but the shape
 * stays, because it is what makes the next provider's credential land in its own
 * field instead of inheriting Apps Script's deployment URL.
 *
 * EVERY id in the registry that reports needsKey must have a case here. A missing
 * case is not a compile error and does not look like a bug from either side: the
 * provider appears in the settings dropdown, the user fills in its field, and
 * every translation is refused with "needs a … of your own" for a credential they
 * can see they have already entered. "apps-script" shipped in exactly that state.
 * Its credential is a deployment URL rather than a key — see the header of
 * core/providers/appsScript.ts for why that URL is the same kind of secret — and
 * it travels in ProviderConfig.apiKey, which is the field a credential of any
 * kind travels in.
 *
 * MUST NOT be called at module scope, like everything else that reads settings.
 */
function apiKeyFor(providerId: string): string | undefined {
    switch (providerId) {
        case "apps-script": return settings.store.appsScriptUrl;
        // "google" is keyless; an unknown id is refused by resolveProvider anyway.
        default: return undefined;
    }
}

/**
 * The provider the user has selected, or the reason it is unusable.
 *
 * MUST NOT be called at module scope — reading settings.store during module
 * evaluation throws before the plugin is initialised.
 */
export function currentProvider(http: HttpTransport): ProviderResolution {
    const id = settings.store.provider;
    return resolveProvider(id, http, { apiKey: apiKeyFor(id) });
}

/**
 * The Apps Script provider built against a CANDIDATE deployment URL — the string
 * a user has typed but not yet committed to — rather than against the one in
 * settings.
 *
 * WHY THIS FUNCTION LIVES IN provider.ts AND NOWHERE ELSE, stated for the reader
 * who is about to move it next to its only caller in state.ts. It calls
 * resolveProvider(), and test/providerChokepoint.test.ts fails the moment any
 * file except this one IMPORTS that name:
 *
 *     "nothing outside provider.ts reaches past it into the provider registry"
 *
 * That rule is not about Apps Script. It is what keeps the registry behind this
 * single adapter so that state.ts's translationProvider() stays the one place a
 * provider is obtained — which is what makes "what does the plugin talk to?" a
 * question with exactly one answer, and what made the metering that used to be
 * applied there impossible for a caller to skip. The meter is gone with the paid
 * providers; the chokepoint is not, because it is also the only reason
 * settings-reading and credential-selection happen in one place instead of at
 * every call site. A copy of this function in state.ts would go red on that test
 * with a message about the registry, which is a confusing thing to read while
 * thinking about URLs — hence this paragraph.
 *
 * IT READS NO SETTINGS, and that is the whole of its difference from
 * currentProvider() above. Checking an endpoint the user has typed must not
 * consult the stored URL (it would check the wrong string) and must not write it
 * (nothing has been verified yet). The candidate arrives as an argument and
 * leaves as ProviderConfig.apiKey, which is the field the deployment URL travels
 * in — see the header of core/providers/appsScript.ts for why that URL is a
 * credential.
 *
 * The provider id is hard-coded to "apps-script" on purpose: it is the only
 * provider with a credential to verify at all. "google" is keyless, so there is
 * nothing for a check button to check. Generalising this to "whatever is
 * selected" would send a real request on behalf of a provider that never asked
 * for one.
 *
 * MUST NOT be called at module scope — resolveProvider() itself is safe, but its
 * only caller reads settings.
 */
export function appsScriptProviderFor(
    candidateUrl: string,
    http: HttpTransport
): ProviderResolution {
    return resolveProvider("apps-script", http, { apiKey: candidateUrl });
}

/**
 * Which reason has already been put in front of the user this session.
 * requestTranslation() runs per message, so an un-deduplicated notice would
 * stack one banner per message on screen.
 */
let reasonShown = "";

/** Surface an unusable-provider reason once per session per distinct reason. */
export function warnProviderUnavailable(reason: string): void {
    if (reason === reasonShown) return;
    reasonShown = reason;
    showNotice(`Discord Translator: ${reason}`, "OK", () => popNotice());
}

// The dropdown's own wording for a provider id used to be looked up by a local
// copy of this one-liner. It is settings.ts's providerName() now — the same
// derivation, in the one place every other user-facing sentence in this plugin
// also reads it from. Two identical lookups are two things to keep in step for
// no gain, and the notice below is exactly the kind of sentence the single
// spelling exists for.

/**
 * The provider the user USED to have, in a form safe to put in a banner.
 *
 * `unknown`, not `string`, on purpose. The setting is typed as a string, but
 * what is actually read back is whatever is in the settings file on disk — a
 * hand edit, a half-written sync, a value from a build this one has never seen.
 * A missing or non-string value still has to produce a sentence rather than
 * "undefined", and a very long one must not turn the notice into a wall of text.
 */
function formerProviderPhrase(id: unknown): string {
    const text = typeof id === "string" ? id.trim() : "";
    if (!text) return "The translation provider your settings had";

    const shown = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    return `The translation provider your settings had — "${shown}" —`;
}

/**
 * PUT A USER BACK ON A PROVIDER THAT WORKS, ONCE, AT START.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `provider` is a persisted STRING. Someone who deliberately chose one of the
 * paid providers still has that id on disk after they update to a build whose
 * registry no longer holds it, and resolveProvider() answers every single
 * translation with `Unknown translation provider "<id>".` — developer wording,
 * for a state the user cannot see and did not cause. It never heals: the id is
 * still there next launch. Worse, the settings dropdown cannot even show them
 * what is wrong, because SelectSetting.tsx picks the selected entry with
 * `isSelected={v => v === state}` over `setting.options` — an id absent from the
 * options list matches nothing, so the control renders its placeholder and
 * reads as simply unset. The people this hits are the ones who cared enough to
 * go and get an API key.
 *
 * ── THE RULE, AND WHY IT IS NOT A LIST OF DEAD IDS ───────────────────────────
 *
 * The condition is "the registry cannot serve this id", asked of the registry
 * itself. It is deliberately NOT a list of the providers that were removed:
 * such a list would have to be edited every time a provider goes, would be
 * silently wrong for a value that was corrupted rather than retired, and would
 * be one more copy of the truth that core/providers/registry.ts already holds.
 * Ask the map and the migration keeps working for removals nobody has made yet.
 *
 * `registry.has()` and NOT resolveProvider() — the two differ, and the
 * difference is the whole point. resolveProvider() also refuses a provider whose
 * credential is missing, which is a configuration a user can fix and may be in
 * the middle of. Migrating on that would silently move someone off Apps Script
 * the moment their Web App URL was blank, which is a second, worse bug.
 *
 * ── WHERE IT LIVES ───────────────────────────────────────────────────────────
 *
 * Here, because this file is already the one place that is allowed to hold all
 * three of the things this needs at once: it reads settings, it reaches into the
 * provider registry (test/providerChokepoint.test.ts fails if anything else
 * does), and it shows Discord notices. Putting it in settings.ts or index.tsx
 * would mean a second file reaching past this adapter into core/.
 *
 * It reuses warnProviderUnavailable() rather than calling showNotice() itself,
 * so there is still exactly one deduplicated door for "your provider is not
 * usable, here is what to do" — a second notice mechanism is how a user ends up
 * reading two banners about one problem.
 *
 * MUST NOT be called at module scope — it both reads and WRITES settings.store,
 * which throws before the plugin is initialised. start() is its only caller.
 */
export function migrateUnavailableProvider(): void {
    const current = settings.store.provider;
    if (registry.has(current)) return;

    // Prefer the dropdown's default. The fallback below is not decoration: if
    // the default itself were ever dropped from the registry, migrating TO it
    // would leave the user exactly as stuck as before, which is the one outcome
    // this function exists to rule out.
    const target = registry.has(DEFAULT_PROVIDER_ID)
        ? DEFAULT_PROVIDER_ID
        : registry.keys().next().value;

    // An empty registry has nothing to switch to. Nothing works in that build
    // either way, and overwriting the user's choice with a second broken value
    // would only lose information.
    if (target === undefined) return;

    settings.store.provider = target;

    // Free choices other than the one they were just moved to, so the notice can
    // point somewhere rather than only announcing. Filtered through the registry
    // for the same reason the condition above is: a dropdown entry is not proof
    // that a provider can translate.
    const others = PROVIDER_OPTIONS
        .filter(option => option.value !== target && registry.has(option.value))
        .map(option => option.label);

    const alternatives =
        others.length === 0
            ? ""
            : others.length === 1
                ? ` If you would rather run a free endpoint of your own, ${others[0]} is still ` +
                  "there in the same dropdown."
                : ` The other choices in the same dropdown — ${others.join(", ")} — are free too.`;

    // NOTHING HERE BLAMES THE READER OR CLAIMS A LOSS. They chose a provider
    // that was on offer at the time and it was withdrawn from under them; the
    // only new facts are what changed, that it costs nothing, and that the rest
    // of their settings are untouched. warnProviderUnavailable() prefixes
    // "Discord Translator: ", so this must not say it again.
    warnProviderUnavailable(
        `${formerProviderPhrase(current)} is no longer one this plugin offers, so translation ` +
        `has been switched to ${providerName(target)}. That needs no key, no account and no ` +
        "card, and it cannot bill you. Nothing else in your settings was changed and nothing " +
        `you saved was deleted.${alternatives}`
    );
}
