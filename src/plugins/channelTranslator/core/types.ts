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
