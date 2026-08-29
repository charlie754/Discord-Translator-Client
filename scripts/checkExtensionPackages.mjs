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
 *   - every guard check read the UNPACKED directory, and the zip was compared to it
 *     by FILE NAME only, so the archive users install could have carried a
 *     different translationHost.js or content.js and the whole script would still
 *     have printed ok
 *   - a marker string was matched with a plain substring test against the WHOLE
 *     file, so when the rule it pinned was removed from the runtime path and
 *     survived only in the comments explaining why, the check went on passing.
 *     It pinned prose. A check that cannot fail is worse than no check, because
 *     it reads as coverage — see stripComments() below
 *   - the provider host list was RESTATED here as a hardcoded array, so the line
 *     "manifest grants every provider host the transport may reach" only ever
 *     compared the manifest against four names this file happened to know. A host
 *     added to the transport and to no allow-list was invisible to it, and it
 *     printed ok while being blind — see providerHostsFrom() below
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

/*
 * ---------------------------------------------------------------------------
 * The provider hosts are DERIVED, not restated.
 * ---------------------------------------------------------------------------
 *
 * This used to be a hardcoded array with the comment "must match ALLOWED_HOSTS in
 * browser/translationHost.js". It could not enforce that, and it did not: the
 * manifest was compared against the four names written here, so the pass line
 * "manifest grants every provider host the transport may reach" meant only "the
 * manifest grants the four hosts this file remembers". A provider host added to
 * the transport and to no allow-list at all was invisible, and the ok line was
 * printed over it — which is worse than having no check, because that line gets
 * quoted as evidence.
 *
 * SOURCE OF TRUTH: the ALLOWED_HOSTS set inside the BUILT translationHost.js.
 *
 * Not scripts/allowed-hosts.txt, which was the other candidate and is the wrong
 * list: it is the audit list for the DESKTOP archives (see checkHosts.mjs), 55
 * entries including api.github.com and fonts.googleapis.com, none of which the
 * extension manifest grants or should. Comparing the manifest against that would
 * fail on every entry that has nothing to do with the extension.
 *
 * ALLOWED_HOSTS is the right one because it is not a description of the transport,
 * it IS the transport: `ALLOWED_HOSTS.has(target.hostname)` is the only host check
 * the extension enforces at runtime, so a hostname in that set is exactly a
 * hostname a request can reach, and a hostname outside it cannot be reached
 * whatever the manifest says. Read from the BUILT copy rather than from
 * browser/translationHost.js for the reason this whole script exists: the artifact
 * is what ships, and the source is only supposed to produce it.
 *
 * The direction that matters is transport ⊆ manifest. A host the transport may
 * reach and the manifest does not grant is a request that fails for every user
 * (MV3) or is silently un-permitted (MV2). The reverse — a manifest permission no
 * provider uses — is not checked here: the manifests legitimately carry
 * *://*.discord.com/* and raw.githubusercontent.com for reasons that are not
 * translation, and failing on those would be noise.
 *
 * DELIBERATE LOSS, recorded so it is not rediscovered as a bug: the old hardcoded
 * array also failed if a provider host DISAPPEARED from the transport. Deriving
 * cannot see that — a host deleted from both the transport and the manifest is
 * self-consistent and passes. That was a functionality regression check, not a
 * security one, and it is the price of never drifting again. The non-empty
 * assertion below is what remains of it.
 */

/** The exact text the derivation anchors on, in the built transport. */
const ALLOWED_HOSTS_ANCHOR = "const ALLOWED_HOSTS = new Set([";

/**
 * Every quoted string in the set literal. Removing these leaves the RESIDUE, which
 * must be only commas and whitespace: a spread, an identifier or a concatenation
 * means the set is not statically knowable, and a derivation that quietly returned
 * the subset it could read would be the same blindness in a new costume.
 *
 * The residue test is the one that works. A character-class test — "reject
 * anything that is not a letter, digit, dot, quote, comma or space" — was written
 * here first and this file's own self-test rejected it within a minute: `...EXTRA`
 * is nothing but dots and letters, so a spread sailed through and the derivation
 * reported the one host it could see as if it were the whole set.
 */
const STRING_LITERAL = /"[^"]*"|'[^']*'/g;

/** A hostname ALLOWED_HOSTS.has() could ever match: exact, no scheme, no wildcard. */
const PLAIN_HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * The hostnames the built transport will actually let a request reach.
 *
 * Reads code with comments already blanked (see stripComments), so a host that
 * survives only in a comment is not counted — the same rule every other presence
 * assertion here follows.
 *
 * Returns `{ hosts }` or `{ why }`. Never a partial list: if the literal cannot
 * be read exactly, that is a finding and the caller fails, because the failure
 * mode being fixed is precisely a host list this script cannot see.
 *
 * @param {string} code translationHost.js with comments blanked
 * @returns {{ hosts: string[], why?: undefined } | { hosts?: undefined, why: string }}
 */
function providerHostsFrom(code) {
    const start = code.indexOf(ALLOWED_HOSTS_ANCHOR);
    if (start === -1) {
        return { why: `no ${JSON.stringify(ALLOWED_HOSTS_ANCHOR)} in code — the transport's ` +
            "allow-list could not be located, so the manifest cannot be compared against it. " +
            "If translationHost.js is now minified or the declaration was renamed, update " +
            "ALLOWED_HOSTS_ANCHOR here; do not delete the check." };
    }
    if (code.indexOf(ALLOWED_HOSTS_ANCHOR, start + 1) !== -1) {
        return { why: "the ALLOWED_HOSTS declaration occurs more than once in code, so which " +
            "one the runtime uses is ambiguous" };
    }

    const bodyStart = start + ALLOWED_HOSTS_ANCHOR.length;
    const end = code.indexOf("]", bodyStart);
    if (end === -1) return { why: "the ALLOWED_HOSTS array literal is never closed" };

    const body = code.slice(bodyStart, end);

    const residue = body.replace(STRING_LITERAL, "").trim();
    if (/[^\s,]/.test(residue)) {
        return { why: "the ALLOWED_HOSTS literal contains something other than plain string " +
            `literals (left over after removing them: ${JSON.stringify(residue.slice(0, 60))}), ` +
            "so the set of reachable hosts is not statically knowable and this check refuses to " +
            "report a partial one" };
    }

    const hosts = [...body.matchAll(STRING_LITERAL)].map(m => m[0].slice(1, -1));
    if (!hosts.length) return { why: "the ALLOWED_HOSTS set is empty — the transport can reach nothing" };

    const odd = hosts.filter(h => !PLAIN_HOSTNAME.test(h));
    if (odd.length) {
        return { why: `ALLOWED_HOSTS contains ${JSON.stringify(odd)}, which is not a plain ` +
            "hostname. The transport matches with Set.has(target.hostname), an exact string " +
            "comparison, so a wildcard, a scheme or a path in that set matches nothing at " +
            "runtime and cannot be compared to a manifest permission either" };
    }

    return { hosts };
}

/**
 * Whether one manifest match pattern grants requests to `host`.
 *
 * The old test was `permission.includes(host)`, a plain substring match, which
 * says yes to "https://api.deepl.com.example.net/*" for host "api.deepl.com" —
 * it would accept a permission for an attacker-controlled domain as covering the
 * provider. Patterns are parsed instead:
 *
 *   <all_urls>          everything
 *   scheme://host/path  scheme is https or *; host is *, *.suffix, or exact
 *
 * The transport only ever issues https (target.protocol !== "https:" is refused
 * there), so an http-only permission does not count as granting anything. Anything
 * this does not understand simply does not match, which reports a missing
 * permission rather than inventing one.
 *
 * @param {string} pattern
 * @param {string} host
 */
function permissionGrantsHost(pattern, host) {
    if (pattern === "<all_urls>") return true;

    const m = /^(\*|https?):\/\/([^/]+)(\/.*)?$/.exec(pattern);
    if (!m) return false; // e.g. bare API permissions like "webRequest"

    const [, scheme, hostPattern] = m;
    if (scheme !== "https" && scheme !== "*") return false;

    if (hostPattern === "*") return true;
    if (hostPattern.startsWith("*.")) {
        const suffix = hostPattern.slice(2);
        return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === hostPattern;
}

/*
 * ---------------------------------------------------------------------------
 * Comments are not code, and this script must not confuse the two.
 * ---------------------------------------------------------------------------
 *
 * Every marker below asserts that a RULE is present in a shipped file. Matching
 * the marker against the raw file text asserts something weaker and almost
 * useless: that the STRING is present. The difference is not academic — it
 * already happened here.
 *
 * "blocked after redirect" was the marker for the post-redirect host re-check.
 * That design was wrong (by the time a followed redirect can be inspected the
 * request has already been delivered) and was replaced by refusing redirects
 * outright. The runtime string disappeared with it. But two comments in
 * browser/translationHost.js quote the old wording while explaining why it was
 * false — so the marker kept matching, the gate kept printing ok, and it had
 * been pinning prose for as long as the comments existed.
 *
 * So the presence assertions run against the file with its comments blanked
 * out. The absence assertions further down deliberately do NOT: a CDN URL or a
 * developer-only surface hiding in a comment should still be reported, and
 * stripping there would weaken the check rather than sharpen it. Positive
 * checks read code; negative checks read everything.
 */

/** Characters that, immediately before a `/`, mean it is a DIVISION and not a regex. */
const DIVISION_AFTER = /[\p{L}\p{N}_$)\]}]$/u;
/** ...unless they spell one of these, after which a `/` really does start a regex. */
const REGEX_AFTER_WORD = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/;

/**
 * Blank out every comment in JavaScript source, leaving code and its offsets
 * untouched.
 *
 * Comment characters become spaces rather than being deleted, so the result is
 * the same length as the input and every newline is where it was. That keeps a
 * needle from being fabricated by two distant fragments becoming adjacent, and
 * it makes the "did this change anything?" question answerable by comparing
 * lengths.
 *
 * A naive stripper is a WORSE bug than the one it fixes: `"https://x//y"` and
 * `/https?:\/\//` both contain `//`, and eating from there to end of line would
 * silently delete real code and turn every marker after it into a false
 * failure — or, if it swallowed a quote, into a false pass. So string,
 * template and regex literals are all tracked, and:
 *
 *   - `//` and `/*` outside a literal are unambiguous. `a // b` and `a / *b`
 *     are not valid JavaScript, so a `/` followed by `/` or `*` in code
 *     position is always a comment.
 *   - `/` in code position is a regex only when what precedes it cannot end an
 *     expression. The remaining ambiguity (`)` and `}`) is resolved as
 *     division, which is the common case and, being the conservative choice,
 *     cannot swallow anything.
 *   - a regex literal cannot span a line, so a mis-guessed regex gives up at
 *     the newline and is re-read as a plain character. Damage is bounded to
 *     one line by construction.
 *   - anything genuinely unterminated at EOF throws. Failing loudly beats
 *     handing the caller a half-eaten file to search.
 *
 * Verified against the real artifacts, which is the point: on the 397 KB
 * minified dist/DiscordTranslator.js it blanks 207 characters — the build
 * banner and the trailing legal comment — and nothing else.
 *
 * @param {string} src
 * @param {string} label used in the thrown message
 * @returns {string} src with comment characters replaced by spaces
 */
function stripComments(src, label) {
    const blank = s => s.replace(/[^\n]/g, " ");
    const n = src.length;
    let out = "";
    let tail = ""; // the last few characters of emitted CODE, for the regex/division call
    let i = 0;

    const emit = text => {
        out += text;
        tail = (tail + text).slice(-32);
    };

    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];

        if (c === "/" && c2 === "/") {
            let end = src.indexOf("\n", i);
            if (end === -1) end = n;
            out += blank(src.slice(i, end));
            i = end;
            continue;
        }

        if (c === "/" && c2 === "*") {
            const end = src.indexOf("*/", i + 2);
            if (end === -1) throw new Error(`${label}: unterminated block comment`);
            out += blank(src.slice(i, end + 2));
            i = end + 2;
            continue;
        }

        if (c === '"' || c === "'") {
            let j = i + 1;
            for (; j < n; j++) {
                if (src[j] === "\\") { j++; continue; }
                if (src[j] === c || src[j] === "\n") break;
            }
            if (j >= n || src[j] !== c) throw new Error(`${label}: unterminated string literal`);
            emit(src.slice(i, j + 1));
            i = j + 1;
            continue;
        }

        if (c === "`") {
            // ${ ... } may itself contain braces and strings; depth-counting is
            // enough for the substitutions these files actually use, and an
            // unterminated template throws rather than being guessed at.
            let j = i + 1;
            let depth = 0;
            for (; j < n; j++) {
                if (src[j] === "\\") { j++; continue; }
                if (depth === 0 && src[j] === "`") break;
                if (src[j] === "$" && src[j + 1] === "{") { depth++; j++; continue; }
                if (depth > 0 && src[j] === "}") depth--;
            }
            if (j >= n) throw new Error(`${label}: unterminated template literal`);
            emit(src.slice(i, j + 1));
            i = j + 1;
            continue;
        }

        if (c === "/") {
            const before = tail.trimEnd();
            const isRegex = before === "" || !DIVISION_AFTER.test(before) || REGEX_AFTER_WORD.test(before);
            if (isRegex) {
                let j = i + 1;
                let inClass = false;
                let closed = false;
                for (; j < n; j++) {
                    const d = src[j];
                    if (d === "\\") { j++; continue; }
                    if (d === "\n") break; // not a regex after all
                    if (inClass) { if (d === "]") inClass = false; continue; }
                    if (d === "[") { inClass = true; continue; }
                    if (d === "/") { closed = true; break; }
                }
                if (closed) {
                    emit(src.slice(i, j + 1));
                    i = j + 1;
                    continue;
                }
            }
        }

        emit(c);
        i++;
    }

    if (out.length !== src.length) {
        throw new Error(`${label}: stripper changed the length (${src.length} -> ${out.length})`);
    }
    return out;
}

/*
 * The stripper is now load-bearing: if it silently ate code, every marker after
 * the damage would fail and send the reader hunting a build regression that
 * never happened; if it silently kept comments, the vacuous-marker bug is back.
 * Both directions are controlled for here, on fixtures whose expected answer is
 * written out rather than computed by the code under test, and this runs before
 * anything is checked so a broken stripper cannot report on a build at all.
 */
function selfTestStripComments() {
    const KEEP = "CANARY_CODE";
    const cases = [
        // [source, must still contain, must no longer contain]
        [`const a = "http://x//y${KEEP}";`, KEEP, null],
        [`const b = 'a /* ${KEEP} */ b';`, KEEP, null],
        ["const c = `t ${x} // " + KEEP + "`;", KEEP, null],
        [`const d = /https?:\\/\\//; const e = "${KEEP}";`, KEEP, null],
        [`const f = /[/*]/; const g = "${KEEP}";`, KEEP, null],
        [`const h = (a) / 2; const i = "${KEEP}";`, KEEP, null],
        [`const j = x.replace(/a/g, "b"); const k = "${KEEP}";`, KEEP, null],
        [`return /x/.test(s) ? "${KEEP}" : "";`, KEEP, null],
        [`const l = "${KEEP}"; // ${KEEP}_GONE`, KEEP, `${KEEP}_GONE`],
        [`/* ${KEEP}_GONE */ const m = "${KEEP}";`, KEEP, `${KEEP}_GONE`],
        [`/*\n * ${KEEP}_GONE\n */\nconst n = "${KEEP}";`, KEEP, `${KEEP}_GONE`],
        [`const o = 1; // a\n// ${KEEP}_GONE\nconst p = "${KEEP}";`, KEEP, `${KEEP}_GONE`]
    ];

    for (const [src, keep, gone] of cases) {
        const got = stripComments(src, "self-test");
        if (got.length !== src.length) {
            throw new Error(`stripComments self-test: length changed for ${JSON.stringify(src)}`);
        }
        if (!got.includes(keep)) {
            throw new Error(`stripComments self-test: ATE CODE — ${JSON.stringify(keep)} lost from ${JSON.stringify(src)}\n  got: ${JSON.stringify(got)}`);
        }
        if (gone !== null && got.includes(gone)) {
            throw new Error(`stripComments self-test: KEPT A COMMENT — ${JSON.stringify(gone)} survived ${JSON.stringify(src)}`);
        }
    }

    // ...and a source with no comments at all must come back untouched, so a
    // stripper that blanked indiscriminately could not pass the cases above by
    // accident.
    const clean = 'const q = "a"; const r = /b/; const s = t / u;';
    if (stripComments(clean, "self-test") !== clean) {
        throw new Error("stripComments self-test: modified comment-free source");
    }

    for (const bad of ["/* never closed", 'const u = "never closed', "const v = `never closed"]) {
        let threw = false;
        try { stripComments(bad, "self-test"); } catch { threw = true; }
        if (!threw) throw new Error(`stripComments self-test: accepted unterminated source ${JSON.stringify(bad)}`);
    }
}

selfTestStripComments();

/*
 * The derivation is now the only thing standing between a new provider host and a
 * manifest that does not grant it, so it gets the same treatment stripComments()
 * does: fixtures whose expected answer is written out rather than computed by the
 * code under test, run before anything is checked.
 *
 * The two directions that matter are both controlled for. A derivation that
 * quietly returned [] would make the comparison vacuous and print ok over
 * anything — so every failure case asserts that it FAILED, not merely that it
 * returned nothing useful. A permission matcher that was too loose is how the
 * previous substring test accepted a lookalike domain — so that has a negative
 * case too.
 */
function selfTestHostDerivation() {
    const wrap = body => `${ALLOWED_HOSTS_ANCHOR}${body}]);`;
    const eq = (got, want) => got.length === want.length && got.every((h, i) => h === want[i]);

    const ok = [
        [wrap('\n    "a.example.com",\n    "b.example.com"\n'), ["a.example.com", "b.example.com"]],
        [wrap('"only.example.com"'), ["only.example.com"]],
        [wrap("'single.example.com'"), ["single.example.com"]],
        // trailing comma, and code either side of the declaration
        [`const x = 1;\n${wrap('\n    "t.example.com",\n')}\nconst y = 2;`, ["t.example.com"]]
    ];
    for (const [src, want] of ok) {
        const got = providerHostsFrom(src);
        if (got.why) throw new Error(`host derivation self-test: refused a valid set (${got.why}) in ${JSON.stringify(src)}`);
        if (!eq(got.hosts, want)) {
            throw new Error(`host derivation self-test: read ${JSON.stringify(got.hosts)}, expected ${JSON.stringify(want)}`);
        }
    }

    const mustFail = [
        ["const OTHER_HOSTS = new Set([\"a.example.com\"]);", "a renamed declaration"],
        [wrap(""), "an empty set"],
        [wrap('"a.example.com", ...EXTRA'), "a spread"],
        [wrap('"a.example.com", SOME_CONST'), "an identifier"],
        [wrap('"a.example.com", "b." + tld'), "a concatenation"],
        [wrap('"a.example.com", `b.${tld}`'), "a template literal"],
        [wrap('""'), "an empty hostname"],
        [wrap('"*.example.com"'), "a wildcard, which Set.has() can never match"],
        [wrap('"https://a.example.com"'), "a URL rather than a hostname"],
        [wrap('"a.example.com/path"'), "a hostname carrying a path"],
        [`${ALLOWED_HOSTS_ANCHOR}"a.example.com"`, "an unclosed literal"],
        [`${wrap('"a.example.com"')}\n${wrap('"b.example.com"')}`, "a duplicated declaration"]
    ];
    for (const [src, what] of mustFail) {
        const got = providerHostsFrom(src);
        if (!got.why) {
            throw new Error(`host derivation self-test: ACCEPTED ${what} — ${JSON.stringify(src)} ` +
                `returned ${JSON.stringify(got.hosts)} instead of failing`);
        }
    }

    // ...and a set whose only mention of a host is in a COMMENT must not be read,
    // which is what running against stripped code buys. Asserted end to end here
    // rather than assumed at the call site.
    const commented = stripComments(
        `${ALLOWED_HOSTS_ANCHOR}\n    // "ghost.example.com",\n    "real.example.com"\n]);`,
        "self-test");
    const fromCommented = providerHostsFrom(commented);
    if (fromCommented.why) throw new Error(`host derivation self-test: ${fromCommented.why}`);
    if (!eq(fromCommented.hosts, ["real.example.com"])) {
        throw new Error("host derivation self-test: read a host that exists only in a comment: " +
            JSON.stringify(fromCommented.hosts));
    }

    const grants = [
        // [pattern, host, expected]
        ["https://api.deepl.com/*", "api.deepl.com", true],
        ["*://api.deepl.com/*", "api.deepl.com", true],
        ["<all_urls>", "api.deepl.com", true],
        ["https://*.deepl.com/*", "api.deepl.com", true],
        ["https://*.deepl.com/*", "deepl.com", true],
        ["https://*/*", "api.deepl.com", true],
        // the substring hole the old check had, both shapes
        ["https://api.deepl.com.example.net/*", "api.deepl.com", false],
        ["https://evil-api.deepl.com.attacker.test/*", "api.deepl.com", false],
        ["https://*.deepl.com.attacker.test/*", "api.deepl.com", false],
        // http is not https, and the transport refuses anything but https
        ["http://api.deepl.com/*", "api.deepl.com", false],
        // a different provider, and a non-host permission
        ["https://api-free.deepl.com/*", "api.deepl.com", false],
        ["webRequest", "api.deepl.com", false],
        ["*://*.discord.com/*", "api.deepl.com", false]
    ];
    for (const [pattern, host, want] of grants) {
        const got = permissionGrantsHost(pattern, host);
        if (got !== want) {
            throw new Error(`permission self-test: ${JSON.stringify(pattern)} vs ${JSON.stringify(host)} ` +
                `returned ${got}, expected ${want}`);
        }
    }
}

selfTestHostDerivation();

/*
 * The request-shaping guard, as it must appear in the BUILT files.
 *
 * The hostname allow-list says WHERE the relay may go; this says WHAT it may
 * send. It only became load-bearing when HttpTransport grew a body — before
 * that the worst the relay could do was ask an allowed host a question, and now
 * it can push. Both halves of the relay are copied into the package verbatim by
 * buildExtension(), so a build that dropped one of these, or that started
 * minifying files it used to copy, would ship a working extension with the
 * guard silently absent. `ALLOWED_HOSTS.has` is checked the same way below and
 * for the same reason.
 *
 * Each entry is [needle, what it is] — or [needle, what it is, howManyTimes] —
 * so a failure names the missing rule rather than a string. Every needle is
 * matched against the file with comments blanked out, and every one of them was
 * checked to occur in CODE in browser/translationHost.js, not only in the prose
 * around it.
 */
const HOST_SHAPE_MARKERS = [
    ["function shapeRequest(", "the request-shaping function"],
    ["INIT_KEYS.includes(key)", "the refusal of unknown request-init keys"],
    ['method !== "GET" && method !== "POST"', "the GET/POST-only method union"],
    ["body.length > MAX_BODY_CHARS", "the request body cap"],
    ['"application/json; charset=utf-8"', "the fixed, never-caller-supplied content type"],
    ['target.port !== ""', "the https-default-port-only constraint"],
    // An allowed hostname reached as https://user:pass@host/ passes the hostname and
    // port tests, and .href keeps the credentials. Only fetch() refuses it today,
    // which is the runtime closing the hole rather than the guard — so the rule is
    // pinned in the shipped file the same way the others are.
    ['target.username !== "" || target.password !== ""', "the refusal of a URL carrying embedded credentials"],
    /*
     * Redirects are REFUSED, not followed and then inspected. The four markers
     * below pin the four separate pieces that make that true, because any one
     * of them going missing restores the old, broken behaviour:
     *
     *   the detector exists  ... function refusedRedirect(
     *   it is actually wired ... if (refusedRedirect(res))
     *   both verbs refuse    ... redirect: "manual", which must appear TWICE:
     *                            once in the POST init object and once in the
     *                            GET's. One is not enough — the free gtx
     *                            provider's GET carries the message text in the
     *                            query string, so a GET that follows redirects
     *                            leaks exactly what a POST would.
     *   the backstop remains ... blocked response origin
     *
     * The marker this replaced, "blocked after redirect", named a message the
     * fix deleted. It went on passing for one reason only: two comments quote
     * that wording while explaining why it was false.
     */
    ["function refusedRedirect(", "the redirect detector"],
    ["if (refusedRedirect(res))", "the refusal of a redirect response"],
    ['redirect: "manual"', "the redirect-refusing fetch option on BOTH the GET and the POST", 2],
    ["blocked response origin", "the response-origin backstop"]
];

/**
 * The same guard as content.js spells it — see shapeInit() there. Same rules as
 * above: matched against code with comments blanked, and each one verified to
 * occur in code in browser/content.js.
 */
const CONTENT_SHAPE_MARKERS = [
    ["function shapeInit(", "the relay's request-shaping function"],
    ['key !== "method" && key !== "body"', "the relay's refusal of unknown request-init keys"],
    ['method !== "GET" && method !== "POST"', "the relay's GET/POST-only method union"],
    ["init.body.length > MAX_BODY_CHARS", "the relay's request body cap"],
    ["{ method: init.method, body: init.body }", "the relay's rebuild of the options object"]
];

/*
 * The files whose BYTES must be identical in the archive and in the unpacked
 * directory.
 *
 * Everything above is asserted against the unpacked directory, and until now the
 * archive was compared to it by FILE NAME only — so dist/extension-chrome.zip
 * could have carried a different translationHost.js from the one every guard check
 * read, and the whole script would still have printed ok. The zip is the artifact
 * users install; the directory is not. These four are the ones where a divergence
 * is a security difference rather than a packaging annoyance:
 *
 *   translationHost.js         the transport, and the only host allow-list the
 *                              extension actually enforces
 *   content.js                 the hop out of the page's world
 *   dist/DiscordTranslator.js  the bundle that runs in the discord.com origin
 *   manifest.json              the host permissions and the CSP the above rely on
 */
const SECURITY_CRITICAL = [
    "translationHost.js",
    "content.js",
    "dist/DiscordTranslator.js",
    "manifest.json"
];

/*
 * The setup guide, which ships inside the package instead of on a website.
 *
 * Three files have to agree on one string, and none of them can see the other
 * two at runtime:
 *
 *   scripts/build/buildWeb.mjs                       writes it (GUIDE_PACKAGED_NAME)
 *   src/plugins/channelTranslator/settings.ts        opens it (GUIDE_FILE)
 *   this file                                        checks it, IF it was packaged
 *
 * THE GUIDE'S ABSENCE IS NOT A FAILURE, AND THAT IS THE CORRECTION. These checks
 * used to fail a package that did not carry the guide, on the assumption that a
 * guide-shaped hole was always a packaging bug. It is not: site/ is UNTRACKED —
 * `git ls-files site` returns nothing — so no CI checkout has it, buildWeb.mjs no
 * longer throws over that, and a CI package legitimately ships without the guide.
 * Failing here would have turned a nice-to-have into a red build on every machine
 * but the one that authored the file.
 *
 * So the gate is conditional on guide.html being packaged AT ALL — and on nothing
 * else. Every assertion below survives unchanged the moment it is: present in one
 * copy but not the other is still a failure, undersized is still a failure,
 * differing bytes are still a failure, and not being web-accessible is still a
 * failure. "We did not build the guide" and "we built a broken guide" are
 * different findings, and only the second one is one.
 *
 * The size floor is the second half of the same guard. "The file is present" is
 * satisfied by a zero-byte file, and a truncated copy of a 338 KB single-page
 * guide is exactly what a half-finished write leaves behind. The floor matches
 * GUIDE_MIN_BYTES in buildWeb.mjs; this one is the one that matters, because it
 * reads the artifact rather than the input.
 */
const GUIDE_FILE = "guide.html";
const GUIDE_MIN_BYTES = 50_000;

/*
 * ---------------------------------------------------------------------------
 * ...AND THE GUIDE CAN RUN, WHICH "PACKAGED" AND "REACHABLE" BOTH FAIL TO IMPLY
 * ---------------------------------------------------------------------------
 *
 * The comment above says a guide that ships but cannot be OPENED looks exactly
 * like a guide that works until someone clicks the button. This is that failure
 * one layer deeper, and it shipped: the guide opened fine and every control on it
 * was dead.
 *
 * An extension page is served under `script-src 'self'`. The guide's whole
 * interactive layer — step ticking, the progress bar, the localStorage that
 * remembers where you got to, the jump menu, the reset button — was one inline
 * <script>, and inline script is exactly what that policy forbids. From the
 * operator's console, on a shipped build:
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive "script-src 'self'". ... The action has been blocked.
 *   Context: guide.html — Stack Trace: guide.html:1143
 *
 * v0.2.7 shipped it too, so it was never a regression and nothing was ever going
 * to catch it: the page renders, the prose is all there, and only a click tells
 * you. Every check above would have printed ok.
 *
 * THE POLICY CANNOT BE RELAXED, SO THE PAGE HAS TO CHANGE. Chromium validates MV3
 * CSP on a different path from MV2. extensions/common/csp_validator.cc calls
 * IsHashSource() only from GetSecureDirectiveValues(), the MV2 sanitiser; the MV3
 * path, DoesCSPDisallowRemoteCode(), accepts a script source only if
 *
 *     source_lower == kSelfSource || source_lower == kNoneSource ||
 *     IsLocalHostSource(source_lower) ||
 *     source_lower == kWasmUnsafeEvalSource;
 *
 * — anything else, a 'sha256-...' hash included, is rejected with
 * kInvalidCSPInsecureValueError and the extension will not load. So there is no
 * manifest line that fixes this, and the only repair is to stop putting
 * executable code in the markup. scripts/build/buildWeb.mjs splits the guide's
 * inline block out into a sibling guide.js at package time, leaving the source a
 * single self-contained file for the standalone and website copies.
 *
 * WHAT IS ASSERTED HERE, AND WHY IT IS DERIVED RATHER THAN NAMED. The scan reads
 * the PACKAGED bytes and finds three things `script-src 'self'` will refuse:
 * inline <script> bodies, inline on* handlers, and javascript: URLs. Extraction
 * only fixes the first; the other two would be just as dead and just as invisible,
 * so they are asserted rather than assumed.
 *
 * The <script src> targets are then read OUT OF THE PACKAGED HTML instead of being
 * restated as "guide.js" — the same correction the provider host list needed above.
 * A check that knows the filename can only ever verify the filename it knows; this
 * one verifies whatever the page actually asks the browser to load, so renaming the
 * extracted file, adding a second one, or pointing it at a CDN all fail here rather
 * than in a user's console.
 */

/** Replace [start, end) with spaces, keeping the length so byte offsets stay true. */
function blankRegion(s, start, end) {
    return s.slice(0, start) + " ".repeat(end - start) + s.slice(end);
}

/**
 * Index of the ">" that closes the tag opening at `open`, or -1.
 *
 * Quote-aware rather than a `[^>]*` regex: `<div title="a > b" onclick="x()">`
 * would otherwise be cut at the first ">" and its handler never seen, which is a
 * false PASS in a security-shaped check.
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

/** [name, value] for every attribute in a tag's attribute region; names lowercased. */
function parseAttributes(region) {
    const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
    const out = [];
    let m;
    while ((m = ATTR.exec(region)) !== null) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]);
    return out;
}

/*
 * The `type` values the HTML spec actually EXECUTES. Everything else — a
 * "application/json" config blob, a "text/template" chunk of markup — is inert
 * data the CSP has no opinion about, and flagging it would fail a build over a
 * block that was never going to run in the first place.
 */
const EXECUTABLE_SCRIPT_TYPES = new Set([
    "", "module", "importmap",
    "text/javascript", "application/javascript",
    "text/ecmascript", "application/ecmascript"
]);

/**
 * Everything on an extension page that `script-src 'self'` will refuse to run,
 * plus every script the page loads from a file.
 *
 * @returns {{ blocked: string[], srcs: string[] }}
 */
function scanExtensionPageScripts(html) {
    const blocked = [];
    const srcs = [];

    // HTML comments go first. A commented-out `onclick=` is not a handler, and a
    // scanner that cannot tell the difference fails builds over prose — the
    // vacuous-marker bug above, inverted.
    let masked = html;
    let at = masked.indexOf("<!--");
    while (at !== -1) {
        const close = masked.indexOf("-->", at + 4);
        const stop = close === -1 ? masked.length : close + 3;
        masked = blankRegion(masked, at, stop);
        at = masked.indexOf("<!--", stop);
    }

    const OPEN = /<script\b/gi;
    // Per the HTML spec a script element's text ends at the first "</script"
    // followed by whitespace, "/" or ">" — not at every "</script" substring.
    const CLOSE = /<\/script[\s/>]/i;
    let m;
    while ((m = OPEN.exec(masked)) !== null) {
        const start = m.index;
        const openEnd = tagEnd(masked, start);
        if (openEnd === -1) {
            blocked.push(`a <script> tag at byte ${start} that is never closed by a ">"`);
            break;
        }

        const attrs = parseAttributes(masked.slice(start + "<script".length, openEnd));
        const bodyStart = openEnd + 1;
        const closeOffset = masked.slice(bodyStart).search(CLOSE);
        const bodyEnd = closeOffset === -1 ? masked.length : bodyStart + closeOffset;
        const closeTagEnd = closeOffset === -1 ? masked.length : masked.indexOf(">", bodyEnd) + 1;

        const src = attrs.find(([n]) => n === "src")?.[1];
        const type = (attrs.find(([n]) => n === "type")?.[1] ?? "").trim().toLowerCase();
        const body = masked.slice(bodyStart, bodyEnd);

        if (src !== undefined) {
            srcs.push(src.trim());
        } else if (EXECUTABLE_SCRIPT_TYPES.has(type) && body.trim() !== "") {
            blocked.push(
                `an inline <script> of ${body.length} bytes at byte ${start}` +
                (type ? ` (type ${JSON.stringify(type)})` : "")
            );
        }

        // The element's text is blanked before the attribute sweep below, so JS such
        // as `if (a<b) el.onerror = f` cannot be read as markup and reported as an
        // inline handler. blankRegion keeps the length, so OPEN.lastIndex — which
        // indexes the string we are about to reassign — stays aligned.
        masked = blankRegion(masked, bodyStart, bodyEnd);
        OPEN.lastIndex = closeTagEnd;
    }

    const TAG = /<([a-zA-Z][^\s/>]*)/g;
    let t;
    while ((t = TAG.exec(masked)) !== null) {
        const end = tagEnd(masked, t.index);
        if (end === -1) break;
        const name = t[1].toLowerCase();
        for (const [attr, value] of parseAttributes(masked.slice(t.index + 1 + t[1].length, end))) {
            if (/^on[a-z]+$/.test(attr)) {
                blocked.push(`an inline "${attr}" handler on <${name}> at byte ${t.index}`);
            }
            // Deliberately literal. An entity-encoded "&#106;avascript:" would slip
            // past this, and chasing that is a sanitiser's job on untrusted input —
            // this file reads our own build output, where the question is whether we
            // shipped dead code, not whether someone smuggled live code in.
            if (/^\s*javascript:/i.test(value)) {
                blocked.push(`a "javascript:" URL in ${attr}="..." on <${name}> at byte ${t.index}`);
            }
        }
        TAG.lastIndex = end + 1;
    }

    return { blocked, srcs };
}

/*
 * The scan is only worth its pass line if it can fail, and it is the kind of check
 * that fails SILENTLY when it breaks: a scanner that returned nothing would print
 * ok over the exact defect it was added for. So both directions are controlled, on
 * fixtures whose expected answer is written out rather than computed by the code
 * under test, and this runs before any package is read.
 */
function selfTestExtensionPageScan() {
    /** @type {[string, number, string[]][]} — [html, blocked count, srcs] */
    const cases = [
        // --- must be caught ---
        ["<script>alert(1)</script>", 1, []],
        ['<script type="text/javascript">x()</script>', 1, []],
        ['<script type="module">import "./a.js";</script>', 1, []],
        ['<div onclick="x()"></div>', 1, []],
        ["<body ONLOAD='x()'>", 1, []],
        ['<a href="javascript:void 0">x</a>', 1, []],
        ['<a href="  JavaScript:x()">x</a>', 1, []],
        // Quote-aware tag scanning: the ">" inside the title must not end the tag
        // and hide the handler after it.
        ['<div title="a > b" onclick="x()"></div>', 1, []],
        // Two problems are two findings, not one.
        ['<script>a()</script><div onmouseover="b()"></div>', 2, []],

        // --- must be clean ---
        ['<script src="guide.js"></script>', 0, ["guide.js"]],
        ['<script src="guide.js"></script><script src="guide.2.js"></script>', 0, ["guide.js", "guide.2.js"]],
        ["<!-- <script>alert(1)</script> --><p>ok</p>", 0, []],
        ['<!-- <div onclick="x()"></div> --><p>ok</p>', 0, []],
        ['<script type="application/json">{"a":1}</script>', 0, []],
        ['<script type="text/template"><div onclick="x()"></div></script>', 0, []],
        ["<script src='a.js'>// <div onclick=\"y()\"> and if (a<b) el.onerror = f\n</script>", 0, ["a.js"]],
        ["<p>the attribute is called onclick= in prose</p>", 0, []],
        ['<div data-x="a > b">ok</div>', 0, []],
        ["<p>plain markup with nothing executable</p>", 0, []],
        // A remote src is not the scanner's verdict to make — it reports the source
        // and the caller fails it. If this ever came back empty the caller would
        // pass a page loading code off a CDN.
        ['<script src="https://cdn.example.test/x.js"></script>', 0, ["https://cdn.example.test/x.js"]]
    ];

    for (const [html, wantBlocked, wantSrcs] of cases) {
        const got = scanExtensionPageScripts(html);
        if (got.blocked.length !== wantBlocked) {
            throw new Error(
                `extension-page scan self-test: expected ${wantBlocked} finding(s), got ` +
                `${got.blocked.length} for ${JSON.stringify(html)}\n  ${got.blocked.join("\n  ")}`
            );
        }
        if (got.srcs.length !== wantSrcs.length || got.srcs.some((s, i) => s !== wantSrcs[i])) {
            throw new Error(
                `extension-page scan self-test: expected srcs ${JSON.stringify(wantSrcs)}, got ` +
                `${JSON.stringify(got.srcs)} for ${JSON.stringify(html)}`
            );
        }
    }
}

selfTestExtensionPageScan();

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

/*
 * Every key path in a parsed manifest whose last segment starts with "_comment",
 * written the way Firefox writes it when it complains about one.
 *
 * Recurses through arrays as well as objects: content_scripts and
 * web_accessible_resources are arrays of objects in one manifest shape or the
 * other, so a documentation key added inside either would be invisible to an
 * object-only walk and would ship.
 */
function manifestCommentPaths(value, path = "") {
    if (Array.isArray(value)) {
        return value.flatMap((element, i) => manifestCommentPaths(element, `${path}[${i}]`));
    }
    if (value === null || typeof value !== "object") return [];

    return Object.keys(value).flatMap(key => {
        const here = path === "" ? key : `${path}.${key}`;
        return [
            ...(key.startsWith("_comment") ? [here] : []),
            ...manifestCommentPaths(value[key], here)
        ];
    });
}

/*
 * Whether a packaged file can be OPENED, which is a different question from
 * whether it was packaged.
 *
 * A page in the discord.com origin — which is where this plugin's settings
 * screen runs — cannot navigate to an extension URL unless the resource is
 * declared web-accessible. Both engines enforce it, in two different shapes:
 *
 *   MV3 (browser/manifest.json)    [{ resources: [...], matches: [...] }]
 *   MV2 (browser/manifestv2.json)  ["a/plain.js", "list/*"]
 *
 * Both are read here, because "present in the package" and "reachable from the
 * page" fail independently and a guide that ships but cannot be opened looks
 * exactly like a guide that works until someone clicks the button.
 */
function webAccessiblePatterns(manifest) {
    const declared = manifest.web_accessible_resources;
    if (!Array.isArray(declared)) return [];
    return declared.flatMap(entry => {
        if (typeof entry === "string") return [entry];
        return Array.isArray(entry?.resources) ? entry.resources : [];
    });
}

/**
 * A resource pattern as the extension platforms read it: `*` is a wildcard that
 * also crosses `/`, and everything else is literal. Conservative on purpose —
 * anything this does not understand simply fails to match, which reports a
 * missing declaration rather than inventing one.
 */
function matchesResourcePattern(pattern, name) {
    const escaped = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`^${escaped.join(".*")}$`).test(name);
}

for (const target of TARGETS) {
    console.log(`\n${target.name}`);

    const dir = join(ROOT, target.dir);
    const zipPath = join(ROOT, target.zip);

    if (!existsSync(dir)) { fail(`${target.dir} missing — did buildWeb run?`); continue; }
    if (!existsSync(zipPath)) { fail(`${target.zip} missing`); continue; }

    /*
     * The archive is read up front because every guard below is now run TWICE:
     * once over the unpacked directory, and once over the bytes actually inside
     * the zip. Reading the directory alone was the gap — the zip is what a user
     * installs, and it was only ever compared to the directory by FILE NAME.
     */
    const zipfs = Zip.sync.unzip(zipPath).memory();
    // contents() returns an array of entry names; Object.keys() on it yields indices,
    // which silently turns every comparison below into nonsense.
    const zipNames = new Set(zipfs.contents().filter(n => !n.endsWith("/")));

    /** Text of one packaged file, or null if this copy does not have it at all. */
    const fromZip = name => (zipNames.has(name) ? zipfs.read(name, "text") : null);
    const fromDir = name =>
        (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);

    /*
     * Every source-level guard assertion, over ONE copy of the built files.
     *
     * `where` is part of each message on purpose: "the request shape guard is
     * missing" and "the request shape guard is missing FROM THE ZIP THAT SHIPS but
     * present in the directory we build from" are different bugs with different
     * causes, and a message that cannot tell them apart sends the reader to the
     * wrong place.
     */
    function checkPackagedGuards(where, read) {
        /*
         * Every presence assertion below reads THIS, not the raw file: the same
         * text with its comments blanked out. A rule that survives only in the
         * comment explaining it is not present, and saying so is the whole
         * point — see stripComments() at the top of this file.
         *
         * A stripper that throws means the packaged file is not JavaScript this
         * script can reason about, which is itself a finding, so it fails rather
         * than quietly falling back to the raw text it was written to replace.
         */
        const codeOf = (name, text) => {
            try {
                return stripComments(text, `${where}: ${name}`);
            } catch (err) {
                fail(`${where}: ${name} could not be parsed well enough to separate code from comments (${err.message})`);
                return null;
            }
        };

        /** How many times a needle occurs in code, and whether that is enough. */
        const missingFrom = (code, markers) =>
            markers.filter(([needle, , min = 1]) => code.split(needle).length - 1 < min);

        const reportMissing = (code, missing, file) => {
            for (const [needle, what, min = 1] of missing) {
                const found = code.split(needle).length - 1;
                const detail = min === 1
                    ? `no ${JSON.stringify(needle)} outside comments`
                    : `${JSON.stringify(needle)} occurs ${found} time(s) in code, needs ${min}`;
                fail(`${where}: ${file} has lost ${what} (${detail})`);
            }
        };

        const host = read("translationHost.js");
        const hostCode = host === null ? null : codeOf("translationHost.js", host);
        if (host === null) {
            fail(`${where}: translationHost.js is not in the package — translation cannot work`);
        } else if (hostCode !== null) {
            if (!hostCode.includes("ALLOWED_HOSTS.has")) {
                fail(`${where}: translationHost.js does not use an exact-match host check`);
            } else pass(`${where}: transport present, exact-match host guard intact`);

            /*
             * The manifest is compared against the hosts THIS copy of the transport
             * can reach, and against nothing else. Both halves are read from the same
             * copy on purpose: a zip whose manifest and whose transport disagree with
             * each other is a real, separately-caused bug from a zip that disagrees
             * with the directory, and the byte-identity check further down cannot see
             * the first one.
             */
            const derived = providerHostsFrom(hostCode);
            if (derived.why) {
                fail(`${where}: cannot read the transport's host allow-list, so the manifest ` +
                    `cannot be checked against it (${derived.why})`);
            } else {
                const manifestText = read("manifest.json");
                if (manifestText === null) {
                    fail(`${where}: manifest.json is not in the package`);
                } else {
                    let perms = null;
                    try {
                        const parsed = JSON.parse(manifestText);
                        perms = parsed.host_permissions || parsed.permissions || [];
                    } catch (err) {
                        fail(`${where}: manifest.json is not valid JSON (${err.message})`);
                    }

                    if (perms !== null) {
                        const ungranted = derived.hosts.filter(
                            h => !perms.some(p => typeof p === "string" && permissionGrantsHost(p, h)));
                        for (const h of ungranted) {
                            fail(`${where}: the transport may reach ${h}, and manifest.json grants no ` +
                                "permission for it. Either add it to the manifest's host permissions or " +
                                "remove it from ALLOWED_HOSTS in browser/translationHost.js — the two " +
                                "must not disagree, and this list is derived from the transport rather " +
                                "than restated here so that they cannot.");
                        }
                        if (!ungranted.length) {
                            pass(`${where}: manifest grants every host the transport may reach ` +
                                `(${derived.hosts.length} derived from ALLOWED_HOSTS: ${derived.hosts.join(", ")})`);
                        }
                    }
                }
            }

            const hostMissing = missingFrom(hostCode, HOST_SHAPE_MARKERS);
            if (hostMissing.length) reportMissing(hostCode, hostMissing, "translationHost.js");
            else pass(`${where}: request shape guard intact in translationHost.js (${HOST_SHAPE_MARKERS.length} rules)`);
        }

        // --- the relay both halves speak ---
        const content = read("content.js") ?? "";
        const bundle = read("dist/DiscordTranslator.js") ?? "";
        const contentCode = content ? codeOf("content.js", content) : "";
        const bundleCode = bundle ? codeOf("dist/DiscordTranslator.js", bundle) : "";
        if (!(contentCode ?? "").includes("discordTranslator:fetch")) fail(`${where}: content.js carries no relay`);
        else if (!(bundleCode ?? "").includes("discordTranslator:fetch")) fail(`${where}: the bundle carries no relay`);
        else pass(`${where}: page/background relay present on both sides`);

        // The relay is the hop OUT of the page's world, so its copy of the shaping
        // rules has to survive the build too — translationHost.js re-checks all of it,
        // but a relay that forwarded anything unread would make that the only thing
        // between the page and the network.
        if (contentCode) {
            const contentMissing = missingFrom(contentCode, CONTENT_SHAPE_MARKERS);
            if (contentMissing.length) reportMissing(contentCode, contentMissing, "content.js");
            else pass(`${where}: request shape guard intact in content.js (${CONTENT_SHAPE_MARKERS.length} rules)`);
        }

        return bundle;
    }

    checkPackagedGuards("unpacked", fromDir);
    // The same rules, read out of the archive users actually install. Not a
    // duplicate of the line above: it is the only one of the two that inspects the
    // shipped artifact, and the byte comparison further down is what makes a PASS
    // here mean the two copies are the same file rather than two files that happen
    // to contain the same needles.
    checkPackagedGuards(`${target.zip}`, fromZip);

    const bundle = fromDir("dist/DiscordTranslator.js") ?? "";

    // --- manifest ---
    // The provider-host comparison used to live here, against a hardcoded list and
    // against the DIRECTORY's manifest only. It now runs inside checkPackagedGuards
    // above, once per copy, against the hosts derived from that copy's transport.
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

    if (/equicord|vencord/i.test(JSON.stringify(manifest))) {
        fail("upstream branding present in manifest.json");
    } else pass("no upstream branding in the manifest");

    /*
     * THE DEFECT THIS EXISTS TO KEEP FIXED. The source manifests document their own
     * decisions in "_comment"-prefixed keys — why the add-on id changed in v0.2.8
     * and must never change again, why strict_min_version is 140.0, what each
     * declared data collection permission covers. Those belong in the source. They
     * were also being copied straight into the package, and Firefox validates
     * browser_specific_settings against a schema, so loading
     * dist/extension-firefox.zip in about:debugging printed three of these:
     *
     *   Reading manifest: Warning processing
     *   browser_specific_settings.gecko.data_collection_permissions._comment:
     *   An unexpected property was found in the WebExtension manifest.
     *
     * A manifest warning is not a load failure — the extension installs and runs —
     * so nothing else in this pipeline would ever have said a word about it, and
     * AMO review reads the same warnings. stripManifestComments() in
     * scripts/build/buildWeb.mjs removes them at package time; this is the check
     * that it actually ran, on the bytes that shipped rather than on the source
     * that is supposed to produce them.
     *
     * Every offending path is named, not just the first: there were four, and a
     * message that reports one turns a single fix into four build-and-look rounds.
     */
    const commentPaths = manifestCommentPaths(manifest);
    if (commentPaths.length) {
        fail(`manifest.json ships ${commentPaths.length} documentation key(s) Firefox warns on: ` +
            `${commentPaths.join(", ")}. Keep them in browser/manifest.json and ` +
            "browser/manifestv2.json — they are the only record of why those settings are what " +
            "they are — and strip them from the package instead. stripManifestComments() in " +
            "the f.startsWith(\"manifest\") branch of buildExtension() in scripts/build/buildWeb.mjs " +
            "is what does that, so this failing means it was removed, renamed, or is no longer " +
            "reached for this target.");
    } else pass("no _comment documentation keys survived into the packaged manifest");

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
    const dirNames = walk(dir);

    const onlyZip = [...zipNames].filter(n => !dirNames.has(n));
    const onlyDir = [...dirNames].filter(n => !zipNames.has(n));

    if (onlyZip.length || onlyDir.length) {
        fail(`${target.zip} does not match ${target.dir} (file names differ)`);
        if (onlyZip.length) console.error(`        only in zip: ${onlyZip.slice(0, 8).join(", ")}`);
        if (onlyDir.length) console.error(`        only in dir: ${onlyDir.slice(0, 8).join(", ")}`);
    } else {
        pass(`archive holds the same file names as the built directory (${dirNames.size} files)`);
    }

    /*
     * ...and the same BYTES, for the files where a difference is a security
     * difference. Matching names was the whole of the old check, so the zip could
     * have carried a translationHost.js with no allow-list in it and nothing here
     * would have looked.
     *
     * Compared as buffers rather than as text: a re-encode, a BOM or a newline
     * conversion between the directory and the archive is exactly the kind of
     * silent difference this is here to see, and reading both as UTF-8 text would
     * hide some of them.
     */
    let bytesDiffer = 0;
    for (const name of SECURITY_CRITICAL) {
        const dirPath = join(dir, name);
        if (!existsSync(dirPath)) {
            fail(`${name} is missing from ${target.dir} — it is security-critical`);
            bytesDiffer++;
            continue;
        }
        if (!zipNames.has(name)) {
            fail(`${name} is missing from ${target.zip} — it is security-critical, and users install the zip`);
            bytesDiffer++;
            continue;
        }

        const inDir = readFileSync(dirPath);
        const inZip = zipfs.read(name, "buffer");
        if (!inDir.equals(inZip)) {
            fail(`${name} differs between ${target.dir} and ${target.zip} — the checks above read the directory, users install the zip`);
            console.error(`        dir sha256:${sha16(inDir)} (${inDir.length} bytes), zip sha256:${sha16(inZip)} (${inZip.length} bytes)`);
            bytesDiffer++;
        }
    }
    if (!bytesDiffer) {
        pass(`the ${SECURITY_CRITICAL.length} security-critical files are byte-identical in the archive`);
    }

    // --- no remotely hosted code, anywhere in the package ---
    // Chrome MV3 names a script tag pointing outside the package, or a string fetched
    // remotely and executed, as a policy violation. It matters more here than usual:
    // this extension removes Discord's CSP, so a compromised CDN would run in the
    // logged-in discord.com origin with nothing left to constrain it.
    for (const f of walk(dir)) {
        if (!/\.(js|html|css|json)$/.test(f)) continue;
        const body = readFileSync(join(dir, f), "utf8");
        for (const [needle, what] of [
            ["jsdelivr", "a jsDelivr URL"],
            ["cdn.", "a CDN reference"],
            ['import("http', "a dynamic import of remote code"],
            ["import('http", "a dynamic import of remote code"]
        ]) {
            if (body.includes(needle)) fail(`${what} in ${f} (found ${JSON.stringify(needle)})`);
        }
    }
    pass("no remotely hosted code in the package");

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

    // --- the setup guide ships in the package, and is openable from the page ---
    //
    // Checked in the zip AND in the directory, and then compared byte for byte,
    // for the reason the file header gives: every other assertion in this script
    // reads the directory, and the zip is the thing users install.
    const guidePath = join(dir, GUIDE_FILE);
    const guideInDir = existsSync(guidePath) ? readFileSync(guidePath) : null;
    const guideInZip = zipNames.has(GUIDE_FILE) ? zipfs.read(GUIDE_FILE, "buffer") : null;

    // Absent from BOTH copies is a build that did not have site/ — reported, so it
    // is never mistaken for a guide that shipped, but not a failure. Absent from
    // ONE copy is packaging drift and still fails: the two copies disagreeing is
    // the bug this whole script exists to see.
    const guidePackaged = guideInDir !== null || guideInZip !== null;

    if (!guidePackaged) {
        console.log(`  --    ${GUIDE_FILE} was not packaged, so the guide checks are skipped. ` +
            "This is expected on any machine without site/free/index.html (it is untracked, " +
            "so that includes CI) and buildWeb.mjs warns about it at build time. The " +
            "extension works; the plugin's \"Open the setup guide\" button will not.");
    } else if (guideInDir === null) {
        fail(`${GUIDE_FILE} is in ${target.zip} but missing from ${target.dir} — the two copies ` +
            "disagree, so one of them was not written by this build.");
    } else if (guideInZip === null) {
        fail(`${GUIDE_FILE} is missing from ${target.zip} — it is in the built directory but not ` +
            "in the archive users install, so the guide button 404s for everyone but the person " +
            "who built it.");
    } else if (guideInDir.length < GUIDE_MIN_BYTES || guideInZip.length < GUIDE_MIN_BYTES) {
        fail(`${GUIDE_FILE} is too small to be the guide ` +
            `(${guideInDir.length} bytes unpacked, ${guideInZip.length} bytes in the zip, ` +
            `floor ${GUIDE_MIN_BYTES}). A present-but-empty file passes a presence check and ` +
            "fails the user, which is why there is a floor at all.");
    } else if (!guideInDir.equals(guideInZip)) {
        fail(`${GUIDE_FILE} differs between ${target.dir} and ${target.zip} ` +
            `(dir sha256:${sha16(guideInDir)} ${guideInDir.length} bytes, ` +
            `zip sha256:${sha16(guideInZip)} ${guideInZip.length} bytes)`);
    } else {
        pass(`${GUIDE_FILE} packaged and identical in the archive ` +
            `(${(guideInZip.length / 1024).toFixed(0)} KB)`);
    }

    /*
     * ...and it can actually be opened. Presence is not reachability: the plugin
     * calls window.open() from a page in the discord.com origin, and both engines
     * refuse that for a resource the manifest has not declared web-accessible.
     * A guide that ships but cannot be opened is indistinguishable from a working
     * one until a user clicks the button, so it is asserted here rather than
     * discovered there.
     */
    const guidePatterns = webAccessiblePatterns(manifest);
    if (!guidePackaged) {
        // Nothing to reach. Asserting reachability for a file that was never packaged
        // would fail every CI build over a declaration that only matters if the file
        // is there.
    } else if (!guidePatterns.some(p => matchesResourcePattern(p, GUIDE_FILE))) {
        fail(`${GUIDE_FILE} is not web-accessible: nothing in manifest.json's ` +
            `web_accessible_resources matches it (declared: ${guidePatterns.join(", ") || "nothing"}). ` +
            "A page in the discord.com origin cannot navigate to an undeclared extension " +
            `resource, so the guide button opens nothing. Add ${JSON.stringify(GUIDE_FILE)} to ` +
            "web_accessible_resources in browser/manifest.json (the MV3 object's `resources` " +
            "array) and in browser/manifestv2.json (the MV2 flat array).");
    } else {
        pass(`${GUIDE_FILE} is declared web-accessible, so the page may open it`);
    }

    /*
     * ...and it can RUN. See the long comment on scanExtensionPageScripts(): the
     * guide shipped for two releases with its entire interactive layer in an inline
     * <script>, which every extension page refuses to execute, and every check above
     * printed ok the whole time.
     *
     * The ZIP is scanned rather than the directory. The two have just been proven
     * byte-identical, so one scan answers for both, and the zip is what a user
     * installs. latin1 because this is a byte-level scan at ASCII delimiters, not a
     * text transformation — the guide carries base64 data URIs and a decode that
     * could substitute U+FFFD has no business in a check that reports on bytes.
     */
    if (guidePackaged && guideInDir !== null && guideInZip !== null) {
        const { blocked, srcs } = scanExtensionPageScripts(guideInZip.toString("latin1"));

        if (blocked.length) {
            fail(`${GUIDE_FILE} carries ${blocked.length} thing(s) an extension page will refuse ` +
                `to run under \`script-src 'self'\`: ${blocked.join("; ")}. The page will open, ` +
                "look complete, and do nothing when a control is used — which is how this went " +
                "unnoticed through v0.2.7 and later. It cannot be fixed in the manifest: " +
                "Chromium's MV3 path (DoesCSPDisallowRemoteCode in csp_validator.cc) accepts " +
                "only 'self', 'none', 'wasm-unsafe-eval' and localhost in script-src, so neither " +
                "'unsafe-inline' nor a 'sha256-...' hash may be declared in " +
                "content_security_policy.extension_pages. Move the code into a file the page " +
                "loads with <script src>, as scripts/build/buildWeb.mjs does when it packages " +
                "the guide's own inline block.");
        } else {
            pass(`${GUIDE_FILE} has no inline script, no inline event handler and no ` +
                "\"javascript:\" URL, so `script-src 'self'` blocks nothing on it");
        }

        if (!srcs.length) {
            // Not a failure — a guide with no script of its own is a legitimately
            // static page. Said out loud because the guide DOES have an interactive
            // layer, and its silent disappearance would look exactly like this.
            console.log(`  --    ${GUIDE_FILE} loads no script of its own, so it carries no ` +
                "interactive layer. Expected only if the guide really is a static page.");
        }

        for (const src of srcs) {
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith("//")) {
                fail(`${GUIDE_FILE} loads a script from ${JSON.stringify(src)}, which is not in ` +
                    "the extension package. `script-src 'self'` blocks it, MV3 forbids declaring " +
                    "a policy that would not, and remotely-hosted code is a store-policy " +
                    "violation besides. Package the file and reference it relatively.");
                continue;
            }

            // Query and fragment are stripped: the packaged name is what the archive
            // holds, and "guide.js?v=2" resolves to the same file.
            const name = src.replace(/^\.\//, "").split(/[?#]/)[0];
            if (name === "") {
                fail(`${GUIDE_FILE} has a <script src> with an empty target, which loads nothing.`);
                continue;
            }

            const srcInDir = existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : null;
            const srcInZip = zipNames.has(name) ? zipfs.read(name, "buffer") : null;
            const missingFrom = [
                ...(srcInDir === null ? [target.dir] : []),
                ...(srcInZip === null ? [target.zip] : [])
            ];

            if (missingFrom.length) {
                fail(`${GUIDE_FILE} loads ${JSON.stringify(name)}, but it is missing from ` +
                    `${missingFrom.join(" and ")}. A <script src> pointing at a file that was not ` +
                    "packaged is the same dead interactive layer as the inline script it " +
                    "replaced, one layer further down — the page 404s the script and carries on " +
                    "looking fine. Add it to the entries written by buildExtension() in " +
                    "scripts/build/buildWeb.mjs.");
            } else if (!srcInDir.equals(srcInZip)) {
                fail(`${JSON.stringify(name)} differs between ${target.dir} and ${target.zip} ` +
                    `(dir sha256:${sha16(srcInDir)} ${srcInDir.length} bytes, ` +
                    `zip sha256:${sha16(srcInZip)} ${srcInZip.length} bytes)`);
            } else if (!guidePatterns.some(p => matchesResourcePattern(p, name))) {
                fail(`${GUIDE_FILE} loads ${JSON.stringify(name)}, which is not declared ` +
                    "web-accessible (declared: " + (guidePatterns.join(", ") || "nothing") + "). " +
                    `Add ${JSON.stringify(name)} beside ${JSON.stringify(GUIDE_FILE)} in ` +
                    "web_accessible_resources in browser/manifest.json (the MV3 object's " +
                    "`resources` array) and in browser/manifestv2.json (the MV2 flat array).");
            } else {
                pass(`${GUIDE_FILE} loads ${name} (${(srcInZip.length / 1024).toFixed(1)} KB), ` +
                    "which is packaged, identical in the archive and web-accessible");
            }
        }
    }

    console.log(`        ${(statSync(zipPath).size / 1024).toFixed(0)} KB packaged`);
}

console.log();
if (failed) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
}
console.log("extension packages OK");
