/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/provider.ts — the adapter between plugin settings and the Discord-free
// provider registry in core/. Lives outside core/ deliberately: it reads
// settings and shows Discord notices, neither of which core/ may know about.
import { popNotice, showNotice } from "@api/Notices";

import { resolveProvider } from "./core/providers/registry";
import type { HttpTransport, ProviderResolution } from "./core/providers/types";
import { settings } from "./settings";

/**
 * The key that belongs to this provider, and only to it.
 *
 * Each key-requiring provider reads its OWN setting. Handing every provider the
 * same field would do worse than confuse: selecting Google Cloud with only a
 * DeepL key configured would satisfy the registry's needs-a-key check and then
 * send the user's DeepL credential to Google. A provider with no key of its own
 * gets undefined, which is what resolveProvider() refuses on.
 *
 * EVERY id in the registry that reports needsKey must have a case here. A missing
 * case is not a compile error and does not look like a bug from either side: the
 * provider appears in the settings dropdown, the user fills in its field, and
 * every translation is refused with "needs a … of your own" for a credential they
 * can see they have already entered. "apps-script" shipped in exactly that state.
 * Its credential is a deployment URL rather than a key — see the header of
 * core/providers/appsScript.ts for why that URL is the same kind of secret — and
 * it travels in the same ProviderConfig.apiKey field the other two use.
 *
 * MUST NOT be called at module scope, like everything else that reads settings.
 */
function apiKeyFor(providerId: string): string | undefined {
    switch (providerId) {
        case "deepl": return settings.store.deeplApiKey;
        case "google-cloud": return settings.store.googleCloudApiKey;
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
