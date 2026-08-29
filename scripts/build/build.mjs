#!/usr/bin/node
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

// @ts-check

import { createPackage } from "@electron/asar";
import { copyFile, cp, readdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { BUILD_TIMESTAMP, commonOpts, exists, globPlugins, IS_DEV, IS_REPORTER, IS_COMPANION_TEST, IS_STANDALONE, IS_UPDATER_DISABLED, resolvePluginName, sourcemap, VERSION, commonRendererPlugins, watch, buildOrWatchAll, stringifyValues, IS_ANTI_CRASH_TEST } from "./common.mjs";

const defines = stringifyValues({
    IS_STANDALONE,
    IS_DEV,
    IS_REPORTER,
    IS_COMPANION_TEST,
    IS_UPDATER_DISABLED,
    IS_ANTI_CRASH_TEST,
    IS_WEB: false,
    IS_EXTENSION: false,
    IS_USERSCRIPT: false,
    VERSION,
    BUILD_TIMESTAMP
});

if (defines.IS_STANDALONE === "false") {
    // If this is a local build (not standalone), optimize
    // for the specific platform we're on
    defines["process.platform"] = JSON.stringify(process.platform);
}

/**
 * @type {import("esbuild").BuildOptions}
 */
const nodeCommonOpts = {
    ...commonOpts,
    define: defines,
    format: "cjs",
    platform: "node",
    target: ["esnext"],
    // @ts-expect-error this is never undefined
    external: ["electron", "original-fs", "~pluginNatives", ...commonOpts.external]
};

// Only the "external" (non-watch dev) build writes .map files to disk, so it is the
// only one that may point at them - watch mode carries them inline, and release has
// none to link to.
const sourceMapFooter = s => sourcemap === "external" ? `//# sourceMappingURL=vencord://${s}.js.map` : "";

/**
 * @type {import("esbuild").Plugin}
 */
const globNativesPlugin = {
    name: "glob-natives-plugin",
    setup: build => {
        const filter = /^~pluginNatives$/;
        build.onResolve({ filter }, args => {
            return {
                namespace: "import-natives",
                path: args.path
            };
        });

        build.onLoad({ filter, namespace: "import-natives" }, async () => {
            const pluginDirs = ["plugins", "equicordplugins", "userplugins"];
            let code = "";
            let natives = "\n";
            let i = 0;
            /**
             * @type {string[]}
             */
            const watchFiles = [];
            for (const dir of pluginDirs) {
                const dirPath = join("src", dir);
                if (!await exists(dirPath)) continue;
                const plugins = await readdir(dirPath, { withFileTypes: true });
                for (const file of plugins) {
                    const fileName = file.name;
                    const nativePath = join(dirPath, fileName, "native.ts");
                    const indexNativePath = join(dirPath, fileName, "native/index.ts");

                    watchFiles.push(resolve(nativePath), resolve(indexNativePath));

                    if (!(await exists(nativePath)) && !(await exists(indexNativePath)))
                        continue;

                    const pluginName = await resolvePluginName(dirPath, file);

                    const mod = `p${i}`;
                    code += `import * as ${mod} from "./${dir}/${fileName}/native";\n`;
                    natives += `${JSON.stringify(pluginName)}:${mod},\n`;
                    i++;
                }
            }
            code += `export default {${natives}};`;
            return {
                contents: code,
                resolveDir: "./src",
                watchDirs: pluginDirs.map(d => resolve("src", d)),
                watchFiles,
            };
        });
    }
};

/** @type {import("esbuild").BuildOptions[]} */
const buildConfigs = ([
    // Discord Desktop main & renderer & preload
    {
        ...nodeCommonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/main/index.ts")],
        outfile: "dist/desktop/patcher.js",
        footer: { js: "//# sourceURL=file:///VencordPatcher\n" + sourceMapFooter("patcher") },
        sourcemap,
        plugins: [
            // @ts-ignore this is never undefined
            ...nodeCommonOpts.plugins,
            globNativesPlugin
        ],
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "true",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "false"
        }
    },
    {
        ...commonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/Vencord.ts")],
        outfile: "dist/desktop/renderer.js",
        format: "iife",
        target: ["esnext"],
        footer: { js: "//# sourceURL=file:///VencordRenderer\n" + sourceMapFooter("renderer") },
        globalName: "Vencord",
        sourcemap,
        plugins: [
            globPlugins("discordDesktop"),
            ...commonOpts.plugins
        ],
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "true",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "false"
        }
    },
    {
        ...nodeCommonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/preload.ts")],
        outfile: "dist/desktop/preload.js",
        footer: { js: "//# sourceURL=file:///VencordPreload\n" + sourceMapFooter("preload") },
        sourcemap,
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "true",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "false"
        }
    },

    // Vencord Desktop main & renderer & preload
    {
        ...nodeCommonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/main/index.ts")],
        outfile: "dist/equibop/main.js",
        footer: { js: "//# sourceURL=file:///VencordDesktopMain\n" + sourceMapFooter("main") },
        sourcemap,
        plugins: [
            ...nodeCommonOpts.plugins,
            globNativesPlugin
        ],
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "false",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "true"
        }
    },
    {
        ...commonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/Vencord.ts")],
        outfile: "dist/equibop/renderer.js",
        format: "iife",
        target: ["esnext"],
        footer: { js: "//# sourceURL=file:///VencordDesktopRenderer\n" + sourceMapFooter("renderer") },
        globalName: "Vencord",
        sourcemap,
        plugins: [
            globPlugins("equibop"),
            ...commonRendererPlugins
        ],
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "false",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "true"
        }
    },
    {
        ...nodeCommonOpts,
        entryPoints: [join(dirname(fileURLToPath(import.meta.url)), "../../src/preload.ts")],
        outfile: "dist/equibop/preload.js",
        footer: { js: "//# sourceURL=file:///VencordPreload\n" + sourceMapFooter("preload") },
        sourcemap,
        define: {
            ...defines,
            IS_DISCORD_DESKTOP: "false",
            IS_VESKTOP: "false",
            IS_EQUIBOP: "true"
        }
    }
]);

// esbuild only overwrites the files it emits, so anything a previous build left behind
// - such as the sourcemaps releases no longer produce - would still be picked up by the
// unfiltered createPackage below. Watch mode keeps its output in place so a client
// running against dist isn't left without a bundle mid-rebuild.
if (!watch) {
    await Promise.all([
        rm("dist/desktop", { recursive: true, force: true }),
        rm("dist/equibop", { recursive: true, force: true })
    ]);
}

await buildOrWatchAll(buildConfigs);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MONACO_VS = join(REPO_ROOT, "node_modules/monaco-editor/min/vs");
const MONACO_WIN_HTML = join(REPO_ROOT, "src/main/monacoWin.html");

// The QuickCSS editor used to pull Monaco from a CDN, which meant unpinned remote
// code in an Electron window and the user's IP disclosed on every open. Monaco now
// ships inside the asar, so the whole AMD module tree has to be on disk next to the
// editor page.
//
// min/vs is ~16 MB whole. These entries are dead weight for a window that only ever
// opens one CSS document, and they are the bulk of the size. Everything not matched
// here is copied: the AMD loader resolves modules lazily, so a chunk missing from
// the copy is not a build error, it is a blank editor the next user to open it finds.
// Filenames under min/vs are content-hashed and change on every Monaco upgrade, so
// these match by shape rather than by literal hash.
const MONACO_SKIP = [
    // Language workers for languages this editor cannot open: TypeScript (6.7 MB),
    // HTML (677 KB), JSON (374 KB). css.worker and editor.worker are kept.
    /[\\/]assets[\\/](?:ts|html|json)\.worker-[^\\/]+\.js$/,
    // Editor-chrome translations, ~1.5 MB across 14 languages. The English bundle is
    // the one with no language tag - nls.messages.js.js - and is excluded from this.
    /[\\/]nls\.messages\.(?!js\.js$)[^\\/]+\.js\.js$/
];

/** @param {string} variant */
async function emitEditorAssets(variant) {
    await cp(MONACO_VS, join("dist", variant, "monaco/vs"), {
        recursive: true,
        filter: src => !MONACO_SKIP.some(re => re.test(src))
    });
    // Emitted as a real file rather than inlined as a data: URL, because relative
    // sub-resource paths - which is how the page now finds ./monaco/vs - only
    // resolve against a real document URL.
    await copyFile(MONACO_WIN_HTML, join("dist", variant, "monacoWin.html"));
}

await Promise.all([
    emitEditorAssets("desktop"),
    emitEditorAssets("equibop")
]);

/*
 * THE SETUP GUIDE SHIPS INSIDE THE DESKTOP BUNDLE, AND THIS IS WHY.
 *
 * The plugin's "Setup Guide" control had exactly one destination on the desktop
 * before this: https://github.com/<slug>, the whole repository page. The
 * extension build has never had that problem — scripts/build/buildWeb.mjs packages
 * this same file as guide.html and the plugin opens it out of the extension origin
 * — so the desktop was the one build with no guide to open, and it fell all the
 * way through to the project page. The operator's words: "Setup Guide should
 * always link to a page which dedicated on Setup Guide only, not entire repo page."
 *
 * Copied beside the bundle rather than inlined into it. The alternative pattern in
 * this repo is src/main/trayMenu.ts's `import aboutHtml from "file://about.html?minify"`,
 * which turns the page into a string in the main bundle and opens it as a
 * data: URL. That is right for a 5 KB About box and wrong for this: the guide is
 * ~363 KB carrying four inlined base64 PNGs, so inlining it would grow patcher.js
 * and main.js by that much and pay for it on every startup, for a window most
 * users never open; and base64-ing the whole document again to fit it in a URL
 * would push most of a megabyte through loadURL. This follows monacoWin.html
 * instead — a real file next to the bundle, loaded with loadFile.
 *
 * THE NAME IS A CONTRACT with SETUP_GUIDE_PATH in src/main/ipcMain.ts, which is
 * the only thing that ever opens it. It deliberately matches GUIDE_PACKAGED_NAME
 * in buildWeb.mjs so that both builds carry the guide under one filename.
 *
 * ABSENT IS A HARD BUILD FAILURE. This comment used to say the exact opposite, and
 * justified warning-and-continuing with "site/ is untracked, so a checkout that does
 * not carry it still has to build". THAT PREMISE IS FALSE: the guide source is
 * tracked — `git ls-files site` lists five entries, site/free/index.html among them
 * — and .gitignore says nothing about site/. There is no ordinary checkout that
 * legitimately lacks the guide, so a tree that cannot read it is broken, and the
 * right response to a broken tree is to stop rather than to ship around it.
 *
 * WHAT THE OLD BEHAVIOUR BOUGHT WAS A SILENTLY GUIDE-LESS CLIENT. The operator's
 * instruction is that the Setup Guide always opens a page dedicated to it, so a build
 * that quietly drops that page ships the feature broken while reporting success. No
 * layer downstream catches it, because every one of them behaves "honestly" about the
 * absence: src/main/ipcMain.ts answers HAS_SETUP_GUIDE with false and the plugin's
 * guideTarget() falls back to the project page. The defect therefore surfaces days
 * later, as a user clicking Setup Guide and landing on the whole repo. Failing here
 * costs one build and names the missing file.
 *
 * A PRESENT BUT UNDERSIZED source is a hard failure for the same reason, and always
 * was: that is a truncated write, and shipping half a guide is worse than shipping
 * none.
 *
 * SCOPE, DELIBERATE. scripts/build/buildWeb.mjs and scripts/checkExtensionPackages.mjs
 * still treat an absent guide as survivable, and still carry the same false premise in
 * their own comments. Whether the EXTENSION build should become strict too is a
 * separate decision that has not been taken; this change is the desktop build only.
 */
const SETUP_GUIDE_SOURCE = join(REPO_ROOT, "site/free/index.html");
const SETUP_GUIDE_BUNDLED_NAME = "guide.html";
/** Matches GUIDE_MIN_BYTES in buildWeb.mjs and checkExtensionPackages.mjs. */
const SETUP_GUIDE_MIN_BYTES = 50_000;

/**
 * The guide's bytes. Throws rather than returning empty-handed: there is no
 * "built without the guide" outcome on the desktop any more.
 *
 * Read once and written twice rather than copyFile'd twice: the size floor has
 * to be measured on the bytes that actually get written, and a separate stat
 * would be describing a file the copy never read.
 *
 * @returns {Promise<Buffer>}
 */
async function loadSetupGuide() {
    let content;
    try {
        content = await readFile(SETUP_GUIDE_SOURCE);
    } catch (err) {
        const why = /** @type {NodeJS.ErrnoException} */ (err).code ?? String(err);
        throw new Error(
            `Refusing to build the desktop client without the setup guide: ${SETUP_GUIDE_SOURCE} ` +
            `could not be read (${why}). That file is TRACKED IN GIT, so a tree that cannot read ` +
            "it is broken rather than ordinary - restore it and build again. Continuing would " +
            `produce a client carrying no ${SETUP_GUIDE_BUNDLED_NAME}, whose "Setup Guide" control ` +
            "falls back to the whole project page on GitHub: the feature silently broken, by a " +
            "build that reported success."
        );
    }

    if (content.length < SETUP_GUIDE_MIN_BYTES) {
        throw new Error(
            `Refusing to bundle ${SETUP_GUIDE_SOURCE}: ${content.length} bytes is below the ` +
            `${SETUP_GUIDE_MIN_BYTES}-byte floor. The guide is a single self-contained page of ` +
            "several hundred KB, so a file this small is a truncated write rather than the " +
            "guide. Restore the full file; deleting it is no longer a way to get a build."
        );
    }

    return content;
}

// Unconditional. loadSetupGuide() either returns the bytes or throws, so there is no
// longer a branch in which this build continues without writing the guide.
const setupGuide = await loadSetupGuide();
await Promise.all([
    writeFile(join("dist", "desktop", SETUP_GUIDE_BUNDLED_NAME), setupGuide),
    writeFile(join("dist", "equibop", SETUP_GUIDE_BUNDLED_NAME), setupGuide)
]);
console.log(
    `Setup guide bundled as ${SETUP_GUIDE_BUNDLED_NAME} in both desktop variants ` +
    `(${(setupGuide.length / 1024).toFixed(0)} KB from ${SETUP_GUIDE_SOURCE}).`
);

await Promise.all([
    writeFile("dist/desktop/package.json", JSON.stringify({
        name: "equicord",
        main: "patcher.js"
    })),
    writeFile("dist/equibop/package.json", JSON.stringify({
        name: "equicord",
        main: "main.js"
    }))
]);

await Promise.all([
    createPackage("dist/desktop", "dist/desktop.asar"),
    createPackage("dist/equibop", "dist/equibop.asar"),
]);
