// plugin/render.tsx
import { Parser } from "@webpack/common";

import { hashContent } from "./core/hash";
import { markPatchHit } from "./patches";
import { settings } from "./settings";
import { cache, entryForMessage, guildIdOf, requestTranslation, toggle } from "./state";

/**
 * Mode A. Returns a prototype-preserving CLONE with translated content.
 * The clone is handed only to the renderer; the store keeps the original, so
 * copy, reply-quote, edit-prefill and search are never corrupted and toggling
 * off needs no restore path.
 */
export function transformMessage(message: any): any {
    markPatchHit("clone");
    if (!message?.content) return message;
    if (settings.store.mode !== "replace") return message;
    if (!toggle.isOn(guildIdOf(message.channel_id))) return message;

    const hash = hashContent(message.content);
    const hit = cache.get(hash, settings.store.targetLanguage);

    if (!hit) {
        requestTranslation(message);
        return message;
    }
    // Already showing the translation — do not feed it back as a new original.
    if (message.content === hit.text) return message;

    return Object.assign(
        Object.create(Object.getPrototypeOf(message)),
        message,
        { content: hit.text }
    );
}

/**
 * Mode B, and the rewritten-marker in Mode A. Discord passes the already
 * rendered content node; we return it wrapped rather than walking its children,
 * which is what keeps mentions, emoji and code blocks intact.
 */
export function wrapContent(content: any, messageId: string, channelId: string): any {
    markPatchHit("wrap");
    if (!messageId) return content;

    // Off means off: never render a translation, however warm the cache is.
    if (!toggle.isOn(guildIdOf(channelId))) return content;

    const mode = settings.store.mode;
    const target = settings.store.targetLanguage;
    const entry = entryForMessage(messageId);
    if (!entry) return content;

    if (mode === "bilingual") {
        return (
            <>
                {content}
                <hr className="ct-sep" />
                <div className="ct-translated-row">
                    {/* Three-argument form is required: without the context object,
                        mentions, channel links and role pills do not resolve. */}
                    {Parser.parse(entry.text, true, { channelId, messageId })}
                </div>
            </>
        );
    }

    // Mode A: mark the message as rewritten.
    return (
        <span
            className="ct-rewritten"
            title={`Translated to ${target.toUpperCase()} — double-click to see the original`}
        >
            {content}
        </span>
    );
}
