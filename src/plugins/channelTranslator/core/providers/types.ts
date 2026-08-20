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

/** Injected so the core stays environment-free and fully testable offline. */
export type HttpTransport = (url: string) => Promise<HttpResponse>;

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
