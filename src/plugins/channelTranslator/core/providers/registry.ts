/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createAppsScriptProvider } from "./appsScript";
import { createGoogleProvider } from "./google";
import type { HttpTransport, ProviderConfig, ProviderFactory, ProviderResolution } from "./types";

/**
 * EVERY PROVIDER THIS PLUGIN CAN USE, AND ALL OF THEM ARE FREE.
 *
 * This map used to hold four. The two that are gone — DeepL and Google Cloud
 * Translation v2 — each took an API key of the user's own and billed them for
 * every character sent. Operator ruling: they are removed entirely rather than
 * left in and discouraged, so that no configuration of this plugin can put a
 * charge on anyone.
 *
 * That promise is a property of THIS MAP. A provider that is not in here cannot
 * be selected, cannot be constructed and cannot be reached by any caller,
 * because resolveProvider() below is the only way one is built. Anything added
 * here in future either keeps the promise or breaks it, and nothing downstream
 * will catch the difference: the spend meter and the monthly character cap that
 * used to sit behind this map were deleted along with the providers they existed
 * for.
 */
export const registry = new Map<string, ProviderFactory>([
    // Google's keyless gtx endpoint. No key, no signup, no account and no bill —
    // and no guarantee either: it is unofficial and it rate-limits.
    ["google", createGoogleProvider],
    // A proxy the USER deploys on their own Google account, on script.google.com.
    // Keyed like a credentialled provider, except that the "key" is the
    // deployment URL — see the header of ./appsScript for why that is the same
    // kind of secret. Apps Script has no billing at all: past the daily
    // allowance a request fails rather than costing anything.
    ["apps-script", createAppsScriptProvider]
]);

/**
 * What a key-requiring provider actually wants, for the refusal message below.
 *
 * Apps Script is the only entry, and it is now also the only key-requiring
 * provider left: its credential is a deployment URL, not an API key. Sending a
 * user to the settings to look for an API key that does not exist is the same
 * silent-failure shape this refusal exists to prevent, one step further along —
 * they would find the field, fail to recognise it, and conclude the plugin was
 * broken.
 *
 * Still a map keyed by provider id rather than a field on TranslationProvider,
 * because this is wording for one message and does not belong in the interface
 * every provider implements. One row does not change that.
 */
const CREDENTIAL_NOUN: Readonly<Record<string, string>> = {
    "apps-script": "a Web App URL"
};

/** The generic wording, for any future key-requiring provider that does not name its own. */
const DEFAULT_CREDENTIAL_NOUN = "an API key";

/**
 * Construct the selected provider, or say — in words the caller can put in front
 * of the user — why it cannot be used.
 *
 * A key-requiring provider with no key is refused HERE rather than left to fail
 * at request time. Selecting Google Apps Script without pasting its deployment
 * URL would otherwise look exactly like a working configuration while producing
 * nothing: every request fails, the scheduler retries, the breaker opens, and
 * the panel then reports "Rate limited" for what is actually a missing URL.
 * Callers MUST surface `reason` — dropping it reinstates the silent failure this
 * exists to prevent.
 */
export function resolveProvider(
    id: string,
    http: HttpTransport,
    config: ProviderConfig = {}
): ProviderResolution {
    const make = registry.get(id);
    if (!make) return { ok: false, reason: `Unknown translation provider "${id}".` };

    const provider = make(http, config);
    if (provider.needsKey && !(config.apiKey ?? "").trim()) {
        const noun = CREDENTIAL_NOUN[provider.id] ?? DEFAULT_CREDENTIAL_NOUN;
        return {
            ok: false,
            // BOTH NAMES IN THIS SENTENCE ARE DROPDOWN ENTRIES, and a user acts on
            // them: one says which choice is refusing, the other says which choice
            // works right now. `provider.label` carries the first — see the note on
            // appsScript.ts's label for why that field is user-facing rather than
            // an engineering name — and the second is written out, because nothing
            // under core/ may import settings.ts to look it up. It said
            // "Google (free)" while the dropdown offered "Google (free, shared)",
            // which is an instruction to select something that is not there.
            // test/pluginNamesLiveControls.test.ts checks this exact sentence
            // against the live PROVIDER_OPTIONS.
            reason:
                `${provider.label} needs ${noun} of your own before it can translate. ` +
                "Add it under Settings → Plugins → ChannelTranslator, or switch Provider back " +
                "to Google (free, shared)."
        };
    }

    return { ok: true, provider };
}
