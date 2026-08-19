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

export function restore(masked: string, tokens: string[]): string {
    return masked.replace(
        new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"),
        (whole, index: string) => {
            const token = tokens[Number(index)];
            return token === undefined ? whole : token;
        }
    );
}
