/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { TranslateResult } from "../types";
import type { HttpTransport, ProviderConfig, TranslationProvider } from "./types";

/**
 * DeepL splits its API across two hosts by plan, and a key is only valid on its
 * own host: a free key sent to api.deepl.com comes back 403, not "wrong host".
 * Free keys are suffixed ":fx" precisely so a client can route without asking
 * the user which plan they are on.
 */
const FREE_HOST = "https://api-free.deepl.com";
const PAID_HOST = "https://api.deepl.com";

/** Exported for the host allow-list audit and for tests; both hosts are declared in scripts/allowed-hosts.txt. */
export function endpointForKey(apiKey: string): string {
    return apiKey.trim().endsWith(":fx")
        ? `${FREE_HOST}/v2/translate`
        : `${PAID_HOST}/v2/translate`;
}

/**
 * DeepL does not speak BCP-47. It wants uppercase codes, it rejects region
 * subtags it does not know, and for the two cases that matter here the naive
 * uppercase is wrong in a way the user would notice: "zh-TW" uppercases to a
 * code DeepL refuses, and plain "ZH" silently returns Simplified to someone who
 * explicitly asked for 繁體中文.
 */
const TARGET_LANG: Readonly<Record<string, string>> = {
    en: "EN-US",
    "en-us": "EN-US",
    "en-gb": "EN-GB",
    zh: "ZH-HANS",
    "zh-cn": "ZH-HANS",
    "zh-hans": "ZH-HANS",
    "zh-tw": "ZH-HANT",
    "zh-hk": "ZH-HANT",
    "zh-hant": "ZH-HANT",
    pt: "PT-PT",
    "pt-pt": "PT-PT",
    "pt-br": "PT-BR"
};

/** BCP-47 tag -> DeepL target_lang. */
export function toTargetLang(tag: string): string {
    const key = tag.trim().toLowerCase();
    // targetLanguage is a free-text setting, so an unmapped region subtag is
    // reachable. Dropping it beats forwarding a code DeepL will 400 on.
    return TARGET_LANG[key] ?? key.split("-")[0].toUpperCase();
}

/** BCP-47 tag -> DeepL source_lang, which never carries a region subtag. */
export function toSourceLang(tag: string): string {
    return tag.trim().toLowerCase().split("-")[0].toUpperCase();
}

/** Statuses worth explaining rather than showing as a bare number. */
const STATUS_HINT: Readonly<Record<number, string>> = {
    403: " — DeepL rejected the API key",
    429: " — too many requests",
    456: " — DeepL quota exhausted for this billing period"
};

/**
 * DeepL, authenticated with a key the *user* supplies. This project never ships
 * or shares a credential, so an empty key is a hard error rather than a silent
 * no-op — see resolveProvider() in ./registry, which refuses to hand this
 * provider out at all until a key is set.
 *
 * The key travels as the `auth_key` query parameter rather than an
 * Authorization header, because HttpTransport is deliberately URL-only: the
 * main-process proxy in native.ts accepts a URL and nothing else, and widening
 * it to forward renderer-supplied headers would hand page scripts a header-
 * injection channel through the very guard that exists to prevent one. DeepL
 * documents auth_key as the legacy form; if they withdraw it, the fix is a
 * header allow-list in native.ts, not a general header passthrough.
 */
export function createDeeplProvider(http: HttpTransport, config: ProviderConfig = {}): TranslationProvider {
    const apiKey = (config.apiKey ?? "").trim();

    return {
        id: "deepl",
        label: "DeepL (your own key)",
        needsKey: true,

        async translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> {
            if (!apiKey) {
                throw new Error("deepl: no API key configured — set your DeepL key in the plugin settings");
            }

            const endpoint = endpointForKey(apiKey);
            const target = toTargetLang(to);
            const results: TranslateResult[] = [];

            for (const text of texts) {
                let url =
                    `${endpoint}?auth_key=${encodeURIComponent(apiKey)}` +
                    `&target_lang=${encodeURIComponent(target)}&text=${encodeURIComponent(text)}`;
                // Omitting source_lang is how DeepL is asked to auto-detect.
                if (from && from !== "auto") {
                    url += `&source_lang=${encodeURIComponent(toSourceLang(from))}`;
                }

                const res = await http(url);
                if (res.status !== 200) {
                    throw Object.assign(
                        new Error(`deepl: HTTP ${res.status}${STATUS_HINT[res.status] ?? ""}`),
                        { status: res.status, retryAfterMs: res.retryAfterMs }
                    );
                }

                const parsed = JSON.parse(res.body) as {
                    translations?: Array<{ text?: string; detected_source_language?: string; }>;
                };
                if (!Array.isArray(parsed.translations) || parsed.translations.length === 0) {
                    throw new Error("deepl: response had no translations array");
                }

                const [first] = parsed.translations;
                results.push({
                    text: first.text ?? "",
                    // Lowercased because everything downstream — the cache key and
                    // selection.ts's reverse-translate check — compares against
                    // lowercase BCP-47 tags, which is what the google provider returns.
                    sourceLang: (first.detected_source_language ?? "auto").toLowerCase(),
                    // DeepL reports no detection confidence. 0 is the same value the
                    // google provider uses when the field is absent; nothing gates on it.
                    confidence: 0
                });
            }
            return results;
        }
    };
}
