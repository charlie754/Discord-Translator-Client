#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Enumerates every network host reachable from the packed archives and fails on
 * anything not in scripts/allowed-hosts.txt.
 *
 * This enumerates rather than denylisting known-bad hosts: a denylist can only
 * find hosts someone already thought of, so it is structurally incapable of
 * falsifying the claim it is run to support. Adding a line to the allow-file is
 * the only way to pass, which turns "we now talk to one more third party" into
 * a reviewable diff instead of an invisible one.
 */

import { extractFile, listPackage, statFile } from "@electron/asar";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW_FILE = join(ROOT, "scripts", "allowed-hosts.txt");
const ARCHIVES = ["desktop.asar", "equibop.asar"];

const URL_RE = /https?:\/\/[^\s"'`)\]{}<>\\]+/g;

// The CSP allow-map ships its entries as bare hostnames with no scheme, so a
// scheme-anchored sweep reports zero third parties over an artifact that
// permits imgur, catbox and Google Fonts. Both passes are load-bearing.
// Deliberately case-SENSITIVE: hostnames in source are written lowercase, while
// the dotted property paths that share this shape (React.Fragment,
// WebpackPatcher.patchedBy) are not, and those are minifier-volatile noise.
const BARE_HOST_RE = /["'`](?:\*\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})["'`]/g;

// The QuickCSS editor's jsdelivr fetch URL survives the build only inside a
// base64 blob; grepping the artifact for it as a URL finds nothing.
const BASE64_RE = /[A-Za-z0-9+/=]{400,}/g;

// `https://${base}/x` parses as the "hostname" `$`. A resolvable host is
// letters, digits, dots and dashes with a dot, or a literal IP.
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$|^\d{1,3}(?:\.\d{1,3}){3}$|^\[[0-9a-f:]+\]$/;

/** Hosts that are the client's own first-party surface, never worth listing. */
function isFirstParty(host) {
    return host === "localhost"
        || host === "127.0.0.1"
        || host === "::1"
        || host === "[::1]"
        || /(^|\.)discord\.com$/.test(host)
        || /(^|\.)discordapp\.com$/.test(host)
        || /(^|\.)discordapp\.net$/.test(host);
}

/** Strings that parsed as a URL but whose host is not a resolvable shape — reported, never silently discarded. */
const unparseable = new Set();

/**
 * Indicates whether an archive path points to code within a vendored third-party package.
 *
 * For vendored dependencies, a dotted identifier is not evidence of outbound network access —
 * it may be a TextMate scope name ("variable.php"), a settings key ("workbench.hover.delay"),
 * or any other internal token. Only absolute URLs are actionable evidence. The control for a
 * vendored dependency is its pinned version in package.json, not this host list. So we scan
 * only for absolute URLs, bypassing the bare-token heuristic that catches CSP allow-map entries
 * in our own source.
 */
function isVendoredPath(archivePath) {
    // asar entry paths carry the host platform's separator, so on Windows these arrive
    // as "\monaco\vs\...". Testing only "monaco/" matched nothing there and the gate
    // failed on 491 Monaco token scopes while looking like it was working.
    const normalized = archivePath.replace(/\\/g, "/").replace(/^\.?\/+/, "");
    return normalized.startsWith("monaco/");
}

/**
 * @param {string} text
 * @param {string} [vendorPath] - archive path being scanned; if under a vendored package, skips bare-token matching
 * @returns {{ host: string, via: string }[]} every hostname in `text`, including ones only present base64-encoded
 */
function extractHosts(text, vendorPath) {
    const hosts = [];
    const skipBareTokens = vendorPath && isVendoredPath(vendorPath);

    const scan = (s, encoding) => {
        for (const raw of s.match(URL_RE) ?? []) {
            let host;
            try {
                ({ hostname: host } = new URL(raw));
            } catch {
                continue; // truncated or templated URL
            }
            host = host.toLowerCase();
            if (!host) continue;
            if (!HOSTNAME_RE.test(host) && !isFirstParty(host)) {
                unparseable.add(host);
                continue;
            }
            hosts.push({ host, via: `url${encoding}` });
        }

        // For vendored dependencies, bare dotted tokens (TextMate scopes, settings keys, etc.)
        // carry no signal about network access. Only absolute URLs are checked.
        if (!skipBareTokens) {
            for (const [, host] of s.matchAll(BARE_HOST_RE)) {
                hosts.push({ host, via: `bare${encoding}` });
            }
        }
    };

    scan(text, "");
    for (const run of text.match(BASE64_RE) ?? []) {
        // Decoding a long minified identifier yields mojibake, which simply
        // fails to match; only real payloads contribute hosts.
        scan(Buffer.from(run, "base64").toString("utf8"), "+b64");
    }

    return hosts;
}

/** A check nobody has watched fail is not a check. Prove both extraction paths work before trusting a clean run. */
function selfTest() {
    const urlProbe = "https://example.invalid/x";
    const bareProbe = "probe.example.test";
    const blob = Buffer.from(`/* ${"pad".repeat(120)} */ fetch("${urlProbe}"); csp("${bareProbe}");`).toString("base64");
    const synthetic = `const css = atob("${blob}");`;

    const die = msg => {
        console.error(`self-test FAILED: ${msg}`);
        process.exit(1);
    };

    if (synthetic.includes("example.invalid") || synthetic.includes(bareProbe)) {
        die("a probe leaked into the plaintext, so this proves nothing about base64 decoding");
    }
    if (blob.length < 400) die(`probe blob is ${blob.length} chars, below the 400-char base64 threshold`);

    const got = extractHosts(synthetic).map(h => h.host);
    if (!got.includes("example.invalid")) die("missed a base64-encoded URL host, so a clean run would be meaningless");
    if (!got.includes(bareProbe)) die("missed a base64-encoded bare host, so the CSP allow-map would go unchecked");

    console.log("self-test ok: base64-encoded URL host and bare host both recovered from synthetic input");
}

function readAllowedHosts() {
    if (!existsSync(ALLOW_FILE)) {
        console.error(`missing allow-file: ${ALLOW_FILE}`);
        process.exit(1);
    }
    return new Set(
        readFileSync(ALLOW_FILE, "utf8")
            .split("\n")
            .map(l => l.replace(/#.*$/, "").trim().toLowerCase())
            .filter(Boolean)
    );
}

selfTest();
unparseable.clear();

const allowed = readAllowedHosts();

const missing = ARCHIVES.filter(a => !existsSync(join(ROOT, "dist", a)));
if (missing.length) {
    console.error(`\nmissing packed archive(s): ${missing.join(", ")}`);
    console.error("run `pnpm build` first — this check must never pass without an artifact to read");
    process.exit(1);
}

/** @type {Map<string, { count: number, firstSeen: string, via: Set<string> }>} */
const found = new Map();

for (const archive of ARCHIVES) {
    const archivePath = join(ROOT, "dist", archive);

    for (const entry of listPackage(archivePath, { isPack: false })) {
        const name = entry.replace(/^[/\\]/, "");

        const stat = statFile(archivePath, name, false);
        if ("files" in stat || "link" in stat) continue;

        let text;
        try {
            text = extractFile(archivePath, name, false).toString("utf8");
        } catch (e) {
            console.error(`could not read ${archive}:${name}: ${e.message}`);
            process.exit(1);
        }

        for (const { host, via } of extractHosts(text, name)) {
            if (isFirstParty(host)) continue;

            const seen = found.get(host);
            if (seen) {
                seen.count++;
                seen.via.add(via);
            } else {
                found.set(host, { count: 1, firstSeen: `${archive}:${name}`, via: new Set([via]) });
            }
        }
    }
}

const hosts = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
const width = Math.max(0, ...hosts.map(([h]) => h.length));

console.log(`\nhosts enumerated in ${ARCHIVES.join(" + ")}:\n`);
if (!hosts.length) console.log("  (none)");
for (const [host, { count, firstSeen, via }] of hosts) {
    const mark = allowed.has(host) ? "ok " : "NEW";
    console.log(`  ${mark} ${host.padEnd(width)}  ${String(count).padStart(4)}x  ${[...via].sort().join(",").padEnd(12)}  ${firstSeen}`);
}

if (unparseable.size) {
    console.log(`\nnot host-shaped, ignored (${unparseable.size}): ${[...unparseable].sort().join(", ")}`);
}

const unlisted = hosts.filter(([h]) => !allowed.has(h)).map(([h]) => h);
if (unlisted.length) {
    console.error(`\nFAIL: ${unlisted.length} entr${unlisted.length === 1 ? "y" : "ies"} not in scripts/allowed-hosts.txt:`);
    for (const host of unlisted) console.error(`  ${host}  (first seen in ${found.get(host).firstSeen})`);
    console.error("\nEither remove the code that reaches it, or add it to the allow-file and say why in the PR.");
    process.exit(1);
}

console.log(`\nOK: ${hosts.length} entr${hosts.length === 1 ? "y" : "ies"}, all listed in scripts/allowed-hosts.txt`);
