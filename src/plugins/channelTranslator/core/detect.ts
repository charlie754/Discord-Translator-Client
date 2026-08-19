import type { RawMessage } from "./types";

/**
 * Below this length a message carries too little signal for reliable language
 * detection. Observed failure: 了解 detected as zh-CN at 0.988 confidence and
 * rendered "learn". Aggregating neighbours gives the engine real context.
 */
export const SHORT_TEXT_THRESHOLD = 12;

/** Newline-separated numbering survives MT far better than bare newlines. */
const SEPARATOR = "\n\u2029\n";

export interface Batch {
    messages: RawMessage[];
    joined: string;
}

export interface AggregateOptions {
    maxGroup?: number;
    threshold?: number;
}

function baseLang(tag: string): string {
    return tag.toLowerCase().split("-")[0];
}

export function shouldTranslate(
    msg: RawMessage,
    targetLang: string,
    knownSourceLang?: string
): boolean {
    if (msg.content.trim().length === 0) return false;
    if (knownSourceLang && baseLang(knownSourceLang) === baseLang(targetLang)) return false;
    return true;
}

export function aggregate(messages: RawMessage[], opts: AggregateOptions = {}): Batch[] {
    const maxGroup = opts.maxGroup ?? 8;
    const threshold = opts.threshold ?? SHORT_TEXT_THRESHOLD;
    const batches: Batch[] = [];
    let current: RawMessage[] = [];

    const flush = () => {
        if (current.length === 0) return;
        batches.push({
            messages: current,
            joined: current.map(m => m.content).join(SEPARATOR)
        });
        current = [];
    };

    for (const msg of messages) {
        const isShort = msg.content.length <= threshold;
        const sameAuthor = current.length > 0 && current[0].authorId === msg.authorId;

        if (!isShort) {
            flush();
            batches.push({ messages: [msg], joined: msg.content });
            continue;
        }
        if (current.length > 0 && (!sameAuthor || current.length >= maxGroup)) flush();
        current.push(msg);
    }
    flush();

    return batches;
}

/**
 * Splits a translated batch back into its component messages.
 *
 * When the translation engine preserves the batch separator, returns the
 * individual translated messages. When the separator is destroyed, returns null
 * so the caller can fall back to translating each message individually.
 *
 * @param translated The translated batch text
 * @param count Expected number of messages in the batch
 * @returns Array of translated messages, or null if the batch could not be split
 */
export function splitJoined(translated: string, count: number): string[] | null {
    if (count <= 1) return [translated];
    const parts = translated.split(SEPARATOR).map(p => p.trim());
    if (parts.length === count) return parts;
    // The engine destroyed the separator. Signal failure so the caller can
    // retry these messages individually — never silently pad with blanks.
    return null;
}
