/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export let EXTENSION_VERSION: string;
export let EXTENSION_BASE_URL: string;
export let RENDERER_CSS_URL: string;
export let IS_FIREFOX: boolean | undefined;

let resolveMetaReady: Function;
export const metaReady = new Promise<void>(res => resolveMetaReady = res);

if (typeof IS_EXTENSION !== "undefined" && IS_EXTENSION) {
    const listener = (e: MessageEvent) => {
        if (e.data?.type === "vencord:meta") {
            ({ EXTENSION_BASE_URL, EXTENSION_VERSION, RENDERER_CSS_URL } = e.data.meta);
            IS_FIREFOX = e.data.meta.IS_FIREFOX === true;
            window.removeEventListener("message", listener);
            resolveMetaReady();
        }
    };

    window.addEventListener("message", listener);
}
