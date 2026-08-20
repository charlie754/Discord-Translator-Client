/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createDeeplProvider } from "./deepl";
import { createGoogleProvider } from "./google";
import type { HttpTransport, ProviderConfig, ProviderFactory, ProviderResolution } from "./types";

export const registry = new Map<string, ProviderFactory>([
    ["google", createGoogleProvider],
    ["deepl", createDeeplProvider]
]);

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
        return {
            ok: false,
            reason:
                `${provider.label} needs an API key of your own before it can translate. ` +
                "Add it under Settings → Plugins → ChannelTranslator, or switch Provider back to Google (free)."
        };
    }

    return { ok: true, provider };
}
