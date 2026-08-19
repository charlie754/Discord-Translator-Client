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
import { hydrate } from "./state";

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
        hydrate();

        if (!settings.store.consentGiven) {
            showNotice(
                "Discord Translator sends message text to Google Translate. " +
                "Direct messages are excluded unless you opt in. Enable translation " +
                "per-server from the panel at the top right.",
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
