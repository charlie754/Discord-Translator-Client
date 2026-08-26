/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { TranslateResult } from "../types";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * Everything a provider may vary about a request beyond its URL.
 *
 * Deliberately NOT a general request descriptor. There is no `headers` field and
 * there must not be one: every transport implementing HttpTransport is reachable
 * from Discord's own page world — over IPC on the desktop, over the content-script
 * relay in the extension — so forwarding caller-supplied headers would hand any
 * script on the page a header-injection channel through the very guard that
 * exists to prevent one. That is the same reasoning that put DeepL's key in a
 * query parameter (see createDeeplProvider), and it survives this change.
 *
 * The Content-Type of a POST is therefore fixed by each transport to
 * application/json, which is what the POST provider here needs. A provider
 * wanting a different one is a deliberate edit to all three transports, not a
 * value a caller gets to pick.
 *
 * `method` is a closed union for the same reason: the transports refuse anything
 * that is not exactly "GET" or "POST", so no verb can be smuggled through.
 */
export interface HttpRequestInit {
    method?: "GET" | "POST";
    /** Request payload. Sent only with POST, and length-capped by every transport. */
    body?: string;
}

/**
 * Injected so the core stays environment-free and fully testable offline.
 *
 * The second argument is optional so a GET is spelled exactly as it was before
 * POST existed — `http(url)`. google.ts and deepl.ts therefore needed no edit at
 * all, which makes "GET still behaves as it did" true by construction rather
 * than by assertion.
 */
export type HttpTransport = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/**
 * Per-provider configuration the adapter reads out of plugin settings and hands
 * in. Kept as plain data so core/ never learns what a Discord setting is.
 */
export interface ProviderConfig {
    /** The user's own key. Never shipped, never shared; absent for keyless providers. */
    apiKey?: string;
}

export type ProviderFactory = (http: HttpTransport, config: ProviderConfig) => TranslationProvider;

/**
 * Why a provider could not be constructed, in words meant for the user. A
 * provider that needs a key and has none is unavailable, not broken — and it has
 * to say so, because the alternative is every translation failing in silence.
 */
export type ProviderResolution =
    | { ok: true; provider: TranslationProvider; }
    | { ok: false; reason: string; };

export interface TranslationProvider {
    id: string;
    label: string;
    needsKey: boolean;
    translate(texts: string[], from: string, to: string): Promise<TranslateResult[]>;
}
