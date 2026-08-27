/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * BCP-47 -> the language codes Google's translate v2 REQUEST SHAPE expects.
 *
 * WHY THIS FILE EXISTS AT ALL. This table and toLanguageCode() were written
 * inside core/providers/googleCloud.ts, the paid Cloud Translation provider,
 * because that is where they were first needed. appsScript.ts then imported them
 * — correctly, because the Apps Script proxy speaks the SAME v2 vocabulary: the
 * user's deployment forwards to Google's own LanguageApp/Translate surface, so a
 * code v2 rejects is a code the proxy rejects.
 *
 * googleCloud.ts has since been deleted along with every provider that could
 * bill the user. The table had nothing to do with billing, so it moved here
 * rather than dying with its old home, and it now lives beside its one remaining
 * caller instead of inside a provider.
 */

/**
 * Translate v2 mostly wants ISO-639-1, so the naive "drop the region subtag"
 * transform is right for nearly everything. This table is only the cases where
 * it is WRONG in a way the user would notice:
 *
 *   - Chinese has no single code. zh-TW must survive as zh-TW, because "zh"
 *     alone returns Simplified to someone who explicitly asked for 繁體中文.
 *   - Hebrew is "iw" in v2's language list, a legacy ISO-639-1 spelling. "he" is
 *     accepted by newer surfaces but "iw" is the one v2 documents, so it is the
 *     one sent.
 *   - Javanese is "jw" in v2, not the modern "jv".
 *   - Filipino is "tl" in v2, not "fil".
 *
 * Portuguese is deliberately NOT here: v2's own language list is "pt", and
 * sending a region subtag it does not know is a 400 rather than a nicer result.
 */
const LANGUAGE: Readonly<Record<string, string>> = {
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    "zh-sg": "zh-CN",
    "zh-tw": "zh-TW",
    "zh-hk": "zh-TW",
    "zh-mo": "zh-TW",
    "zh-hant": "zh-TW",
    he: "iw",
    iw: "iw",
    jv: "jw",
    fil: "tl"
};

/**
 * BCP-47 tag -> the code v2 expects.
 *
 * An unmapped region subtag is reachable in ordinary use. Dropping the subtag
 * beats forwarding a code the API will reject: "pt-BR" becomes "pt" and
 * translates, where the untouched tag would 400 and the user would see nothing
 * at all.
 */
export function toLanguageCode(tag: string): string {
    const key = tag.trim().toLowerCase();
    return LANGUAGE[key] ?? key.split("-")[0];
}
