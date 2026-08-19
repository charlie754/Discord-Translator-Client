import type { TranslateResult } from "../types";
import type { HttpTransport, TranslationProvider } from "./types";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

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
                const url =
                    `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(from)}` +
                    `&tl=${encodeURIComponent(to)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;

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

                results.push({
                    text: parsed.sentences.map(s => s.trans ?? "").join(""),
                    sourceLang: parsed.src ?? "auto",
                    confidence: parsed.confidence ?? 0
                });
            }
            return results;
        }
    };
}
