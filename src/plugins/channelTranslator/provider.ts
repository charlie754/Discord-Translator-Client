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
 * The provider the user has selected, or the reason it is unusable.
 *
 * MUST NOT be called at module scope — reading settings.store during module
 * evaluation throws before the plugin is initialised.
 */
export function currentProvider(http: HttpTransport): ProviderResolution {
    return resolveProvider(settings.store.provider, http, {
        apiKey: settings.store.deeplApiKey
    });
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
