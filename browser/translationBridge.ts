/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Browser replacement for the plugin's Electron native transport.
 *
 * On the desktop, src/plugins/channelTranslator/native.ts runs in the main process
 * and the renderer reaches it over IPC as VencordNative.pluginHelpers.ChannelTranslator.
 * There is no main process here, so this module provides the same object with the
 * same shape, and the plugin never learns the difference.
 *
 * Two transports, chosen at build time:
 *
 *   extension  the request is relayed to the background context (translationHost.js),
 *              which is the only part of the extension that may fetch cross-origin.
 *   otherwise  a direct fetch. In the userscript bundle this is GMPolyfill's GM_fetch,
 *              injected by scripts/build/buildWeb.mjs, which also escapes CORS. In the
 *              plain web bundle it is the page's own fetch and is subject to Discord's
 *              CSP — that build has no privileged context to borrow, and this is the
 *              honest best it can do.
 */

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * Kept deliberately identical to ALLOWED_HOSTS in native.ts and in
 * browser/translationHost.js. Three copies is not an accident: each one guards a
 * different transport, and the direct path below has no privileged process to
 * check it on the way out. scripts/checkHosts.mjs fails CI if any of them reaches
 * a host that is not declared in scripts/allowed-hosts.txt.
 *
 * Exact hostnames, matched with Set.has(). Never relax this to endsWith or a
 * wildcard: endsWith("deepl.com") also admits evil-deepl.com.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
    "translate.googleapis.com",
    "api-free.deepl.com",
    "api.deepl.com"
]);

const REQUEST = "discordTranslator:fetch";
const RESPONSE = "discordTranslator:fetch:result";

/**
 * A request the background never answers must fail rather than hang: the plugin's
 * scheduler holds a slot open per in-flight translation, so a permanently pending
 * promise would stall the queue instead of erroring it.
 */
const TIMEOUT_MS = 20_000;

/** @returns the reason the URL is refused, or null if it is allowed */
function refuse(url: string): string | null {
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return "malformed URL";
    }

    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
        return `${target.protocol}//${target.hostname} is not an allowed translation host`;
    }

    return null;
}

function shapeRetryAfter(header: string | null): number | undefined {
    const ms = header ? Number(header) * 1000 : undefined;
    return Number.isFinite(ms) ? ms : undefined;
}

let nextId = 1;
const pending = new Map<number, (res: HttpResponse) => void>();
let listening = false;

function listenForReplies() {
    if (listening) return;
    listening = true;

    window.addEventListener("message", event => {
        // Same-frame only. The content script posts back into this frame; anything
        // arriving from an iframe or opener is not ours.
        if (event.source !== window) return;

        const data = event.data;
        if (!data || data.type !== RESPONSE) return;

        const resolve = pending.get(data.id);
        if (!resolve) return;

        pending.delete(data.id);
        const res = data.response;
        resolve({
            status: typeof res?.status === "number" ? res.status : 0,
            body: typeof res?.body === "string" ? res.body : "",
            retryAfterMs: typeof res?.retryAfterMs === "number" ? res.retryAfterMs : undefined
        });
    });
}

function viaExtension(url: string): Promise<HttpResponse> {
    listenForReplies();

    const id = nextId++;

    return new Promise<HttpResponse>(resolve => {
        const timer = setTimeout(() => {
            // delete() reports whether it was still outstanding, so a reply that
            // races the timeout cannot resolve the promise twice.
            if (pending.delete(id)) {
                resolve({ status: 0, body: "translation request timed out" });
            }
        }, TIMEOUT_MS);

        pending.set(id, res => {
            clearTimeout(timer);
            resolve(res);
        });

        window.postMessage({ type: REQUEST, id, url }, location.origin);
    });
}

async function directFetch(url: string): Promise<HttpResponse> {
    const why = refuse(url);
    if (why) {
        console.warn("[Discord Translator] Blocked translation request:", why);
        return { status: 0, body: `blocked: ${why}` };
    }

    try {
        const res = await fetch(url);
        const body = await res.text();

        return {
            status: res.status,
            body,
            retryAfterMs: shapeRetryAfter(res.headers.get("retry-after"))
        };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}

/**
 * The object the plugin looks for at VencordNative.pluginHelpers.ChannelTranslator.
 * Its shape is fixed by state.ts and selection.ts, which type it structurally — if
 * this drifts, they fall back to throwing "native bridge unavailable" rather than
 * failing at build time, so change both together.
 */
export const ChannelTranslatorHelper = {
    fetchTranslation: (url: string): Promise<HttpResponse> =>
        IS_EXTENSION ? viaExtension(url) : directFetch(url)
};
