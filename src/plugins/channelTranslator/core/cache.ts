/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface CacheEntry {
    text: string;
    sourceLang: string;
    confidence: number;
}

/**
 * LRU keyed by contentHash + targetLang — never by message id. Ten messages
 * with identical text cost one translation, and the cache survives a reload
 * so toggling on does not re-translate the whole scrollback from scratch.
 */
export class TranslationCache {
    private map = new Map<string, CacheEntry>();

    constructor(private readonly max: number = 5000) {}

    private static key(hash: string, lang: string): string {
        return `${hash}:${lang}`;
    }

    get(hash: string, lang: string): CacheEntry | undefined {
        const k = TranslationCache.key(hash, lang);
        const hit = this.map.get(k);
        if (hit === undefined) return undefined;
        // Re-insert to mark as most recently used.
        this.map.delete(k);
        this.map.set(k, hit);
        return hit;
    }

    set(hash: string, lang: string, entry: CacheEntry): void {
        const k = TranslationCache.key(hash, lang);
        if (this.map.has(k)) this.map.delete(k);
        this.map.set(k, entry);
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    get size(): number {
        return this.map.size;
    }

    serialise(): string {
        return JSON.stringify([...this.map.entries()]);
    }

    static deserialise(json: string, max = 5000): TranslationCache {
        const cache = new TranslationCache(max);
        try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) return cache;
            for (const pair of parsed) {
                if (Array.isArray(pair) && typeof pair[0] === "string") {
                    cache.map.set(pair[0], pair[1] as CacheEntry);
                }
            }
            // Enforce the capacity constraint after loading all entries.
            while (cache.map.size > max) {
                const oldest = cache.map.keys().next().value;
                if (oldest === undefined) break;
                cache.map.delete(oldest);
            }
        } catch {
            // A corrupt cache is not an error condition — start empty.
        }
        return cache;
    }

    /** Repopulate from persisted JSON. Used to hydrate after plugin start. */
    loadFrom(json: string): void {
        this.map.clear();
        const revived = TranslationCache.deserialise(json, this.max);
        for (const [k, v] of revived.entries()) this.map.set(k, v);
    }

    /** Internal: exposes stored pairs for loadFrom. */
    entries(): IterableIterator<[string, CacheEntry]> {
        return this.map.entries();
    }
}
