#!/usr/bin/node
/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Verifies the built browser extension packages, reading the ARTIFACTS rather than
 * the sources that are supposed to produce them.
 *
 * Every check here exists because the thing it checks actually went wrong:
 *
 *   - the extension shipped upstream's Vencord icon through several releases,
 *     because nothing compared it to anything
 *   - the packaged zip could be left over from a PREVIOUS build, because the zip
 *     step was fire-and-forget and nothing awaited it
 *   - a 1.5 MB vendored Monaco tree was packaged that no code in the browser build
 *     ever loads, making up 86% of the download
 *   - buildExtension() copies an explicit file list, so a new source file that is
 *     not added to that list is silently absent from the package
 *
 * Run after `pnpm buildWeb`. Exits non-zero with a reason on any failure.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Zip from "zip-local";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** sha256 prefix of upstream's Vencord/Equicord mark, which must never ship again. */
const UPSTREAM_ICON = "c57fa99ab3e88f5d";

/** Must match ALLOWED_HOSTS in browser/translationHost.js and native.ts. */
const PROVIDER_HOSTS = ["translate.googleapis.com", "api-free.deepl.com", "api.deepl.com"];

const ICON_SIZES = [16, 32, 48, 96, 128];

const TARGETS = [
    { name: "chrome", dir: "dist/browser/chromium-unpacked", zip: "dist/extension-chrome.zip" },
    { name: "firefox", dir: "dist/browser/firefox-unpacked", zip: "dist/extension-firefox.zip" }
];

let failed = 0;

function fail(msg) {
    console.error(`  FAIL  ${msg}`);
    failed++;
}

function pass(msg) {
    console.log(`  ok    ${msg}`);
}

function sha16(buf) {
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

/*
 * Chrome writes _metadata/ into an unpacked extension directory when it loads one,
 * so it appears locally after any manual or automated load and never in CI. The
 * build does not produce it and the archive must not contain it, so it is excluded
 * from the comparison rather than being reported as drift.
 */
const GENERATED = new Set(["_metadata"]);

/** Every file under dir, as paths relative to it with forward slashes. */
function walk(dir) {
    const out = new Set();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (GENERATED.has(entry.name)) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) for (const f of walk(p)) out.add(`${entry.name}/${f}`);
        else out.add(entry.name);
    }
    return out;
}

for (const target of TARGETS) {
    console.log(`\n${target.name}`);

    const dir = join(ROOT, target.dir);
    const zipPath = join(ROOT, target.zip);

    if (!existsSync(dir)) { fail(`${target.dir} missing — did buildWeb run?`); continue; }
    if (!existsSync(zipPath)) { fail(`${target.zip} missing`); continue; }

    // --- the transport must be present and carry the real guard ---
    const hostPath = join(dir, "translationHost.js");
    if (!existsSync(hostPath)) {
        fail("translationHost.js is not in the package — translation cannot work");
    } else {
        const host = readFileSync(hostPath, "utf8");
        if (!host.includes("ALLOWED_HOSTS.has")) {
            fail("translationHost.js does not use an exact-match host check");
        } else pass("transport present, exact-match host guard intact");

        for (const h of PROVIDER_HOSTS) {
            if (!host.includes(h)) fail(`translationHost.js is missing provider host ${h}`);
        }
    }

    // --- the relay both halves speak ---
    const content = existsSync(join(dir, "content.js")) ? readFileSync(join(dir, "content.js"), "utf8") : "";
    const bundle = existsSync(join(dir, "dist/DiscordTranslator.js"))
        ? readFileSync(join(dir, "dist/DiscordTranslator.js"), "utf8") : "";
    if (!content.includes("discordTranslator:fetch")) fail("content.js carries no relay");
    else if (!bundle.includes("discordTranslator:fetch")) fail("the bundle carries no relay");
    else pass("page/background relay present on both sides");

    // --- manifest ---
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const perms = manifest.host_permissions || manifest.permissions || [];
    for (const h of PROVIDER_HOSTS) {
        if (!perms.some(p => p.includes(h))) fail(`manifest grants no permission for ${h}`);
    }
    if (PROVIDER_HOSTS.every(h => perms.some(p => p.includes(h)))) {
        pass("manifest grants every provider host the transport may reach");
    }

    if (/equicord|vencord/i.test(JSON.stringify(manifest))) {
        fail("upstream branding present in manifest.json");
    } else pass("no upstream branding in the manifest");

    for (const size of ICON_SIZES) {
        if (!manifest.icons?.[String(size)]) fail(`manifest declares no ${size}px icon`);
        else if (!existsSync(join(dir, manifest.icons[String(size)]))) {
            fail(`declared icon ${manifest.icons[String(size)]} is not in the package`);
        }
    }
    if (ICON_SIZES.every(s => manifest.icons?.[String(s)] && existsSync(join(dir, manifest.icons[String(s)])))) {
        pass(`all ${ICON_SIZES.length} declared icon sizes present`);
    }

    // --- the icon must be ours ---
    let upstreamFound = false;
    for (const f of walk(dir)) {
        if (!f.endsWith(".png")) continue;
        if (sha16(readFileSync(join(dir, f))) === UPSTREAM_ICON) {
            fail(`upstream Vencord icon at ${f}`);
            upstreamFound = true;
        }
    }
    if (!upstreamFound) pass("no upstream icon anywhere in the package");

    // --- the zip must be this build's, not the last one's ---
    // contents() returns an array of entry names; Object.keys() on it yields indices,
    // which silently turns every comparison below into nonsense.
    const zipNames = new Set(
        Zip.sync.unzip(zipPath).memory().contents().filter(n => !n.endsWith("/"))
    );
    const dirNames = walk(dir);

    const onlyZip = [...zipNames].filter(n => !dirNames.has(n));
    const onlyDir = [...dirNames].filter(n => !zipNames.has(n));

    if (onlyZip.length || onlyDir.length) {
        fail(`${target.zip} does not match ${target.dir}`);
        if (onlyZip.length) console.error(`        only in zip: ${onlyZip.slice(0, 8).join(", ")}`);
        if (onlyDir.length) console.error(`        only in dir: ${onlyDir.slice(0, 8).join(", ")}`);
    } else {
        pass(`archive matches the built directory (${dirNames.size} files)`);
    }

    // --- developer-only surfaces must not reach users ---
    // The Patch Helper tab compiles pasted text with Function(). It is gated on
    // !IS_STANDALONE, so a build that forgets --standalone ships it, and it only
    // works at all because this extension strips the page CSP.
    for (const [needle, what] of [
        ["equicord_patch_helper", "the Patch Helper developer tab"],
        ["Standalone: false", "a non-standalone build banner"]
    ]) {
        if (bundle.includes(needle)) fail(`${what} is in the shipped bundle (found ${JSON.stringify(needle)})`);
    }
    if (!bundle.includes("equicord_patch_helper") && !bundle.includes("Standalone: false")) {
        pass("no developer-only surfaces in the bundle");
    }

    // --- the QuickCSS editor loads Monaco from here, so it must be present ---
    // It was briefly dropped as dead weight, correctly at the time: nothing loaded it
    // and it was 86% of the download. openEditor now fetches it, and a CDN script in a
    // page whose CSP this extension strips is the thing that must not come back.
    const monaco = ["vendor/monaco/index.js", "vendor/monaco/index.css",
        "vendor/monaco/vs/language/css/css.worker.js", "vendor/monaco/vs/editor/editor.worker.js"];
    const missingMonaco = monaco.filter(f => !zipNames.has(f));
    if (missingMonaco.length) {
        fail(`bundled Monaco incomplete, missing: ${missingMonaco.join(", ")}`);
    } else pass("bundled Monaco present, including both language workers");

    console.log(`        ${(statSync(zipPath).size / 1024).toFixed(0)} KB packaged`);
}

console.log();
if (failed) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
}
console.log("extension packages OK");
