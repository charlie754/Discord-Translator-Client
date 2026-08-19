/**
 * FNV-1a over UTF-16 code units. Not cryptographic — this is a cache key.
 * Chosen over crypto.subtle because the core must stay synchronous and
 * environment-free (it runs in a renderer, in Node under Vitest, and later
 * in a browser extension).
 */
export function hashContent(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}
