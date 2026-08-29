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

import "./updater";
import "./ipcPlugins";
import "./settings";

import { debounce } from "@shared/debounce";
import { IpcEvents } from "@shared/IpcEvents";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, systemPreferences } from "electron";
import { existsSync, FSWatcher, mkdirSync, readFileSync, watch, writeFileSync } from "fs";
import { open, readdir, readFile, unlink } from "fs/promises";
import { release } from "os";
import { join } from "path";

import { registerCspIpcHandlers } from "./csp/manager";
import { getThemeInfo, stripBOM, UserThemeHeader } from "./themes";
import { ALLOWED_PROTOCOLS, QUICK_CSS_PATH, SETTINGS_DIR, THEMES_DIR } from "./utils/constants";
import { ensureSafePath } from "./utils/ensureSafePath";
import { makeLinksOpenExternally } from "./utils/externalLinks";

const RENDERER_CSS_PATH = join(__dirname, "renderer.css");

mkdirSync(THEMES_DIR, { recursive: true });

registerCspIpcHandlers();

function readCss() {
    return readFile(QUICK_CSS_PATH, "utf-8").catch(() => "");
}

async function listThemes(): Promise<UserThemeHeader[]> {
    const files = await readdir(THEMES_DIR).catch(() => []);

    const themeInfo: UserThemeHeader[] = [];

    for (const fileName of files) {
        if (!fileName.endsWith(".css")) continue;

        const data = await getThemeData(fileName).then(stripBOM).catch(() => null);
        if (data == null) continue;

        themeInfo.push(getThemeInfo(data, fileName));
    }

    return themeInfo;
}

function getThemeData(fileName: string) {
    fileName = fileName.replace(/\?v=\d+$/, "");
    const safePath = ensureSafePath(THEMES_DIR, fileName);
    if (!safePath) return Promise.reject(`Unsafe path ${fileName}`);
    return readFile(safePath, "utf-8");
}

ipcMain.handle(IpcEvents.OPEN_QUICKCSS, () => shell.openPath(QUICK_CSS_PATH));

ipcMain.handle(IpcEvents.OPEN_EXTERNAL, (_, url) => {
    try {
        var { protocol } = new URL(url);
    } catch {
        throw "Malformed URL";
    }
    if (!ALLOWED_PROTOCOLS.includes(protocol))
        throw "Disallowed protocol.";

    shell.openExternal(url)
        .catch(err => console.error("[Vencord] Failed to open external link", url, err));
});

ipcMain.handle(IpcEvents.GET_QUICK_CSS, () => readCss());
ipcMain.handle(IpcEvents.SET_QUICK_CSS, (_, css) =>
    writeFileSync(QUICK_CSS_PATH, css)
);

ipcMain.handle(IpcEvents.GET_THEMES_LIST, () => listThemes());
ipcMain.handle(IpcEvents.GET_THEME_DATA, (_, fileName) => getThemeData(fileName));
ipcMain.handle(IpcEvents.DELETE_THEME, (_, fileName) => {
    const safePath = ensureSafePath(THEMES_DIR, fileName);
    if (!safePath) return Promise.reject(`Unsafe path ${fileName}`);
    return unlink(safePath);
});
ipcMain.handle(IpcEvents.GET_THEME_SYSTEM_VALUES, () => {
    let accentColor = systemPreferences.getAccentColor?.() ?? "";

    if (accentColor.length && accentColor[0] !== "#") {
        accentColor = `#${accentColor}`;
    }

    return {
        "os-accent-color": accentColor
    };
});

ipcMain.handle(IpcEvents.OPEN_THEMES_FOLDER, () => shell.openPath(THEMES_DIR));
ipcMain.handle(IpcEvents.OPEN_SETTINGS_FOLDER, () => shell.openPath(SETTINGS_DIR));

let fsWatchers = [] as FSWatcher[];

ipcMain.handle(IpcEvents.INIT_FILE_WATCHERS, ({ sender }) => {
    fsWatchers.forEach(w => w.close());

    let quickCssWatcher: FSWatcher | undefined;
    let rendererCssWatcher: FSWatcher | undefined;

    open(QUICK_CSS_PATH, "a+").then(fd => {
        fd.close();
        quickCssWatcher = watch(QUICK_CSS_PATH, { persistent: false }, debounce(async () => {
            sender.postMessage(IpcEvents.QUICK_CSS_UPDATE, await readCss());
        }, 50));
    }).catch(() => { });

    const themesWatcher = watch(THEMES_DIR, { persistent: false }, debounce(() => {
        sender.postMessage(IpcEvents.THEME_UPDATE, void 0);
    }));

    if (IS_DEV) {
        rendererCssWatcher = watch(RENDERER_CSS_PATH, { persistent: false }, async () => {
            sender.postMessage(IpcEvents.RENDERER_CSS_UPDATE, await readFile(RENDERER_CSS_PATH, "utf-8"));
        });
    }

    fsWatchers = [quickCssWatcher, themesWatcher, rendererCssWatcher].filter(Boolean) as FSWatcher[];

    sender.once("destroyed", () => {
        quickCssWatcher?.close();
        themesWatcher.close();
        rendererCssWatcher?.close();
        fsWatchers = [];
    });
});

ipcMain.on(IpcEvents.GET_MONACO_THEME, e => {
    e.returnValue = nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs-light";
});

let monacoWin: BrowserWindow | null = null;

ipcMain.handle(IpcEvents.OPEN_MONACO_EDITOR, async () => {
    if (monacoWin && !monacoWin.isDestroyed()) {
        monacoWin.show();
        monacoWin.focus();
        return;
    }

    monacoWin = new BrowserWindow({
        title: "Discord Translator QuickCSS Editor",
        autoHideMenuBar: true,
        darkTheme: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "white",
        webPreferences: {
            preload: join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    monacoWin.once("closed", () => { monacoWin = null; });

    makeLinksOpenExternally(monacoWin);

    // A real file URL, not the data: URL this used to be: relative paths are how the
    // page reaches the bundled Monaco, and they need a document URL to resolve
    // against. __dirname points inside the asar and Electron's asar layer serves file
    // reads from it. src/preload.ts keys off this pathname to tell the editor window
    // apart from Discord's - change one and you must change the other.
    await monacoWin.loadFile(join(__dirname, "monacoWin.html"));
});

/**
 * The setup guide, under the name scripts/build/build.mjs copies it into the
 * bundle as.
 *
 * ONE spelling on this side of the boundary, exactly as GUIDE_FILE in
 * src/plugins/channelTranslator/settings.ts is the one spelling for the
 * extension package. It must not drift from SETUP_GUIDE_BUNDLED_NAME in that
 * build script; if it does, HAS_SETUP_GUIDE below answers "no" and the settings
 * screen quietly falls back to the project page, which is the failure being
 * fixed here rather than a new one.
 *
 * __dirname is inside the asar, and Electron's asar layer serves file reads
 * from it — the same reason monacoWin.html above is loaded with loadFile.
 */
const SETUP_GUIDE_PATH = join(__dirname, "guide.html");

/**
 * Whether this build actually carries the guide. Answered ONCE, at startup.
 *
 * IT IS NOT ALWAYS THERE, AND THAT IS THE POINT OF ASKING. site/ is untracked,
 * so a machine that does not have site/free/index.html builds a perfectly good
 * client with no guide inside it — scripts/build/build.mjs prints a warning and
 * carries on rather than failing the build, exactly as scripts/build/buildWeb.mjs
 * already does for the extension package. The renderer has to be able to tell
 * those two builds apart BEFORE it draws anything, because a control labelled
 * "Open the setup guide" whose only outcome is nothing happening is the same
 * defect as the dead example.invalid link that HOSTED_GUIDE_URL's comment is
 * written about, one layer further down.
 *
 * Read once because it is a fact about the bundle rather than about the moment,
 * and because the renderer asks it synchronously on every render of the
 * settings screen — including on every keystroke in the Apps Script URL field.
 */
const HAS_SETUP_GUIDE = existsSync(SETUP_GUIDE_PATH);

ipcMain.on(IpcEvents.HAS_SETUP_GUIDE, e => {
    e.returnValue = HAS_SETUP_GUIDE;
});

let setupGuideWin: BrowserWindow | null = null;

/**
 * Open the bundled setup guide in a window of its own.
 *
 * IT TAKES NO ARGUMENTS, AND THAT IS THE WHOLE OF ITS SECURITY DESIGN. This
 * handler is reachable from Discord's own page world through VencordNative,
 * precisely like the translation transport in
 * src/plugins/channelTranslator/native.ts — which carries a hostname allow-list
 * for that reason and says so at length. A handler that accepted a path or a
 * URL would hand every script running on discord.com a "render any local file
 * in a window we opened" primitive; a handler with no parameters can only ever
 * open the one file this build shipped with. Do not add a parameter to it to
 * save a line somewhere else.
 *
 * Returns whether the guide was actually SHOWN — not merely whether a window was
 * constructed. A window that was created and then failed to load is reported as
 * false, because a caller told true would say nothing while the user looks at
 * either nothing or a blank frame.
 */
ipcMain.handle(IpcEvents.OPEN_SETUP_GUIDE, async () => {
    // Not merely defensive: the file can be deleted out from under a running
    // client, and answering false here is what stops a blank window appearing
    // in place of the guide.
    if (!HAS_SETUP_GUIDE || !existsSync(SETUP_GUIDE_PATH)) return false;

    if (setupGuideWin && !setupGuideWin.isDestroyed()) {
        setupGuideWin.show();
        setupGuideWin.focus();
        return true;
    }

    setupGuideWin = new BrowserWindow({
        title: "Discord Translator Setup Guide",
        center: true,
        autoHideMenuBar: true,
        width: 1100,
        height: 850,
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "white",
        // NO preload, NO node integration, and the sandbox left on. The guide is
        // a static page of documentation that wants nothing from this process,
        // so it is given nothing. Leaving the preload off has a second effect
        // worth naming: src/preload.ts classifies the window it was loaded into
        // by pathname, to tell the QuickCSS editor apart from Discord, and a
        // third kind of window would be a third way for that classification to
        // go wrong — as it already did once when the editor stopped being a
        // data: URL.
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    // A local handle to the window THIS call created. Every cleanup below
    // compares against it rather than trusting setupGuideWin to still point
    // here: a "closed" arriving late from a window the user already dismissed
    // would otherwise null out a window a later click had since opened and
    // stored, orphaning a live window that nothing can focus again.
    const win = setupGuideWin;

    win.once("closed", () => {
        if (setupGuideWin === win) setupGuideWin = null;
    });

    /**
     * Every link in the guide leaves this window, and only a web address leaves
     * it at all.
     *
     * The shape is the About window's (src/main/trayMenu.ts), with one
     * deliberate difference: that page is a string this repo generates, and this
     * one is not. site/free/index.html is hand-authored documentation, and it
     * demonstrably grows relative links: it carried three
     * `<a href="../index.html">` cross-links to a sibling guide that was never
     * bundled, which under a file:// document resolve to a real path on this
     * machine. Those three are gone — the paid provider they advertised was
     * removed from the plugin — but THIS FILTER IS NOT CONDITIONAL ON THEM AND
     * MUST NOT BE DELETED WITH THEM. shell.openExternal() on a file:// URL asks
     * the OS to open a local file with whatever is registered for its extension,
     * so handing it every url the way the About window does would turn the next
     * stale relative link into a shell invocation. The protocol is therefore
     * checked first and anything that is not http(s) is dropped on the floor —
     * the navigation is still prevented either way, so the guide window can
     * never be steered off the guide.
     *
     * In-page anchors (the guide's own table of contents, href="#…") are
     * same-document navigations and do not raise will-navigate at all, so they
     * keep working.
     */
    const openExternally = (url: string) => {
        let protocol: string;
        try {
            ({ protocol } = new URL(url));
        } catch {
            return;
        }

        if (protocol !== "http:" && protocol !== "https:") return;

        shell.openExternal(url)
            .catch(err => console.error("[Discord Translator] Failed to open a link from the setup guide", url, err));
    };

    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternally(url);
        return { action: "deny" };
    });

    win.webContents.on("will-navigate", (e, url) => {
        e.preventDefault();
        openExternally(url);
    });

    // loadFile, not a data: URL. The guide is 363 KB of HTML carrying four
    // inlined base64 images; base64-ing the whole document a second time to fit
    // it in a URL would push most of a megabyte through loadURL for no benefit,
    // and it would have to be inlined into the main bundle at build time to be
    // available here at all — paid on every startup, for a window most users
    // never open. A real file URL is also what gives the page a document URL to
    // resolve against, which is the same reason monacoWin.html is emitted as a
    // file above.
    try {
        await win.loadFile(SETUP_GUIDE_PATH);
    } catch (err) {
        // A CONSTRUCTED-BUT-UNLOADED WINDOW IS THE WORST OUTCOME AVAILABLE HERE,
        // which is why this is not merely logged. Left in place it is a blank
        // frame that still satisfies the "already open?" test at the top of this
        // handler, so every later click would show() and focus() the blank
        // window and answer true — the guide would be permanently unopenable for
        // the rest of the session, and the plugin would report success each
        // time. Tearing it down and forgetting it is what makes the next click a
        // clean retry.
        console.error("[Discord Translator] Failed to load the setup guide", SETUP_GUIDE_PATH, err);
        if (setupGuideWin === win) setupGuideWin = null;
        if (!win.isDestroyed()) win.destroy();
        return false;
    }

    return true;
});

app.on("before-quit", async event => {
    if (monacoWin && !monacoWin.isDestroyed() && !monacoWin.isVisible()) {
        const result = await dialog.showMessageBox({
            type: "question",
            buttons: ["Cancel", "Close Anyway"],
            defaultId: 0,
            title: "QuickCSS Editor Open",
            message: "QuickCSS editor is still open in the background.",
            detail: "Do you want to close Discord anyway? This will also close the QuickCSS editor."
        });

        if (result.response === 1) {
            app.exit();
        }
    }
});

ipcMain.handle(IpcEvents.GET_RENDERER_CSS, () => readFile(RENDERER_CSS_PATH, "utf-8"));

if (IS_DISCORD_DESKTOP) {
    ipcMain.on(IpcEvents.PRELOAD_GET_RENDERER_JS, e => {
        e.returnValue = readFileSync(join(__dirname, "renderer.js"), "utf-8");
    });
}

ipcMain.on(IpcEvents.SUPPORTS_WINDOWS_MATERIAL, e => {
    e.returnValue = process.platform === "win32" && Number(release().split(".")[2]) >= 22621;
});
