/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { permanentError } from "../scheduler";
import type { TranslateResult } from "../types";
import type { HttpTransport, ProviderConfig, TranslationProvider } from "./types";

/**
 * Google Cloud Translation v2 — the paid, contractual API, billed to the user's
 * own Google Cloud project.
 *
 * NOTE THE HOST. This is translation.googleapis.com, which is NOT the
 * translate.googleapis.com that core/providers/google.ts uses. They are
 * different hostnames reached for different reasons, and both have to be
 * declared separately in every allow-list — the exact-match check in the three
 * transports is what makes that a deliberate act rather than a typo away.
 */
const ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

/**
 * Cloud Translation v2 mostly wants ISO-639-1, so the naive "drop the region
 * subtag" transform is right for nearly everything. This table is only the cases
 * where it is WRONG in a way the user would notice:
 *
 *   - Chinese has no single code. zh-TW must survive as zh-TW, because "zh"
 *     alone returns Simplified to someone who explicitly asked for 繁體中文 —
 *     the same trap deepl.ts documents.
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
 * targetLanguage is a free-text setting, so an unmapped region subtag is
 * reachable in ordinary use. Dropping the subtag beats forwarding a code the API
 * will reject: "pt-BR" becomes "pt" and translates, where the untouched tag
 * would 400 and the user would see nothing at all.
 */
export function toLanguageCode(tag: string): string {
    const key = tag.trim().toLowerCase();
    return LANGUAGE[key] ?? key.split("-")[0];
}

/**
 * v2 HTML-escapes the text it returns even when format is "text" — an apostrophe
 * comes back as `&#39;`, an ampersand as `&amp;`. Left alone, the user reads
 * `don&#39;t` in their own chat.
 *
 * Decoded in ONE pass rather than entity by entity: sequential replacement would
 * turn the literal text `&amp;lt;` into `<`, inventing markup that was never in
 * the message. Only the entities v2 actually emits are decoded — a general
 * numeric-entity decoder would also be able to synthesise the private-use
 * sentinels core/protect.ts relies on.
 */
const ENTITY: Readonly<Record<string, string>> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#34;": "\"",
    "&#39;": "'",
    "&apos;": "'"
};

export function decodeEntities(text: string): string {
    return text.replace(/&(?:amp|lt|gt|quot|apos|#34|#39);/g, m => ENTITY[m] ?? m);
}

/**
 * What went wrong, in words a user can act on.
 *
 * A bare "HTTP 403" is the worst of both worlds here: it looks like a bug in the
 * plugin and it hides the two things that actually cause it. On this API a 403
 * almost never means "wrong key characters" — it means the Cloud Translation API
 * was never enabled on the project the key belongs to, or the key carries an
 * application/API restriction that excludes this request.
 *
 * A 400 is the opposite mistake, and this table used to make it. Google answers a
 * MALFORMED API KEY with 400 and the body "API key not valid. Please pass a valid
 * API key." — the same status an unsupported target language code produces. The
 * old hint named only the language code, so the far commoner cause, a key pasted
 * short or with a stray character, sent the user to the wrong setting entirely.
 * The key leads now; the language code is named second, because both are real.
 *
 * The 429 text names the user's own daily cap first for the same reason. Cloud
 * Translation ships with NO characters-per-day limit — the only default is
 * 6,000,000 characters per minute, which ordinary chat cannot approach — so a 429
 * here is nearly always a cap the user set themselves on the quota page, and it
 * stays 429 until the quota window rolls over rather than clearing in seconds.
 * Saying "rate limited" alone left them watching the panel and waiting for
 * something that was not going to happen today.
 */
const STATUS_HINT: Readonly<Record<number, string>> = {
    400: "Google Cloud rejected the request. The likeliest cause is a malformed API key — " +
        "check the key in the plugin settings was pasted whole, with nothing trimmed off " +
        "either end and no stray spaces. The same 400 also comes back for a target " +
        "language code Cloud Translation does not support, so check the Language setting " +
        "in the translator panel too. Google's own words below say which it was.",
    401: "Google Cloud did not accept the API key. Check it was pasted whole, with no stray spaces.",
    403: "Google Cloud refused the key. Two things cause this and both are fixed in the " +
        "Google Cloud console: the Cloud Translation API may not be enabled on that " +
        "project (APIs & Services → Enable APIs → Cloud Translation API), or the key " +
        "may have API/referrer/IP restrictions that exclude this request.",
    404: "Google Cloud could not find that endpoint — the project may not have the " +
        "Cloud Translation API enabled.",
    429: "Google Cloud refused the request on quota. The likeliest cause is the " +
        "characters-per-day cap you set on your own project: once it is spent every " +
        "request is refused until the quota window resets, so this will not clear in a " +
        "few seconds — it clears when that day rolls over. Raise or clear the cap on the " +
        "quota page for translate.googleapis.com if you want it back sooner. The other " +
        "possibility is the 6,000,000 characters-per-minute limit, which does clear " +
        "within the minute. Note on cost: Cloud Translation gives a monthly credit of up " +
        "to USD 10, which covers about 500,000 characters and applies collectively to " +
        "Cloud Translation - Basic and Advanced. It does not roll over, and it is a " +
        "credit rather than a stop — past it, usage bills at USD 20 per million characters.",
    500: "Google Cloud had an internal error. This one is usually worth waiting out.",
    503: "Google Cloud is temporarily unavailable. This one is usually worth waiting out."
};

/** How much of Google's own error text to quote back. Enough to be useful, not enough to be a wall. */
const MAX_QUOTED_ERROR = 200;

/**
 * v2 puts a human-readable reason in the error envelope, and it is frequently
 * more precise than anything guessable from the status alone. It is third-party
 * text, so it is length-capped and stripped of control characters before it is
 * put in front of the user.
 */
function quotedError(body: string): string {
    try {
        const parsed = JSON.parse(body) as { error?: { message?: unknown; }; };
        const message = parsed.error?.message;
        if (typeof message !== "string" || !message.trim()) return "";

        const clean = message.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
        return ` Google said: "${clean.slice(0, MAX_QUOTED_ERROR)}"`;
    } catch {
        return "";
    }
}

interface V2Translation {
    translatedText?: string;
    detectedSourceLanguage?: string;
}

/**
 * Google Cloud Translation v2, authenticated with a key the *user* supplies and
 * billed to their own project. This project never ships or shares a credential,
 * so an empty key is a hard error rather than a silent no-op — see
 * resolveProvider() in ./registry, which refuses to hand this provider out at
 * all until a key is set.
 *
 * POST, not GET: Google documents this endpoint as a POST with a JSON body, and
 * that is why HttpTransport grew an optional second argument. The key still
 * travels as the `key` query parameter, which is the form Google documents for
 * API keys and which keeps the transports free of any caller-named header — the
 * same constraint deepl.ts records, unchanged by this provider's arrival.
 *
 * NO CHUNKER, deliberately. google.ts splits long messages because the free gtx
 * endpoint carries the text in the query string and dies at roughly 16 KiB of
 * URL, which CJK reaches at about 1800 characters. That limit is a property of
 * putting text in a URL and it does not exist here: the text is in the POST
 * body, and v2's documented ceiling is 30,000 code points per request. Discord
 * caps a message at 2000 characters, 4000 with Nitro, so a single message cannot
 * approach it. Porting the chunker would add a splitting-and-rejoining seam —
 * the exact place sentinels get cut in half — to guard a limit that is an order
 * of magnitude away.
 *
 * One request per text, matching deepl.ts. v2 accepts several `q` values in one
 * request and that would be cheaper, but this provider is billed by character
 * rather than by request, so batching saves the user nothing and would introduce
 * an index-mapping step whose failure mode is showing one message's translation
 * on another.
 */
export function createGoogleCloudProvider(
    http: HttpTransport,
    config: ProviderConfig = {}
): TranslationProvider {
    const apiKey = (config.apiKey ?? "").trim();

    return {
        id: "google-cloud",
        label: "Google Cloud Translation (your own key)",
        needsKey: true,

        async translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> {
            // Permanent: no amount of retrying conjures a key, and four attempts
            // at a request that was never sent still counted four times toward
            // opening the breaker, taking down whichever provider the user
            // switched to next.
            if (!apiKey) {
                throw permanentError(
                    "google-cloud: no API key configured — set your Google Cloud API key in the plugin settings"
                );
            }

            const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
            const target = toLanguageCode(to);
            const results: TranslateResult[] = [];

            for (const text of texts) {
                const payload: Record<string, string> = {
                    q: text,
                    target,
                    // "text", not "html": the message text is plain, and asking for
                    // html would invite the API to return markup we would then have
                    // to trust.
                    format: "text"
                };
                // Omitting source is how v2 is asked to detect, which is what makes
                // detectedSourceLanguage appear in the reply.
                if (from && from !== "auto") payload.source = toLanguageCode(from);

                const res = await http(url, { method: "POST", body: JSON.stringify(payload) });

                if (res.status !== 200) {
                    const hint = STATUS_HINT[res.status];
                    throw Object.assign(
                        new Error(
                            `google-cloud: HTTP ${res.status}` +
                            (hint ? ` — ${hint}` : "") +
                            quotedError(res.body)
                        ),
                        { status: res.status, retryAfterMs: res.retryAfterMs }
                    );
                }

                // BOTH failures below are marked permanent, and on this provider
                // that is a money question rather than a tidiness one.
                //
                // The HTTP request has already returned 200. Google bills for the
                // characters in the request, not for a usable answer, so the
                // charge is incurred the moment the response arrives — whether or
                // not we can parse it. A status-less plain Error is classed
                // transient by isPermanent(), so the scheduler used to send the
                // identical body to the identical deterministic endpoint up to
                // four times, pay four times, and discard all four replies. Then
                // it counted every one of them as a breaker failure.
                //
                // Nothing about a malformed 200 improves on the second attempt.
                let parsed: { data?: { translations?: V2Translation[]; }; };
                try {
                    parsed = JSON.parse(res.body);
                } catch {
                    // The body is quoted nowhere: it is unparsed third-party text
                    // of unknown length, and this message is shown to the user.
                    throw permanentError(
                        "google-cloud: HTTP 200 whose body was not JSON — the request was " +
                        "billed but the reply cannot be read, so it is not retried"
                    );
                }

                const translations = parsed.data?.translations;
                if (!Array.isArray(translations) || translations.length === 0) {
                    throw permanentError("google-cloud: response had no translations array");
                }

                const [first] = translations;
                results.push({
                    text: decodeEntities(first.translatedText ?? ""),
                    // Lowercased because everything downstream — the cache key and
                    // selection.ts's reverse-translate check — compares against
                    // lowercase BCP-47 tags, which is what the google provider returns.
                    // Absent whenever `source` was sent, since nothing was detected.
                    sourceLang: (first.detectedSourceLanguage ?? "auto").toLowerCase(),
                    // v2 reports no detection confidence. 0 is the same value the
                    // google provider uses when the field is absent; nothing gates on it.
                    confidence: 0
                });
            }

            return results;
        }
    };
}
