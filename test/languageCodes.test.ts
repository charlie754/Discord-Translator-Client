/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The BCP-47 -> translate-v2 mapping table, tested where it now lives.
 *
 * These cases were written in test/googleCloudProvider.test.ts, because
 * toLanguageCode() was written inside the paid Cloud Translation provider. That
 * provider is gone; the table is not. It moved to
 * core/providers/languageCodes.ts and its ONE remaining caller is
 * core/providers/appsScript.ts — a free provider — because a user's Apps Script
 * deployment forwards to Google's own translate surface and therefore speaks the
 * same code vocabulary.
 *
 * So the mapping is still live product behaviour on a free path, and deleting
 * the paid provider's test file must not take its coverage with it. The
 * assertions below are the ones that were there, unchanged.
 */

import { describe, expect, it } from "vitest";

import { toLanguageCode } from "../src/plugins/channelTranslator/core/providers/languageCodes";

describe("language mapping", () => {
    it.each([
        // The one that matters most: "zh" alone returns Simplified to someone who
        // explicitly asked for Traditional.
        ["zh-TW", "zh-TW"],
        ["zh-tw", "zh-TW"],
        ["zh-HK", "zh-TW"],
        ["zh-Hant", "zh-TW"],
        ["zh", "zh-CN"],
        ["zh-CN", "zh-CN"],
        ["zh-Hans", "zh-CN"],
        // v2's language list uses the legacy spellings for these three.
        ["he", "iw"],
        ["jv", "jw"],
        ["fil", "tl"],
        // Everything else is the base subtag; v2 would 400 on a region it does not know.
        ["en", "en"],
        ["en-GB", "en"],
        ["pt-BR", "pt"],
        ["ja", "ja"],
        ["  ES  ", "es"]
    ])("maps %s to %s", (tag, expected) => {
        expect(toLanguageCode(tag)).toBe(expected);
    });

    it("would notice a table that stopped mapping (positive control)", () => {
        // The shape of the regression: the naive transform alone, which returns
        // "zh" for zh-TW and hands Simplified to someone who asked for Traditional.
        const naive = (tag: string) => tag.trim().toLowerCase().split("-")[0];
        expect(naive("zh-TW")).not.toBe(toLanguageCode("zh-TW"));
        expect(naive("he")).not.toBe(toLanguageCode("he"));
    });
});
