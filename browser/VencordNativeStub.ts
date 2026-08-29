/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/// <reference path="../src/modules.d.ts" />
/// <reference path="../src/globals.d.ts" />

// Be very careful with imports in this file to avoid circular dependency issues.
// Only import pure modules that don't import other parts of Vencord.
import monacoHtmlLocal from "file://monacoWin.html?minify";
import * as DataStore from "@api/DataStore";
import type { Settings } from "@api/Settings";
import { getThemeInfo } from "@main/themes";
import { debounce } from "@shared/debounce";
import { localStorage } from "@utils/localStorage";
import { getStylusWebStoreUrl } from "@utils/web";
import { EXTENSION_BASE_URL, metaReady, RENDERER_CSS_URL } from "@utils/web-metadata";

import { ChannelTranslatorHelper } from "./translationBridge";

// listeners for ipc.on
const cssListeners = new Set<(css: string) => void>();
const NOOP = () => { };
const NOOP_ASYNC = async () => { };

const setCssDebounced = debounce((css: string) => VencordNative.quickCss.set(css));

const themeStore = DataStore.createStore("VencordThemes", "VencordThemeData");

// probably should make this less cursed at some point
window.VencordNative = {
    themes: {
        uploadTheme: (fileName: string, fileData: string) => DataStore.set(fileName, fileData, themeStore),
        deleteTheme: (fileName: string) => DataStore.del(fileName, themeStore),
        getThemesList: () => DataStore.entries(themeStore).then(entries =>
            entries.map(([name, css]) => getThemeInfo(css, name.toString()))
        ),
        getThemeData: (fileName: string) => DataStore.get(fileName, themeStore),
        getSystemValues: async () => ({}),

        openFolder: async () => Promise.reject("themes:openFolder is not supported on web"),
    },

    native: {
        getVersions: () => ({}),
        supportsWindowsMaterial: () => false,
        openExternal: async (url) => void open(url, "_blank"),
        // There is no main process here, so there is no window for it to open a
        // bundled file in. The browser builds reach the guide a different way
        // entirely — scripts/build/buildWeb.mjs packages it as guide.html inside
        // the extension, and guideTarget() in
        // src/plugins/channelTranslator/settings.ts returns that first. Saying
        // "false" out loud is what makes that resolver skip the desktop branch
        // instead of drawing a button wired to a function that cannot work here.
        hasSetupGuide: () => false,
        openSetupGuide: async () => false,
        getRendererCss: async () => {
            if (IS_USERSCRIPT)
                // need to wait for next tick for _vcUserScriptRendererCss to be set
                return Promise.resolve().then(() => window._vcUserScriptRendererCss);

            await metaReady;

            return fetch(RENDERER_CSS_URL)
                .then(res => res.text());
        },
        onRendererCssUpdate: NOOP,
    },

    updater: {
        getRepo: async () => ({ ok: true, value: "https://github.com/charlie754/Discord-Translator-Client" }),
        getUpdates: async () => ({ ok: true, value: [] }),
        update: async () => ({ ok: true, value: false }),
        rebuild: async () => ({ ok: true, value: true }),
    },

    quickCss: {
        get: () => DataStore.get("VencordQuickCss").then(s => s ?? ""),
        set: async (css: string) => {
            await DataStore.set("VencordQuickCss", css);
            cssListeners.forEach(l => l(css));
        },
        addChangeListener(cb) {
            cssListeners.add(cb);
        },
        addThemeChangeListener: NOOP,
        openFile: NOOP_ASYNC,
        async openEditor() {
            if (IS_USERSCRIPT) {
                const shouldOpenWebStore = confirm("QuickCSS is not supported on the Userscript. You can instead use the Stylus extension.\n\nDo you want to open the Stylus web store page?");
                if (shouldOpenWebStore) {
                    window.open(getStylusWebStoreUrl(), "_blank");
                }
                return;
            }

            const features = `popup,width=${Math.min(window.innerWidth, 1000)},height=${Math.min(window.innerHeight, 1000)}`;
            const win = open("about:blank", "VencordQuickCss", features);
            if (!win) {
                alert("Failed to open QuickCSS popup. Make sure to allow popups!");
                return;
            }

            win.baseUrl = EXTENSION_BASE_URL;
            win.setCss = setCssDebounced;
            win.getCurrentCss = () => VencordNative.quickCss.get();
            win.getTheme = this.getEditorTheme;

            /*
             * Load Monaco out of the extension rather than off a CDN.
             *
             * This matters more here than it would in most extensions: this one removes
             * Discord's Content-Security-Policy from every tab, so a script fetched from
             * cdn.jsdelivr.net would execute in the logged-in discord.com origin with
             * nothing left to constrain it. One bad publish upstream would be enough.
             *
             * The fetch happens HERE, in the opener, not in the popup. The popup is an
             * about:blank window carrying the discord.com origin, and loading the
             * extension URL from inside it does not work — an appended <script src> there
             * produces no error, no request and no execution. The opener is a real
             * discord.com document, so web_accessible_resources applies to it normally
             * and it can read the files, then inject them into the popup it owns.
             *
             * __monacoLocal is set BEFORE document.write, because the page's bootstrap
             * reads it while parsing to decide whether to wait for an injection or fall
             * back to the CDN.
             */
            const localMonaco = IS_EXTENSION && !!EXTENSION_BASE_URL;
            (win as any).__monacoLocal = localMonaco;

            win.document.write(monacoHtmlLocal);

            if (!localMonaco) return;

            try {
                const at = (file: string) => new URL(file, EXTENSION_BASE_URL).toString();
                const text = (file: string) => fetch(at(file)).then(r => r.text());

                const [css, js, cssWorker, editorWorker] = await Promise.all([
                    text("vendor/monaco/index.css"),
                    text("vendor/monaco/index.js"),
                    text("vendor/monaco/vs/language/css/css.worker.js"),
                    text("vendor/monaco/vs/editor/editor.worker.js")
                ]);

                // Workers must be same-origin with the document that starts them, and a
                // chrome-extension:// URL is not. Blob URLs minted here are.
                const blob = (code: string) =>
                    URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
                (win as any).quickCssWorkerUrls = { css: blob(cssWorker), editor: blob(editorWorker) };

                const style = win.document.createElement("style");
                style.textContent = css;
                win.document.head.append(style);

                const script = win.document.createElement("script");
                script.textContent = js;
                win.document.head.append(script);
            } catch (err) {
                console.error("[Discord Translator] Could not load the bundled QuickCSS editor", err);
                (win as any).__monacoLocalFailed = true;
            }
        },
        getEditorTheme: () => {
            const { getTheme, Theme } = require("@utils/discord");

            return getTheme() === Theme.Light
                ? "vs-light"
                : "vs-dark";
        }
    },

    settings: {
        get: () => {
            try {
                return JSON.parse(localStorage.getItem("DiscordTranslatorSettings") || "{}");
            } catch (e) {
                console.error("Failed to parse settings from localStorage: ", e);
                return {};
            }
        },
        set: async (s: Settings) => localStorage.setItem("DiscordTranslatorSettings", JSON.stringify(s)),
        getSettingsDir: async () => "LocalStorage",
        openFolder: async () => Promise.reject("settings:openFolder is not supported on web"),
    },

    // On the desktop this is generated from every plugin's native.ts and exposed over
    // IPC. There is no main process here, so the one helper this fork actually ships
    // is provided directly — see browser/translationBridge.ts. Left empty, the
    // translator would load, render its panel, and fail every translation with
    // "native bridge unavailable".
    pluginHelpers: {
        ChannelTranslator: ChannelTranslatorHelper
    } as any,
    csp: {} as any,
    tray: {
        setUpdateState: NOOP,
        onCheckUpdates: NOOP,
        onRepair: NOOP,
    },
};
