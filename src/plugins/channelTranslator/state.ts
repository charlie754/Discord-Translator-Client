/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/state.ts
import { updateMessage } from "@api/MessageUpdater";
import { ChannelStore, MessageStore } from "@webpack/common";

import { TranslationCache } from "./core/cache";
import { aggregate, shouldTranslate, splitJoined } from "./core/detect";
import { hashContent } from "./core/hash";
import { ToggleState } from "./core/modes";
import { protect, restore } from "./core/protect";
import type { HttpTransport } from "./core/providers/types";
import { Scheduler } from "./core/scheduler";
import { currentProvider, warnProviderUnavailable } from "./provider";
import { settings } from "./settings";

type TranslationNative = {
    fetchTranslation(url: string): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};

const http: HttpTransport = url => {
    const native = (VencordNative as any)?.pluginHelpers?.ChannelTranslator as TranslationNative | undefined;
    if (!native) throw new Error("ChannelTranslator: native bridge unavailable");
    return native.fetchTranslation(url);
};

export const cache = new TranslationCache(5000);
export const toggle = new ToggleState();
export const scheduler = new Scheduler({
    concurrency: 3,
    maxRetries: 3,
    baseDelayMs: 500,
    breakerThreshold: 5
});

/**
 * Discord's message objects do not reliably carry guild_id — it lives on the
 * channel. Reading message.guild_id yields undefined, which our per-server
 * toggle treats as a DM and therefore always-off, silently skipping every
 * message. Resolve through the channel, as Equicord's own translator does.
 */
export function guildIdOf(channelId: string | undefined): string | null {
    if (!channelId) return null;
    return ChannelStore.getChannel(channelId)?.guild_id ?? null;
}

/**
 * MUST be called from the plugin's start(), never at module scope.
 * Reading settings.store during module evaluation throws
 * "Cannot access settings before plugin is initialized", and because that
 * happens while ~plugins is being imported it takes down every plugin,
 * not just this one.
 */
export function hydrate(): void {
    cache.loadFrom(settings.store.cacheBlob);
    toggle.loadFrom(settings.store.serverState);
}

/** messageId -> contentHash, so the render layer can find a cache entry cheaply. */
const messageHashes = new Map<string, string>();
let pending = 0;

/** hash:lang currently being translated — stops render-loop duplicate requests. */
const inFlight = new Set<string>();

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to translation-progress changes. Returns an unsubscribe function. */
export function subscribeProgress(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function emitProgress(): void {
    for (const fn of listeners) fn();
}

export function pendingCount(): number {
    return pending;
}

export function breakerOpen(): boolean {
    return scheduler.state === "open";
}

export function entryForMessage(messageId: string) {
    const hash = messageHashes.get(messageId);
    if (!hash) return undefined;
    return cache.get(hash, settings.store.targetLanguage);
}

export function persist(): void {
    settings.store.cacheBlob = cache.serialise();
    settings.store.serverState = toggle.serialise();
}

export function requestTranslation(message: any): void {
    const target = settings.store.targetLanguage;
    const hash = hashContent(message.content);
    messageHashes.set(message.id, hash);

    if (cache.get(hash, target)) return;

    const flightKey = `${hash}:${target}`;
    if (inFlight.has(flightKey)) return;

    const raw = {
        id: message.id,
        authorId: message.author?.id ?? "",
        channelId: message.channel_id,
        guildId: guildIdOf(message.channel_id),
        content: message.content,
        contentHash: hash
    };
    if (!shouldTranslate(raw, target)) return;

    // A provider that cannot run says why. Returning quietly here is what would
    // turn "DeepL selected, key not pasted" into a channel that simply never
    // translates and never explains itself.
    const resolved = currentProvider(http);
    if (!resolved.ok) {
        warnProviderUnavailable(resolved.reason);
        return;
    }
    const { provider } = resolved;

    inFlight.add(flightKey);
    pending++;
    emitProgress();
    void scheduler
        .run(async () => {
            const lines = raw.content.split("\n");

            // Indices of lines worth translating; blanks pass through untouched
            // so the message keeps its paragraph and list structure.
            const idx: number[] = [];
            const masked: string[] = [];
            const tokenSets: string[][] = [];

            lines.forEach((line, i) => {
                if (line.trim().length === 0) return;
                const p = protect(line);
                idx.push(i);
                masked.push(p.masked);
                tokenSets.push(p.tokens);
            });

            if (masked.length === 0) return null;

            const results = await provider.translate(masked, "auto", target);

            const out = [...lines];
            results.forEach((r, n) => {
                out[idx[n]] = restore(r.text, tokenSets[n]);
            });

            return { text: out.join("\n"), result: results[0] };
        })
        .then(payload => {
            if (!payload) return;
            const { text, result } = payload;
            cache.set(hash, target, {
                text,
                sourceLang: result.sourceLang,
                confidence: result.confidence
            });
            persist();
            repaintMessage(raw.channelId, raw.id);
        })
        .catch(() => {
            // Deliberately no terminal failure marker. The message is simply
            // untranslated for now and will be retried on the next render pass.
        })
        .finally(() => {
            pending--;
            inFlight.delete(flightKey);
            emitProgress();
        });
}

/**
 * Repaint what is already on screen. Toggling the flag alone changes nothing,
 * because Discord has no reason to re-render messages it already painted.
 * We never fetch history — the user's own scrolling drives Discord's lazy-load.
 */
export function repaintChannel(channelId: string): void {
    const loaded = MessageStore.getMessages(channelId);
    // _array is what the typed interface exposes; toArray() exists at runtime but is undocumented
    const messages: any[] = loaded?._array ?? [];
    const on = toggle.isOn(guildIdOf(channelId));

    if (on) {
        const batches = aggregate(
            messages.map(m => ({
                id: m.id,
                authorId: m.author?.id ?? "",
                channelId,
                guildId: guildIdOf(channelId),
                content: m.content ?? "",
                contentHash: hashContent(m.content ?? "")
            }))
        );
        for (const batch of batches) {
            for (const m of batch.messages) {
                const original = messages.find(x => x.id === m.id);
                if (original) requestTranslation(original);
            }
        }
    }

    // Always repaint, on or off: switching off must restore the originals.
    for (const m of messages) repaintMessage(channelId, m.id);
    emitProgress();
}

function repaintMessage(channelId: string, messageId: string): void {
    try {
        updateMessage(channelId, messageId);
    } catch {
        // A message not currently mounted cannot be updated. It repaints on the
        // next natural render. Degraded, not broken — and deliberately caught,
        // because upstream's equivalent uses a non-null assertion that throws.
    }
}

export { splitJoined };
