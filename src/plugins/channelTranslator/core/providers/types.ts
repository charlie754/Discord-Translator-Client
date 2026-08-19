import type { TranslateResult } from "../types";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/** Injected so the core stays environment-free and fully testable offline. */
export type HttpTransport = (url: string) => Promise<HttpResponse>;

export interface TranslationProvider {
    id: string;
    label: string;
    needsKey: boolean;
    translate(texts: string[], from: string, to: string): Promise<TranslateResult[]>;
}
