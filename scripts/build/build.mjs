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
import { copyFile, cp, readdir, rm, writeFile } from "fs/promises";
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
