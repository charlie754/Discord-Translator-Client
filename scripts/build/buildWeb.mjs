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

import { readFileSync } from "fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import path, { join } from "path";
import Zip from "zip-local";

import { BUILD_TIMESTAMP, commonOpts, globPlugins, IS_DEV, IS_ANTI_CRASH_TEST, IS_REPORTER, IS_COMPANION_TEST, IS_STANDALONE, VERSION, commonRendererPlugins, buildOrWatchAll, stringifyValues } from "./common.mjs";

/**
 * @type {import("esbuild").BuildOptions}
 */
const commonOptions = {
    ...commonOpts,
    entryPoints: ["browser/Vencord.ts"],
    format: "iife",
    globalName: "Vencord",
    external: ["~plugins", "~git-hash", "/assets/*"],
    target: ["esnext"],
    plugins: [
        globPlugins("web"),
        ...commonRendererPlugins
    ],
    define: stringifyValues({
        IS_WEB: true,
        IS_EXTENSION: false,
        IS_USERSCRIPT: false,
        IS_STANDALONE,
        IS_DEV,
        IS_REPORTER,
        IS_COMPANION_TEST,
        IS_ANTI_CRASH_TEST,
        IS_DISCORD_DESKTOP: false,
        IS_VESKTOP: false,
        IS_EQUIBOP: false,
        IS_UPDATER_DISABLED: true,
        VERSION,
        BUILD_TIMESTAMP
    })
};

const MonacoWorkerEntryPoints = [
    "vs/language/css/css.worker.js",
    "vs/editor/editor.worker.js"
];

/** @type {import("esbuild").BuildOptions[]} */
const buildConfigs = [
    {
        entryPoints: MonacoWorkerEntryPoints.map(entry => `node_modules/monaco-editor/esm/${entry}`),
        bundle: true,
        minify: true,
        format: "iife",
        outbase: "node_modules/monaco-editor/esm/",
        outdir: "dist/browser/vendor/monaco"
    },
    {
        entryPoints: ["browser/monaco.ts"],
        bundle: true,
        minify: true,
        format: "iife",
        outfile: "dist/browser/vendor/monaco/index.js",
        loader: {
            ".ttf": "file"
        }
    },
    {
        ...commonOptions,
        outfile: "dist/browser/browser.js",
        footer: { js: "//# sourceURL=file:///VencordWeb" }
    },
    {
        ...commonOptions,
        outfile: "dist/browser/extension.js",
        define: {
            ...commonOptions.define,
            IS_EXTENSION: "true"
        },
        footer: { js: "//# sourceURL=file:///VencordWeb" }
    },
    {
        ...commonOptions,
        inject: ["browser/GMPolyfill.js", ...(commonOptions?.inject || [])],
        define: {
            ...commonOptions.define,
            IS_USERSCRIPT: "true",
            window: "unsafeWindow",
        },
        outfile: "dist/DiscordTranslator.user.js",
        banner: {
            js: readFileSync("browser/userscript.meta.js", "utf-8").replace("%version%", `${VERSION}.${new Date().getTime()}`)
        },
        footer: {
            // UserScripts get wrapped in an iife, so define Vencord prop on window that returns our local
            js: "Object.defineProperty(unsafeWindow,'Vencord',{get:()=>Vencord});"
        }
    }
];

await buildOrWatchAll(buildConfigs);

/**
 * @type {(dir: string) => Promise<string[]>}
 */
async function globDir(dir) {
    const files = [];

    for (const child of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, child.name);
        if (child.isDirectory())
            files.push(...await globDir(p));
        else
            files.push(p);
    }

    return files;
}

/**
 * @type {(dir: string, basePath?: string) => Promise<Record<string, string>>}
 */
async function loadDir(dir, basePath = "") {
    const files = await globDir(dir);
    return Object.fromEntries(
        await Promise.all(
            files.map(
                async f =>
                    [f.slice(basePath.length), await readFile(f)]
            )
        )
    );
}

/*
 * The setup guide, shipped INSIDE the extension rather than fetched from a site.
 *
 * The guide is what turns "paste a deployment URL here" into something a
 * non-developer can actually do, so it is the last thing that should depend on a
 * domain still being paid for. site/free/index.html is one self-contained file —
 * its images are already inlined as data URIs — so packaging it is a copy rather
 * than a tree walk, and it has no sibling that can be left behind.
 *
 * GUIDE_PACKAGED_NAME is a contract with two other files and must not drift from
 * either:
 *   - src/plugins/channelTranslator/settings.ts opens
 *     `new URL("guide.html", EXTENSION_BASE_URL)` when its button is clicked
 *   - scripts/checkExtensionPackages.mjs fails a package that does not carry it
 *
 * THE GUIDE IS OPTIONAL AT BUILD TIME, AND THAT IS A CORRECTION, NOT A
 * RELAXATION. This step used to throw when GUIDE_SOURCE could not be read, on the
 * reasoning that a complete-looking extension with a 404 guide button is worse
 * than a loud failure. The reasoning was sound and the premise was false: site/
 * is NOT TRACKED — `git ls-files site` returns nothing — so no CI checkout has
 * ever had it, and `pnpm buildWeb --standalone` threw before it built anything at
 * all. A guard on a nice-to-have was taking the whole extension down.
 *
 * So an ABSENT source is a loud warning and the build continues without the
 * guide; a PRESENT BUT UNDERSIZED source is still a hard failure, because that is
 * a truncated or stubbed write rather than a machine that simply does not carry
 * the file. Absence and corruption are different findings and get different
 * answers.
 *
 * Downstream, scripts/checkExtensionPackages.mjs makes its guide assertions
 * conditional on guide.html being packaged at all — but keeps every one of them
 * when it IS packaged, including the byte-identity and size-floor checks. A
 * package built without the guide is not reported as a failure; a package that
 * carries a broken one still is.
 */
const GUIDE_SOURCE = "site/free/index.html";
const GUIDE_PACKAGED_NAME = "guide.html";
/**
 * A floor, not a target. The real file is ~338 KB; this only has to be high
 * enough that a truncated write, an empty placeholder or a stub committed by
 * accident cannot pass for the guide. checkExtensionPackages.mjs applies the
 * same floor to the PACKAGED copy, which is the one users get.
 */
const GUIDE_MIN_BYTES = 50_000;

/*
 * ---------------------------------------------------------------------------
 * THE INLINE SCRIPT IS SPLIT OUT HERE, BECAUSE AN EXTENSION PAGE MAY NOT RUN ONE
 * ---------------------------------------------------------------------------
 *
 * THE DEFECT. The guide's whole interactive layer — step ticking, the progress
 * bar, the localStorage that remembers where you got to, the jump menu, the reset
 * button, the live region — lives in ONE inline <script> block. Opened as a file
 * or served from a website that block runs. Opened as chrome-extension://<id>/
 * guide.html it does not, and never has: extension pages are served under
 * `script-src 'self'`, which forbids inline execution. The operator's console
 * said so in as many words —
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive "script-src 'self'". ... The action has been blocked.
 *   Context: guide.html — Stack Trace: guide.html:1143
 *
 * This is not a regression. It shipped in v0.2.7 and in every build since, so the
 * guide has been a static page for every extension user since it launched, and it
 * looked exactly like a working one until someone ticked a step.
 *
 * WHY THE MANIFEST CANNOT FIX IT. The obvious cheaper repair — declare
 * `content_security_policy.extension_pages` with the block's sha256 — is not
 * available on MV3. Chromium's own validator takes a different path for MV3 than
 * for MV2: extensions/common/csp_validator.cc calls IsHashSource() only from
 * GetSecureDirectiveValues() (the MV2 sanitiser), while the MV3 path,
 * DoesCSPDisallowRemoteCode(), accepts a script source only if
 *
 *     source_lower == kSelfSource || source_lower == kNoneSource ||
 *     IsLocalHostSource(source_lower) ||
 *     source_lower == kWasmUnsafeEvalSource;
 *
 * Anything else — a hash included — is rejected with kInvalidCSPInsecureValueError
 * and the extension fails to load. MDN says the same in one sentence: "Manifest V3
 * does not allow CSP hashes in script-src of extension_pages." A hash would also
 * have to be recomputed on every edit to the guide, which is a second reason not
 * to want it.
 *
 * WHY THE SOURCE IS NOT CHANGED INSTEAD. site/free/index.html is deliberately ONE
 * self-contained file — its images are inlined as data URIs precisely so it works
 * when opened in isolation, which is a property that was won by fixing this exact
 * problem once already. Splitting the script at source would take that away from
 * the standalone and website copies to serve the packaged one.
 *
 * So the split happens HERE, at package time, and only for the package: the source
 * keeps its inline script and stays one file, and the extension gets guide.html
 * plus a sibling guide.js that `script-src 'self'` is happy to load.
 *
 * WHAT THIS CANNOT FIX, AND WHO CATCHES IT. Extraction moves a <script> body; it
 * cannot rescue an inline `onclick=` handler or a `javascript:` URL, both of which
 * are equally dead under `script-src 'self'` and equally invisible. The guide has
 * neither today. scripts/checkExtensionPackages.mjs asserts that on the PACKAGED
 * bytes, so if one is ever added the gate fails rather than the user.
 */
const GUIDE_SCRIPT_NAME = "guide.js";

/**
 * Index of the ">" that closes the tag opening at `open`, or -1.
 *
 * Quote-aware rather than a `[^>]*` regex, so an attribute value containing ">"
 * cannot silently cut a tag in half and hand the caller a body that starts in the
 * middle of an attribute.
 *
 * @type {(html: string, open: number) => number}
 */
function tagEnd(html, open) {
    let quote = null;
    for (let i = open + 1; i < html.length; i++) {
        const c = html[i];
        if (quote !== null) {
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === ">") return i;
    }
    return -1;
}

/**
 * Split every inline <script> out of `html` into its own file.
 *
 * Works on a latin1 view of the bytes on purpose. This is a byte-level split at
 * ASCII delimiters, not a text transformation: latin1 is the one Node encoding
 * that round-trips arbitrary bytes unchanged, so a guide carrying anything that is
 * not valid UTF-8 comes out of here byte-identical instead of peppered with U+FFFD.
 *
 * A <script> that already has a src is left exactly as it is — it is already
 * loading from a file, which is the shape we are converting TO.
 *
 * @type {(html: string) => { html: string, scripts: { name: string, code: string }[] }}
 */
function splitGuideScripts(html) {
    const OPEN = /<script\b/gi;
    // Per the HTML spec a script element's text ends at the first "</script"
    // followed by whitespace, "/" or ">" — not at every "</script" substring — so
    // the delimiter is matched that way rather than as a bare indexOf.
    const CLOSE = /<\/script[\s/>]/i;

    /** @type {{ name: string, code: string }[]} */
    const scripts = [];
    let out = "";
    let cursor = 0;
    let m;

    while ((m = OPEN.exec(html)) !== null) {
        const start = m.index;
        const openEnd = tagEnd(html, start);
        if (openEnd === -1) {
            throw new Error(
                `Refusing to package ${GUIDE_SOURCE}: the <script> tag at byte ${start} is never ` +
                "closed by a \">\". The file is malformed, and splitting it would ship a guide " +
                "whose markup is cut in half."
            );
        }

        const attrs = html.slice(start + "<script".length, openEnd);
        const bodyStart = openEnd + 1;
        const closeOffset = html.slice(bodyStart).search(CLOSE);
        if (closeOffset === -1) {
            throw new Error(
                `Refusing to package ${GUIDE_SOURCE}: the <script> element at byte ${start} has ` +
                "no </script>. The file is malformed."
            );
        }

        const bodyEnd = bodyStart + closeOffset;
        const closeTagEnd = html.indexOf(">", bodyEnd) + 1;

        // lastIndex is moved past the whole element rather than left just after the
        // opening tag, so a "<script" appearing inside the JS as a string literal
        // cannot be mistaken for a second element.
        OPEN.lastIndex = closeTagEnd;

        if (/\bsrc\s*=/i.test(attrs)) continue;

        const code = html.slice(bodyStart, bodyEnd);
        // Numbered from the second on. The guide has exactly one block and the name
        // guide.js is what settings.ts and the gate expect to see referenced, but
        // concatenating several blocks into one file would change their semantics —
        // a syntax error in one would take the others down with it — so each keeps
        // its own file and its own place in the document order.
        const name = scripts.length === 0 ? GUIDE_SCRIPT_NAME : `guide.${scripts.length + 1}.js`;
        scripts.push({ name, code });

        out += html.slice(cursor, start) + `<script src="${name}"></script>`;
        cursor = closeTagEnd;
    }

    out += html.slice(cursor);
    return { html: out, scripts };
}

/**
 * Read the guide and split its inline script out, or null if this machine does not
 * carry the guide at all.
 *
 * @type {() => Promise<{ html: Buffer, scripts: { name: string, content: Buffer }[] } | null>}
 */
async function loadGuide() {
    let content;
    try {
        content = await readFile(GUIDE_SOURCE);
    } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        // Loud on stderr and unmissable in a build log. Silence here would be the
        // defect this replaced, wearing the opposite coat: an extension that is
        // quietly one file short and nothing anywhere saying which file.
        console.warn(
            "\n!!!! ------------------------------------------------------------------------\n" +
            `!!!! SETUP GUIDE NOT PACKAGED: ${GUIDE_SOURCE} could not be read (${why}).\n` +
            `!!!! The extension is being built WITHOUT ${GUIDE_PACKAGED_NAME}. It will install,\n` +
            "!!!! run and translate; the plugin's \"Open the setup guide\" button will not open\n" +
            "!!!! anything. site/ is not tracked in git, so this is expected on any machine\n" +
            "!!!! that did not author it — including CI. Restore the file to ship the guide.\n" +
            "!!!! ------------------------------------------------------------------------\n"
        );
        return null;
    }

    if (content.length < GUIDE_MIN_BYTES) {
        // Still a hard failure. A file that is PRESENT and too small is a truncated
        // write or a stub, which is a corrupt input rather than a missing optional
        // one, and shipping it would put a broken 0-byte page behind the button.
        throw new Error(
            `Refusing to package ${GUIDE_SOURCE}: ${content.length} bytes is below the ` +
            `${GUIDE_MIN_BYTES}-byte floor. The guide is a single self-contained page of ` +
            "roughly 338 KB with its images inlined, so something this small is a stub or a " +
            "truncated write rather than the guide. Delete the file to build without the " +
            "guide; do not ship a truncated one."
        );
    }

    const split = splitGuideScripts(content.toString("latin1"));
    const html = Buffer.from(split.html, "latin1");

    if (split.scripts.length === 0) {
        // Not a failure: a guide with no script of its own is a static page, which
        // is a legitimate thing for it to be. It is worth saying out loud, because
        // the guide DOES have an interactive layer today and its silent
        // disappearance would look identical to this line never printing.
        console.info(
            `Setup guide packaged as ${GUIDE_PACKAGED_NAME} with no inline script to extract ` +
            "— it carries no interactive layer."
        );
    } else {
        console.info(
            `Setup guide: extracted ${split.scripts.length} inline script(s) out of ` +
            `${GUIDE_SOURCE} into ${split.scripts.map(s => s.name).join(", ")} ` +
            `(${split.scripts.reduce((n, s) => n + Buffer.byteLength(s.code, "latin1"), 0)} bytes of code). ` +
            "The source keeps its inline copy; extension pages may not run one."
        );
    }

    return {
        html,
        scripts: split.scripts.map(s => ({ name: s.name, content: Buffer.from(s.code, "latin1") }))
    };
}

/**
 * loadGuide(), memoised and lazy.
 *
 * Lazy for the reason the old call site gave: buildExtension() is the only thing
 * that packages anything, so reading at module scope would make `--skip-extension`
 * touch a file it was never going to use. Memoised because buildExtension() runs
 * once per target, and a machine without site/ should say so once rather than
 * once per package.
 *
 * @type {Promise<{ html: Buffer, scripts: { name: string, content: Buffer }[] } | null> | undefined}
 */
let guideOnce;
const getGuide = () => (guideOnce ??= loadGuide());

/**
 * Delete every documentation key from a parsed manifest, in place.
 *
 * The source manifests explain themselves in "_comment"-prefixed keys: why the
 * add-on id changed in v0.2.8 and must never change again after publication, why
 * strict_min_version is 140.0 rather than 128, what each declared data collection
 * permission actually covers. That knowledge is worth more than the warnings it
 * causes and it stays in browser/manifestv2.json and browser/manifest.json.
 *
 * It must not SHIP. Firefox validates browser_specific_settings against a schema
 * and warns on every property it does not recognise, so loading
 * dist/extension-firefox.zip in about:debugging printed, verbatim:
 *
 *   Reading manifest: Warning processing
 *   browser_specific_settings.gecko.data_collection_permissions._comment:
 *   An unexpected property was found in the WebExtension manifest.
 *
 * ...once per key nested inside `gecko`. The one sitting directly under
 * browser_specific_settings did not warn, which is a property of Mozilla's schema
 * and not a rule to design around — every _comment goes, at every depth.
 *
 * Same shape as the guide's inline-script extraction above: the source stays one
 * self-contained, documented file and the ARTIFACT is what the store validates.
 *
 * Named stripManifestComments rather than stripComments on purpose.
 * scripts/checkExtensionPackages.mjs already has a stripComments() that blanks
 * JavaScript comments out of source text, and two same-named helpers doing
 * different jobs in one build system is a trap for whoever greps next.
 *
 * @type {(value: any) => void}
 */
function stripManifestComments(value) {
    // Arrays are walked too. Nothing in either manifest today holds an object
    // inside an array that could carry one — content_scripts and
    // web_accessible_resources are the candidates — but "not today" is exactly the
    // condition that changes without anyone re-reading this function.
    if (Array.isArray(value)) {
        for (const element of value) stripManifestComments(element);
        return;
    }

    if (value === null || typeof value !== "object") return;

    // Object.keys() is own + enumerable, which is precisely the set JSON.parse
    // produces, and it is a snapshot — so deleting during the walk cannot skip a
    // sibling the way mutating a live iterator would.
    for (const key of Object.keys(value)) {
        if (key.startsWith("_comment")) delete value[key];
        else stripManifestComments(value[key]);
    }
}

/**
  * @type {(target: string, files: string[]) => Promise<void>}
 */
async function buildExtension(target, files) {
    // Spread-or-nothing rather than a key holding null: writeFile(dest, null)
    // throws, and an entries object carrying a null would turn "this machine has
    // no guide" back into the hard build failure this stopped being.
    const guide = await getGuide();

    const entries = {
        "dist/DiscordTranslator.js": await readFile("dist/browser/extension.js"),
        "dist/DiscordTranslator.css": await readFile("dist/browser/extension.css"),
        // guide.js (and any sibling) rides along with guide.html or not at all: a
        // page whose <script src> points at a file that was not packaged is the same
        // dead interactive layer as the inline script it replaced, one layer further
        // down. checkExtensionPackages.mjs re-derives this from the packaged HTML
        // rather than trusting the name, so a rename here cannot get past it.
        ...(guide === null
            ? {}
            : {
                [GUIDE_PACKAGED_NAME]: guide.html,
                ...Object.fromEntries(guide.scripts.map(s => [s.name, s.content]))
            }),
        // The QuickCSS editor loads Monaco from here rather than from cdn.jsdelivr.net.
        // That matters more for this extension than for most: it strips Discord's CSP,
        // so a CDN script would run in the logged-in discord.com origin with nothing
        // left to constrain it. It is ~1.5 MB of the package; that is the price.
        ...await loadDir("dist/browser/vendor/monaco", "dist/browser/"),
        ...Object.fromEntries(await Promise.all(files.map(async f => {
            let content = await readFile(join("browser", f));
            if (f.startsWith("manifest")) {
                const json = JSON.parse(content.toString("utf-8"));
                json.version = VERSION;
                // Both manifests, not just the MV2 one that warns today.
                // browser/manifest.json carries no _comment keys right now; running
                // it through anyway is what stops the first one added there from
                // ever reaching a package.
                stripManifestComments(json);
                content = Buffer.from(new TextEncoder().encode(JSON.stringify(json)));
            }

            return [
                f.startsWith("manifest") ? "manifest.json" : f,
                content
            ];
        })))
    };

    // join() matters: the files below are written to dist/browser/<target>, and this
    // line used to remove a bare "<target>" at the repo root, which never existed. The
    // output directory was therefore never cleaned, so any file dropped from the package
    // above kept shipping from the previous build until dist/ was deleted by hand.
    await rm(join("dist/browser", target), { recursive: true, force: true });
    await Promise.all(Object.entries(entries).map(async ([file, content]) => {
        const dest = join("dist/browser", target, file);
        const parentDirectory = join(dest, "..");
        await mkdir(parentDirectory, { recursive: true });
        await writeFile(dest, content);
    }));

    console.info("Unpacked Extension written to dist/browser/" + target);
}

const appendCssRuntime = readFile("dist/DiscordTranslator.user.css", "utf-8").then(content => {
    const cssRuntime = `unsafeWindow._vcUserScriptRendererCss=\`${content.replaceAll("`", "\\`")}\``;

    return appendFile("dist/DiscordTranslator.user.js", cssRuntime);
});

if (!process.argv.includes("--skip-extension")) {
    await Promise.all([
        appendCssRuntime,
        buildExtension("chromium-unpacked", ["modifyResponseHeaders.json", "content.js", "manifest.json", "icon.png", "icon16.png", "icon32.png", "icon48.png", "icon96.png", "icon128.png", "service-worker.js", "translationHost.js"]),
        buildExtension("firefox-unpacked", ["background.js", "content.js", "manifestv2.json", "icon.png", "icon16.png", "icon32.png", "icon48.png", "icon96.png", "icon128.png", "translationHost.js"]),
    ]);

    // Synchronous on purpose. The callback form is fire-and-forget: nothing awaited
    // it, so the process could exit before the archive was written and leave the
    // PREVIOUS build's zip in place. That is not theoretical - it shipped a
    // dist/extension-firefox.zip containing a vendor/monaco tree that had already been
    // removed from the package. A release built that way publishes stale bytes.
    for (const [target, out] of [
        ["chromium-unpacked", "dist/extension-chrome.zip"],
        ["firefox-unpacked", "dist/extension-firefox.zip"]
    ]) {
        await rm(out, { force: true });
        Zip.sync.zip(join("dist/browser", target)).compress().save(out);
        console.info(`Packed extension written to ${out}`);
    }
} else {
    await appendCssRuntime;
}
