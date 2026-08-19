/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const PLUGIN_NAME = "ChannelTranslator";

/** A message as the adapter hands it to the core. The core never sees a Discord object. */
export interface RawMessage {
    id: string;
    authorId: string;
    channelId: string;
    guildId: string | null;
    content: string;
    contentHash: string;
}

export interface TranslateResult {
    text: string;
    sourceLang: string;
    confidence: number;
}
