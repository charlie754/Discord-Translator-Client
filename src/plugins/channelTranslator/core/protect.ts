/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Protected {
    masked: string;
    tokens: string[];
}

/**
 * Private Use Area sentinels. Chosen because machine-translation engines pass
 * unknown PUA code points through untouched, whereas bracket-style markers like
 * [[0]] get reflowed, spaced, or translated. Task 12 verifies this against the
 * live endpoint rather than trusting it.
 */
const OPEN = "\uE000";
const CLOSE = "\uE001";

/**
 * Order matters. Fenced code must be consumed before inline code, and spoilers
 * before their inner content, or the inner pattern eats part of the outer one.
 */
const PATTERNS: RegExp[] = [
    /```[\s\S]*?```/g, // fenced code
    /\|\|[\s\S]*?\|\|/g, // spoiler
    /`[^`\n]+`/g, // inline code
    /<a?:\w+:\d+>/g, // custom / animated emoji
    /<@[!&]?\d+>/g, // user or role mention
    /<#\d+>/g, // channel mention
    /<t:\d+(?::[tTdDfFR])?>/g, // timestamp
    /https?:\/\/\S+/g // url
];

export function protect(text: string): Protected {
    const tokens: string[] = [];
    let masked = text;

    for (const pattern of PATTERNS) {
        masked = masked.replace(pattern, match => {
            tokens.push(match);
            return `${OPEN}${tokens.length - 1}${CLOSE}`;
        });
    }

    return { masked, tokens };
}

/**
 * Either delimiter is accepted on either side, which is not fussiness.
 *
 * Measured against the live gtx endpoint: for Chinese source text it returns the
 * OPEN sentinel in place of the CLOSE one, so a protected mention comes back as
 * OPEN 0 OPEN rather than OPEN 0 CLOSE. Japanese and English are returned intact.
 * With a strict pattern the match failed, and every mention, custom emoji, code
 * span, timestamp and URL in a translated Chinese message was left on screen as
 * raw private-use characters.
 *
 * Matching either delimiter costs nothing: these code points do not occur in real
 * message text, which is the assumption protect() already rests on.
 */
const DELIM = `[${OPEN}${CLOSE}]`;

export function restore(masked: string, tokens: string[]): string {
    return masked
        .replace(
            new RegExp(`${DELIM}(\\d+)${DELIM}`, "g"),
            (whole, index: string) => tokens[Number(index)] ?? index
        )
        // Sweep any delimiter the endpoint left behind unpaired. At scale a few come
        // back mangled beyond matching, and a stray private-use character rendered in
        // a Discord message is always wrong - it shows as a blank box, which is worse
        // than the bare index. Nothing legitimate in a message uses these code points.
        .replace(new RegExp(DELIM, "g"), "");
}
