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
        description:
            "Translation provider. Google (free) is Google's unofficial gtx endpoint — no key, " +
            "no signup, no guarantee, and it can rate-limit you. DeepL is the escape hatch and " +
            "needs an API key of your own.",
        options: [
            { label: "Google (free)", value: "google", default: true },
            { label: "DeepL (your own key)", value: "deepl" }
        ]
    },
    deeplApiKey: {
        type: OptionType.STRING,
        description:
            "Your own DeepL API key. Used only when Provider is DeepL. Free keys end in ':fx' " +
            "and are routed to api-free.deepl.com; anything else goes to api.deepl.com. Stored " +
            "locally and sent only to DeepL — this app ships no key of its own and shares none.",
        default: ""
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
