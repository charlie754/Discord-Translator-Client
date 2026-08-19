/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/settings.ts
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    targetLanguage: {
        type: OptionType.STRING,
        description: "Language to translate into (BCP-47, e.g. en, zh-TW, ja)",
        default: "en"
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
        description: "Translation provider",
        options: [{ label: "Google (free)", value: "google", default: true }]
    },
    includeDMs: {
        type: OptionType.BOOLEAN,
        description: "Also translate direct messages (sends private messages to the provider)",
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
    }
});
