/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { popNotice, showNotice } from "@api/Notices";
import definePlugin from "@utils/types";

import { mountPanel, unmountPanel } from "./panel";
import { CHANNEL_TRANSLATOR_PATCHES, patchHit } from "./patches";
import { transformMessage, wrapContent } from "./render";
import { installSelectionHandler, removeSelectionHandler } from "./selection";
import { settings } from "./settings";
import { hydrate, setBilledProviderNotifier } from "./state";

/**
 * What each billed provider is called where the user chose it, so the notice
 * names the thing they just clicked rather than an internal id.
 *
 * A lookup with a fallback rather than an exhaustive map: an id that is not in
 * here still produces a correct sentence, and state.ts's isBilledProvider() —
 * not this object — decides whether the notice fires at all. Two places deciding
 * "is this billed?" is how one of them ends up wrong.
 */
const BILLED_PROVIDER_LABELS: Record<string, string> = {
    "deepl": "DeepL",
    "google-cloud": "Google Cloud Translation"
};

/**
 * The cost fact, said once, at the point it starts being true.
 *
 * WHAT THIS CLOSES. The first-run notice below is the only unsolicited thing
 * this plugin ever said about where message text goes, and it fires exactly
 * once, on a fresh install, while the provider is still the free keyless one.
 * Switching afterwards to a provider billed to the user's own key changes both
 * the recipient and the price, and nothing announced either: consentGiven was
 * already true so the first-run notice never came back, and the only surviving
 * mention of money was a settings description the user had to be reading at the
 * time to see.
 */
function billedProviderNotice(providerId: string): string {
    const label = BILLED_PROVIDER_LABELS[providerId] ?? providerId;
    return (
        `Discord Translator is now sending message text to ${label}, using your own API key. ` +
        `${label} bills you for what this plugin sends — including scrollback when you switch a ` +
        "server on, and double-click translations. Set a monthly character cap in the plugin " +
        "settings if you want a hard stop, and check the usage meter there to see what has been " +
        "sent. Switch Provider back to Google (free) to stop being billed."
    );
}

export default definePlugin({
    name: "ChannelTranslator",
    description:
        "Translate a whole channel, including scrollback, with one toggle. " +
        "Message text is sent to your chosen translation provider.",
    authors: [{ name: "IRP_HongKong", id: 0n }],
    required: true,
    settings,
    patches: CHANNEL_TRANSLATOR_PATCHES,

    transformMessage,
    wrapContent,

    start() {
        // Registered BEFORE hydrate(), which establishes the provider baseline.
        // The baseline itself is deliberately silent, so the order does not
        // change what the user sees today — it is here so that it stays true if
        // hydrate() ever gains a reason to announce on the first pass.
        setBilledProviderNotifier(providerId => {
            showNotice(billedProviderNotice(providerId), "Understood", () => popNotice());
        });

        hydrate();

        if (!settings.store.consentGiven) {
            showNotice(
                // Names the provider the user is ACTUALLY on rather than
                // "Google Translate" unconditionally, and says that the other
                // two cost money. The old wording named one provider of three,
                // and the word "billed" appeared nowhere the user had not gone
                // looking — so a first-run reader could reasonably conclude the
                // whole plugin was free, which for two of its three providers is
                // not true. Switching to one of those two now says so again, at
                // the moment it starts to matter; see billedProviderNotice().
                "Discord Translator sends message text to the translation provider you choose. " +
                "The default, Google (free), needs no key and costs nothing. The DeepL and " +
                "Google Cloud Translation options use an API key of your own and are billed to " +
                "you by that provider. Direct messages are excluded unless you opt in. Enable " +
                "translation per-server from the panel at the top right.",
                "Understood",
                () => {
                    settings.store.consentGiven = true;
                    popNotice();
                }
            );
        }

        mountPanel();
        installSelectionHandler();

        // The patches register lazily on first render, so check after the UI settles.
        // Console-only failure is what makes a rotted patch invisible; this is loud.
        setTimeout(() => {
            const clone = patchHit("clone");
            const wrap = patchHit("wrap");
            if (clone && wrap) return;

            const detail = !clone && !wrap
                ? "channel translation is paused"
                : !clone
                    ? "Replace mode is unavailable — switch Mode to Both Language"
                    : "Both Language mode is unavailable — switch Mode to Replace";

            showNotice(
                `Discord Translator: Discord changed and ${detail}. Double-click translation still works.`,
                "OK",
                () => popNotice()
            );
        }, 15_000);
    },

    stop() {
        removeSelectionHandler();
        unmountPanel();
        // Nothing should be able to raise a notice for a plugin that is off.
        setBilledProviderNotifier(null);
    }
});
