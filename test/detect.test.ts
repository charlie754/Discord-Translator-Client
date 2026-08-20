/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { aggregate, shouldTranslate, splitJoined, SHORT_TEXT_THRESHOLD } from "../src/plugins/channelTranslator/core/detect";
import type { RawMessage } from "../src/plugins/channelTranslator/core/types";

const msg = (id: string, content: string, authorId = "u1"): RawMessage => ({
    id, authorId, channelId: "c1", guildId: "g1", content, contentHash: `h${id}`
});

describe("shouldTranslate", () => {
    it("translates when the source language is unknown", () => {
        expect(shouldTranslate(msg("1", "こんにちは"), "en")).toBe(true);
    });

    it("skips when the known source already equals the target", () => {
        expect(shouldTranslate(msg("1", "hello"), "en", "en")).toBe(false);
    });

    it("treats en-GB and en as the same language", () => {
        expect(shouldTranslate(msg("1", "hello"), "en", "en-GB")).toBe(false);
    });

    it("skips empty and whitespace-only messages", () => {
        expect(shouldTranslate(msg("1", "   "), "en")).toBe(false);
    });
});

describe("aggregate", () => {
    it("groups consecutive short messages from one author", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい"), msg("3", "うん")]);
        expect(batches.length).toBe(1);
        expect(batches[0].messages.length).toBe(3);
    });

    it("does not group across different authors", () => {
        const batches = aggregate([msg("1", "了解", "u1"), msg("2", "はい", "u2")]);
        expect(batches.length).toBe(2);
    });

    it("does not group long messages", () => {
        const long = "x".repeat(SHORT_TEXT_THRESHOLD + 1);
        const batches = aggregate([msg("1", long), msg("2", long)]);
        expect(batches.length).toBe(2);
    });

    it("caps a group at the max group size", () => {
        const many = Array.from({ length: 12 }, (_, i) => msg(String(i), "はい"));
        const batches = aggregate(many, { maxGroup: 5 });
        expect(batches.every(b => b.messages.length <= 5)).toBe(true);
    });

    it("joins grouped text with a separator that survives round-trip", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい")]);
        expect(batches[0].joined).toContain("了解");
        expect(batches[0].joined).toContain("はい");
    });

    it("returns one batch per message when nothing groups", () => {
        const long = "x".repeat(SHORT_TEXT_THRESHOLD + 1);
        expect(aggregate([msg("1", long)]).length).toBe(1);
    });
});

describe("splitJoined", () => {
    it("splits a translated group back into its parts", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい")]);
        const fake = batches[0].joined.replace("了解", "Understood").replace("はい", "Yes");
        const parts = splitJoined(fake, 2);
        expect(parts).not.toBeNull();
        expect(parts!.length).toBe(2);
        expect(parts![0]).toContain("Understood");
        expect(parts![1]).toContain("Yes");
    });

    it("returns null when the separator was destroyed, so the caller can retry individually", () => {
        expect(splitJoined("all one line no separator", 3)).toBeNull();
    });

    it("returns the whole string for a single-message batch", () => {
        expect(splitJoined("just one", 1)).toEqual(["just one"]);
    });

    it("never pads with empty strings", () => {
        const result = splitJoined("no separator here", 4);
        expect(result === null || !result.includes("")).toBe(true);
    });
});
