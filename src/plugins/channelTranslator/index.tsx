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
import { migrateUnavailableProvider } from "./provider";
import { transformMessage, wrapContent } from "./render";
import { installSelectionHandler, removeSelectionHandler } from "./selection";
import { settings } from "./settings";
import { hydrate } from "./state";

// The billed-provider notice used to live here: a one-per-session banner that
// fired when the user switched to DeepL or Google Cloud Translation, because
// the first-run notice below fires once on a fresh install — while the provider
// is still the free keyless one — and nothing afterwards told them the
// recipient and the price had changed. Both paid providers are gone, so there
// is no such switch to announce and no price to announce it about. Every
// provider this plugin can now select is free; the first-run notice below still
// covers the fact that message text leaves the machine at all, which is the
// part that was never about money.

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
        // FIRST, before anything reads `provider`. A persisted provider id that
        // this build's registry can no longer serve refuses every translation
        // with developer wording and never heals itself, so it is repaired here
        // — once per start, which is also the only place settings may be read
        // and written at all. See migrateUnavailableProvider() in provider.ts
        // for why the condition is asked of the registry rather than of a list
        // of retired ids.
        migrateUnavailableProvider();

        hydrate();

        if (!settings.store.consentGiven) {
            showNotice(
                // WHAT THIS STILL HAS TO SAY, now that no provider costs money.
                // Removing DeepL and Google Cloud Translation removed the price,
                // not the disclosure: message text still leaves this machine, and
                // which third party receives it still depends on a setting. The
                // wording therefore names both destinations rather than saying
                // "free" and stopping, because "free" is an answer to a question
                // nobody asked about their private messages.
                "Discord Translator sends message text to the translation provider you choose. " +
                "Both options are free and neither can bill you: Google (free) needs no key and " +
                "no account, and Google Apps Script is a proxy you deploy into your own Google " +
                "account. Message text still leaves this machine either way. Direct messages are " +
                "excluded unless you opt in. Enable translation per-server from the panel at the " +
                "top right.",
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
    }
});
