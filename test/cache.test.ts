/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { TranslationCache } from "../src/plugins/channelTranslator/core/cache";

const entry = (text: string) => ({ text, sourceLang: "ja", confidence: 0.9 });

describe("TranslationCache", () => {
    it("returns undefined for a miss", () => {
        expect(new TranslationCache(10).get("abc", "en")).toBeUndefined();
    });

    it("stores and retrieves by hash and language", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        expect(c.get("abc", "en")?.text).toBe("hello");
    });

    it("treats the same hash with a different target language as a miss", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        expect(c.get("abc", "fr")).toBeUndefined();
    });

    it("serves ten identical messages from one entry", () => {
        const c = new TranslationCache(10);
        c.set("samehash", "en", entry("hello"));
        for (let i = 0; i < 10; i++) expect(c.get("samehash", "en")?.text).toBe("hello");
        expect(c.size).toBe(1);
    });

    it("evicts the least recently used entry past the cap", () => {
        const c = new TranslationCache(2);
        c.set("a", "en", entry("A"));
        c.set("b", "en", entry("B"));
        c.get("a", "en");                  // 'a' is now most recent
        c.set("c", "en", entry("C"));      // evicts 'b'
        expect(c.get("a", "en")).toBeDefined();
        expect(c.get("b", "en")).toBeUndefined();
        expect(c.get("c", "en")).toBeDefined();
    });

    it("survives a serialise / deserialise round trip", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        const revived = TranslationCache.deserialise(c.serialise(), 10);
        expect(revived.get("abc", "en")?.text).toBe("hello");
    });

    it("deserialises garbage into an empty cache rather than throwing", () => {
        expect(TranslationCache.deserialise("not json", 10).size).toBe(0);
    });

    it("enforces the cap when deserialising more entries than max", () => {
        const json = JSON.stringify([
            ["a:en", { text: "A", sourceLang: "ja", confidence: 0.9 }],
            ["b:en", { text: "B", sourceLang: "ja", confidence: 0.9 }],
            ["c:en", { text: "C", sourceLang: "ja", confidence: 0.9 }]
        ]);
        expect(TranslationCache.deserialise(json, 1).size).toBe(1);
    });

    it("keeps the most recent entries when deserialising over the cap", () => {
        const json = JSON.stringify([
            ["a:en", { text: "A", sourceLang: "ja", confidence: 0.9 }],
            ["b:en", { text: "B", sourceLang: "ja", confidence: 0.9 }],
            ["c:en", { text: "C", sourceLang: "ja", confidence: 0.9 }]
        ]);
        const c = TranslationCache.deserialise(json, 2);
        expect(c.get("a", "en")).toBeUndefined();
        expect(c.get("c", "en")?.text).toBe("C");
    });

    it("loadFrom repopulates an existing instance", () => {
        const c = new TranslationCache(10);
        c.set("x", "en", entry("X"));
        const other = new TranslationCache(10);
        other.set("a", "en", entry("A"));
        c.loadFrom(other.serialise());
        expect(c.get("a", "en")?.text).toBe("A");
        expect(c.get("x", "en")).toBeUndefined();
    });

    it("loadFrom enforces the cap", () => {
        const json = JSON.stringify([
            ["a:en", { text: "A", sourceLang: "ja", confidence: 0.9 }],
            ["b:en", { text: "B", sourceLang: "ja", confidence: 0.9 }],
            ["c:en", { text: "C", sourceLang: "ja", confidence: 0.9 }]
        ]);
        const c = new TranslationCache(2);
        c.loadFrom(json);
        expect(c.size).toBe(2);
    });

    it("loadFrom on garbage yields an empty cache, not a throw", () => {
        const c = new TranslationCache(10);
        c.set("x", "en", entry("X"));
        c.loadFrom("not json");
        expect(c.size).toBe(0);
    });
});
