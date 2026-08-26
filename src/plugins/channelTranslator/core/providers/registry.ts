/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createAppsScriptProvider } from "./appsScript";
import { createDeeplProvider } from "./deepl";
import { createGoogleProvider } from "./google";
import { createGoogleCloudProvider } from "./googleCloud";
import type { HttpTransport, ProviderConfig, ProviderFactory, ProviderResolution } from "./types";

export const registry = new Map<string, ProviderFactory>([
    ["google", createGoogleProvider],
    ["deepl", createDeeplProvider],
    // The paid Google API on translation.googleapis.com — a different host and a
    // different endpoint from the keyless "google" above, not a variant of it.
    ["google-cloud", createGoogleCloudProvider],
    // A proxy the USER deploys on their own Google account, on script.google.com.
    // Keyed like the two above, except that the "key" is the deployment URL — see
    // the header of ./appsScript for why that is the same kind of secret.
    ["apps-script", createAppsScriptProvider]
]);

/**
 * What a key-requiring provider actually wants, for the refusal message below.
 *
 * "API key" is right for DeepL and for Google Cloud and WRONG for Apps Script,
 * whose credential is a deployment URL. Sending a user to the settings to look
 * for an API key that does not exist is the same silent-failure shape this
 * refusal exists to prevent, one step further along: they would find the field,
 * fail to recognise it, and conclude the plugin was broken.
 *
 * A map keyed by provider id rather than a field on TranslationProvider, because
 * this is wording for one message and does not belong in the interface every
 * provider implements.
 */
const CREDENTIAL_NOUN: Readonly<Record<string, string>> = {
    "apps-script": "a Web App URL"
};

/** What every other key-requiring provider wants, and the wording this message has always used. */
const DEFAULT_CREDENTIAL_NOUN = "an API key";

/**
 * Construct the selected provider, or say — in words the caller can put in front
 * of the user — why it cannot be used.
 *
 * A key-requiring provider with no key is refused HERE rather than left to fail
 * at request time. Selecting DeepL without pasting a key would otherwise look
 * exactly like a working configuration while producing nothing: every request
 * 403s, the scheduler retries, the breaker opens, and the panel then reports
 * "Rate limited" for what is actually a missing key. Callers MUST surface
 * `reason` — dropping it reinstates the silent failure this exists to prevent.
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
            reason:
                `${provider.label} needs ${noun} of your own before it can translate. ` +
                "Add it under Settings → Plugins → ChannelTranslator, or switch Provider back to Google (free)."
        };
    }

    return { ok: true, provider };
}
