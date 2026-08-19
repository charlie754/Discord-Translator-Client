/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * Exact hostnames this transport may reach — currently only the gtx endpoint in
 * core/providers/google.ts. Main-process fetch is not subject to renderer CSP, and
 * this handler is reachable from Discord's own world via VencordNative, so without
 * this list any page script would hold an unrestricted GET proxy onto localhost and
 * the LAN. Adding a provider means adding its host here.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["translate.googleapis.com"]);

/**
 * Main-process transport for translation requests. Never throws — a thrown error
 * crosses ipcMain.handle only as a mangled string, so failures come back as a status
 * the renderer can reason about.
 */
export async function fetchTranslation(
    _: IpcMainInvokeEvent,
    url: string
): Promise<HttpResponse> {
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        console.warn("[Discord Translator] Blocked unparseable translation URL");
        return { status: 0, body: "blocked: malformed URL" };
    }

    // Exact hostname match only: endsWith would let evilgoogleapis.com through, and a
    // subdomain wildcard would trust anything Google's DNS ever delegates.
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
        console.warn(
            `[Discord Translator] Blocked translation request to ${target.protocol}//${target.hostname}`
        );
        return { status: 0, body: `blocked: ${target.protocol}//${target.hostname} is not an allowed translation host` };
    }

    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const body = await res.text();

        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;

        return {
            status: res.status,
            body,
            retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined
        };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}
