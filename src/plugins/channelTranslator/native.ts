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
 * Main-process transport for translation requests. Never throws — a thrown error
 * crosses ipcMain.handle only as a mangled string, so failures come back as a status
 * the renderer can reason about.
 */
export async function fetchTranslation(
    _: IpcMainInvokeEvent,
    url: string
): Promise<HttpResponse> {
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
