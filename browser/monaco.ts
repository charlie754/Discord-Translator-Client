/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./patch-worker";

import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";

declare global {
    const baseUrl: string;
    const getCurrentCss: () => Promise<string>;
    const setCss: (css: string) => void;
    const getTheme: () => string;
}

const BASE = "/vendor/monaco/vs";

self.MonacoEnvironment = {
    getWorkerUrl(_moduleId: unknown, label: string) {
        /*
         * In the extension this page is an about:blank popup carrying the discord.com
         * origin, so a chrome-extension:// worker URL is cross-origin and refused —
         * the CSS language service would silently never start. openEditor fetches the
         * two worker files (which it may, as web-accessible resources) and hands over
         * same-origin blob URLs instead. Everywhere else the direct path is correct.
         */
        const injected = (self as any).quickCssWorkerUrls;
        if (injected) return label === "css" ? injected.css : injected.editor;

        const path = label === "css" ? "/language/css/css.worker.js" : "/editor/editor.worker.js";
        return new URL(BASE + path, baseUrl).toString();
    }
};

const ready = getCurrentCss().then(css => {
    const editor = monaco.editor.create(
        document.getElementById("container")!,
        {
            value: css,
            language: "css",
            theme: getTheme(),
        }
    );
    editor.onDidChangeModelContent(() =>
        setCss(editor.getValue())
    );
    window.addEventListener("resize", () => {
        // make monaco re-layout
        editor.layout();
    });
    return editor;
});

/*
 * monacoWin.html wires its toolbar to this. This module creates the editor itself
 * rather than returning one, so without a handle the Save/Copy/Undo/Redo buttons
 * would have nothing to drive. It is also how the caller knows the editor is up:
 * the CSS is resolved asynchronously, so the editor does not exist when this
 * script finishes executing.
 */
(self as any).quickCssEditorReady = ready;
