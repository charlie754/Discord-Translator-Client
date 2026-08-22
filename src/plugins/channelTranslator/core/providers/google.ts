/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { TranslateResult } from "../types";
import type { HttpTransport, TranslationProvider } from "./types";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

/**
 * The gtx endpoint carries the text in the query string, so what it actually
 * limits is URL length, not character count. Measured against the live endpoint by
 * binary search: a request URL of 16352 characters succeeds and 16514 fails with
 * HTTP 400, i.e. the ceiling is 16 KiB of URL. ASCII text built to the same URL
 * length also succeeds, which is what rules out a character limit.
 *
 * That distinction matters because encodeURIComponent inflates CJK about ninefold
 * — one Chinese character becomes nine URL characters — so a 1800-character
 * Chinese message is over the line while an English message of the same length is
 * nowhere near it. Discord allows 2000 characters, and 4000 with Nitro, so this is
 * reachable in ordinary use rather than an edge case.
 *
 * Before this guard existed the request simply 400ed, the scheduler retried it
 * three times because nothing marked a 4xx as permanent, and five such messages
 * latched the circuit breaker for the rest of the session.
 *
 * 15000 leaves room for the query prefix and for longer language codes.
 */
const MAX_URL_LENGTH = 15_000;

/** Sentinels from core/protect.ts. Splitting inside one would corrupt a mention. */
const SENTINEL = /\uE000\d+\uE001/g;

/** Prefer a break the reader would also have made. */
const SOFT_BREAK = /(?<=[。．.!?！？;；\n])/;

function urlFor(text: string, from: string, to: string): string {
    return `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(from)}` +
        `&tl=${encodeURIComponent(to)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;
}

/**
 * Split text into pieces each of which fits in one request URL.
 *
 * Works on atoms rather than characters: a protect() sentinel is indivisible, and
 * everything between sentinels is split at sentence ends first, then at spaces,
 * and only then mid-word. A chunk boundary is always between atoms, so a sentinel
 * can never be cut in half.
 */
export function chunkForUrl(text: string, from: string, to: string): string[] {
    if (urlFor(text, from, to).length <= MAX_URL_LENGTH) return [text];

    const atoms: string[] = [];
    let last = 0;
    for (const m of text.matchAll(SENTINEL)) {
        if (m.index! > last) atoms.push(...text.slice(last, m.index).split(SOFT_BREAK));
        atoms.push(m[0]);
        last = m.index! + m[0].length;
    }
    if (last < text.length) atoms.push(...text.slice(last).split(SOFT_BREAK));

    const chunks: string[] = [];
    let current = "";

    const fits = (s: string) => urlFor(s, from, to).length <= MAX_URL_LENGTH;

    for (let atom of atoms) {
        if (!atom) continue;

        // An atom too big on its own has no soft break in it - a wall of text with no
        // sentence ending. Emit the largest prefix that fits and carry the rest.
        //
        // No sentinel can be cut here: atoms are produced by splitting AROUND
        // sentinels, so an atom is either one whole sentinel (five characters, which
        // always fits) or a run containing none at all.
        while (!fits(atom)) {
            if (current) { chunks.push(current); current = ""; }

            let lo = 1;
            let hi = atom.length;
            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (fits(atom.slice(0, mid))) lo = mid;
                else hi = mid - 1;
            }

            chunks.push(atom.slice(0, lo));
            atom = atom.slice(lo);
        }

        if (current && !fits(current + atom)) {
            chunks.push(current);
            current = atom;
        } else {
            current += atom;
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

/**
 * The free, unauthenticated gtx endpoint. No key, no contract, no SLA — which
 * is exactly why the provider registry exists. Do NOT adopt Vencord's shared
 * hardcoded key: channel-scale traffic would risk revoking it for everyone.
 */
export function createGoogleProvider(http: HttpTransport): TranslationProvider {
    return {
        id: "google",
        label: "Google (free)",
        needsKey: false,

        async translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> {
            const results: TranslateResult[] = [];
            for (const text of texts) {
                // Long messages are sent as several requests and rejoined, because one
                // request cannot exceed the endpoint's URL ceiling. Short messages —
                // almost all of them — take the single-chunk path unchanged.
                const pieces: string[] = [];
                let firstSrc = "auto";
                let firstConfidence = 0;

                for (const [i, chunk] of chunkForUrl(text, from, to).entries()) {
                const url = urlFor(chunk, from, to);

                const res = await http(url);
                if (res.status !== 200) {
                    throw Object.assign(new Error(`google: HTTP ${res.status}`), {
                        status: res.status,
                        retryAfterMs: res.retryAfterMs
                    });
                }

                const parsed = JSON.parse(res.body) as {
                    sentences?: Array<{ trans?: string }>;
                    src?: string;
                    confidence?: number;
                };
                if (!Array.isArray(parsed.sentences)) {
                    throw new Error("google: response had no sentences array");
                }

                pieces.push(parsed.sentences.map(s => s.trans ?? "").join(""));
                if (i === 0) {
                    firstSrc = parsed.src ?? "auto";
                    firstConfidence = parsed.confidence ?? 0;
                }
                }

                results.push({
                    text: pieces.join(""),
                    sourceLang: firstSrc,
                    confidence: firstConfidence
                });
            }
            return results;
        }
    };
}
