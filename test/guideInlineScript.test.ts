/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * The setup guide is copied into the extension as guide.html. Its entire
 * interactive layer — step ticking, the progress bar, the localStorage that
 * remembers where you got to, the jump menu, the reset button, the live region —
 * lived in ONE inline <script>. Extension pages are served under
 * `script-src 'self'`, which forbids inline execution, so on a real install the
 * operator's console said:
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive "script-src 'self'". ... The action has been blocked.
 *   Context: guide.html — Stack Trace: guide.html:1143
 *
 * It was never a regression. v0.2.7 shipped it and so did every build after, which
 * is the whole problem: the page opens, the prose is all there, and nothing says a
 * word until a user clicks something. A test that reads the guide's TEXT would have
 * passed the entire time.
 *
 * WHY THIS IS A NEW FILE INSTEAD OF MORE OF guideTarget.test.ts. That suite is
 * about what guideTarget() RETURNS — which URL the button opens, and that it is
 * never a placeholder. This one is about whether the page at that URL can execute.
 * Same feature, different failure, and the fixtures have nothing in common.
 *
 * WHAT RUNS ALWAYS AND WHAT DOES NOT.
 *
 *   - The MANIFEST assertions always run. Both manifests are tracked, so these are
 *     the part of this suite CI actually exercises, and they cover the two ways the
 *     fix can be undone: dropping guide.js out of web_accessible_resources, or
 *     "fixing" the CSP in the manifest instead (see below — MV3 will not have it).
 *   - The SOURCE assertions are skipped when site/free/index.html is absent.
 *     buildWeb.mjs and checkExtensionPackages.mjs both say in comments that site/
 *     is untracked and that `git ls-files site` returns nothing; that was true when
 *     they were written and is NOT true now — `git ls-files site` returns 5 paths
 *     and the guide is one of them, so a CI checkout does have it and these do run
 *     there. The skip is kept anyway, because it costs nothing and a suite that
 *     explodes on a machine missing an optional file is worse than one that says so.
 *   - The PACKAGED assertions are skipped without dist/browser/*-unpacked, i.e.
 *     unless `pnpm buildWeb` has run in this tree.
 *
 * Skipping is stated rather than silent: a suite that quietly checks nothing looks
 * exactly like a suite that passes.
 *
 * WHY THE MANIFEST CANNOT BUY INLINE SCRIPT BACK. Chromium validates MV3 CSP on a
 * different code path from MV2. extensions/common/csp_validator.cc calls
 * IsHashSource() only from GetSecureDirectiveValues() — the MV2 sanitiser — while
 * the MV3 path, DoesCSPDisallowRemoteCode(), accepts a script source only if
 *
 *     source_lower == kSelfSource || source_lower == kNoneSource ||
 *     IsLocalHostSource(source_lower) ||
 *     source_lower == kWasmUnsafeEvalSource;
 *
 * Anything else — 'unsafe-inline', a nonce, or a 'sha256-...' hash — is rejected
 * with kInvalidCSPInsecureValueError and the extension fails to load. MDN puts it
 * in one line: "Manifest V3 does not allow CSP hashes in script-src of
 * extension_pages." So the only repair is to stop putting executable code in the
 * markup, which scripts/build/buildWeb.mjs now does at package time — leaving the
 * source a single self-contained file for the standalone and website copies, which
 * is a property that was won by fixing a different bug and must not be spent here.
 *
 * Every scanner below carries a positive and a negative control, because the way
 * this kind of check dies is by quietly matching nothing and printing green.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GUIDE_SOURCE = join(ROOT, "site", "free", "index.html");
const PACKAGE_DIRS = ["chromium-unpacked", "firefox-unpacked"].map(name => ({
    name,
    dir: join(ROOT, "dist", "browser", name)
}));

const SOURCE_PRESENT = existsSync(GUIDE_SOURCE);
const itSource = SOURCE_PRESENT ? it : it.skip;

// ---------------------------------------------------------------------------
// The scanners. Deliberately simpler than the ones in
// scripts/checkExtensionPackages.mjs rather than shared with them: two
// independent implementations agreeing is worth more here than one that cannot
// disagree with itself, and this file cannot import that script anyway — it runs
// its whole gate at module scope.
// ---------------------------------------------------------------------------

interface Masked {
    /** The markup with every <script> body and every HTML comment blanked out. */
    markup: string;
    /** The body of each <script> that has no src, in document order. */
    inline: string[];
    /** The src of each <script> that has one, in document order. */
    srcs: string[];
}

/**
 * Blank the parts of an HTML document that are not markup, so a `javascript:` in
 * prose or an `el.onclick =` inside a script body cannot be read as an attribute.
 * Blanking preserves length, so nothing downstream shifts.
 */
function mask(html: string): Masked {
    const inline: string[] = [];
    const srcs: string[] = [];

    let markup = html.replace(
        /(<script\b([^>]*)>)([\s\S]*?)(<\/script\s*>)/gi,
        (_m, open: string, attrs: string, body: string, close: string) => {
            const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i.exec(attrs);
            if (src) srcs.push((src[1] ?? src[2] ?? src[3]).trim());
            else inline.push(body);
            return open + " ".repeat(body.length) + close;
        }
    );

    markup = markup.replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length));

    return { markup, inline, srcs };
}

/**
 * The attribute region of every tag in `markup`, i.e. what sits between the tag
 * name and the ">" that closes it.
 *
 * Quote-aware, and scanning tags rather than the whole document, for two reasons
 * the controls below pin down: a document is allowed to say "onclick=" in its PROSE
 * — this guide is a setup guide, so it plausibly will — and `<div title="a > b"
 * onclick="x()">` must not be cut at the first ">" with its handler left unseen.
 * One of those is a false failure and the other is a false pass.
 */
function tagRegions(markup: string): string[] {
    const out: string[] = [];
    const OPEN = /<([a-zA-Z][^\s/>]*)/g;
    let m: RegExpExecArray | null;

    while ((m = OPEN.exec(markup)) !== null) {
        let quote: string | null = null;
        let end = -1;
        for (let i = m.index + 1; i < markup.length; i++) {
            const c = markup[i];
            if (quote !== null) {
                if (c === quote) quote = null;
                continue;
            }
            if (c === '"' || c === "'") { quote = c; continue; }
            if (c === ">") { end = i; break; }
        }
        if (end === -1) break;
        out.push(markup.slice(m.index + 1 + m[1].length, end));
        OPEN.lastIndex = end + 1;
    }

    return out;
}

/** Inline event handlers and `javascript:` URLs — dead under `script-src 'self'`. */
function deadAttributes(html: string): string[] {
    return tagRegions(mask(html).markup).flatMap(region => [
        ...(region.match(/\son[a-z]+\s*=/gi) ?? []).map(m => `inline handler ${m.trim()}`),
        ...(region.match(/=\s*["']?\s*javascript:/gi) ?? []).map(() => 'a "javascript:" URL')
    ]);
}

/** Every web_accessible_resources pattern, in either the MV2 or the MV3 shape. */
function webAccessible(manifest: any): string[] {
    const declared = manifest.web_accessible_resources;
    if (!Array.isArray(declared)) return [];
    return declared.flatMap((entry: any) =>
        (typeof entry === "string" ? [entry] : Array.isArray(entry?.resources) ? entry.resources : []));
}

/**
 * Script sources in a CSP that Chromium's MV3 validator rejects. See the header:
 * only 'self', 'none', 'wasm-unsafe-eval' and localhost survive
 * DoesCSPDisallowRemoteCode(), so a hash or 'unsafe-inline' is not a relaxation
 * the browser will accept — it is an extension that refuses to load.
 */
function rejectedByMv3(policy: string): string[] {
    const allowed = /^('self'|'none'|'wasm-unsafe-eval'|http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/i;
    return policy
        .split(";")
        .map(directive => directive.trim())
        .filter(directive => /^script-src(-elem)?\s/i.test(directive))
        .flatMap(directive => directive.split(/\s+/).slice(1))
        .filter(source => source !== "" && !allowed.test(source));
}

describe("the scanners can fail", () => {
    it("sees an inline script, an inline handler and a javascript: URL", () => {
        expect(mask("<script>alert(1)</script>").inline).toEqual(["alert(1)"]);
        expect(deadAttributes('<div onclick="x()"></div>')).toHaveLength(1);
        expect(deadAttributes('<a href="javascript:void 0">x</a>')).toHaveLength(1);
        expect(deadAttributes("<body ONLOAD='x()'>")).toHaveLength(1);
        // The ">" inside the title must not end the tag and hide what follows it.
        expect(deadAttributes('<div title="a > b" onclick="x()"></div>')).toHaveLength(1);
        expect(deadAttributes("<a href=javascript:x()>y</a>")).toHaveLength(1);
    });

    it("does not see them where they are not (negative control)", () => {
        expect(mask('<script src="guide.js"></script>').inline).toEqual([]);
        expect(mask('<script src="guide.js"></script>').srcs).toEqual(["guide.js"]);
        // A commented-out handler is not a handler.
        expect(deadAttributes('<!-- <div onclick="x()"></div> --><p>ok</p>')).toEqual([]);
        // ...and neither is a property assignment inside a script the page loads.
        expect(deadAttributes('<script src="a.js">el.onclick = f; "javascript:x"</script>')).toEqual([]);
        expect(deadAttributes("<p>the attribute is called onclick= in prose</p>")).toEqual([]);
    });

    it("reads both web_accessible_resources shapes, and neither out of nothing", () => {
        expect(webAccessible({ web_accessible_resources: ["a.js", "b/*"] })).toEqual(["a.js", "b/*"]);
        expect(webAccessible({ web_accessible_resources: [{ resources: ["a.js"], matches: ["*://x/*"] }] }))
            .toEqual(["a.js"]);
        expect(webAccessible({})).toEqual([]);
    });

    it("rejects exactly the script sources MV3 rejects", () => {
        expect(rejectedByMv3("script-src 'self'; object-src 'self'")).toEqual([]);
        expect(rejectedByMv3("script-src 'self' 'wasm-unsafe-eval'")).toEqual([]);
        expect(rejectedByMv3("script-src 'self' 'unsafe-inline'")).toEqual(["'unsafe-inline'"]);
        expect(rejectedByMv3("script-src 'self' 'sha256-whpHUokdbanSLYcZSQYI3eDwpd+Smc1z0pYxR2JrdWw='"))
            .toEqual(["'sha256-whpHUokdbanSLYcZSQYI3eDwpd+Smc1z0pYxR2JrdWw='"]);
        expect(rejectedByMv3("script-src 'self' https://cdn.example.test")).toEqual(["https://cdn.example.test"]);
    });
});

describe.each([
    ["browser/manifest.json", "manifest.json"],
    ["browser/manifestv2.json", "manifestv2.json"]
])("%s", (label, file) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "browser", file), "utf8"));

    it("declares guide.html web-accessible, so the settings button can open it", () => {
        expect(webAccessible(manifest)).toContain("guide.html");
    });

    /*
     * guide.js is the file buildWeb.mjs extracts the inline block into. Declaring it
     * costs nothing and removes a question this repo cannot answer without a
     * browser, so it is declared rather than reasoned about.
     */
    it("declares guide.js web-accessible, so the page's own script is never in doubt", () => {
        expect(webAccessible(manifest)).toContain("guide.js");
    });

    it("does not try to allow inline script in the manifest", () => {
        const declared = manifest.content_security_policy;
        if (declared === undefined) return; // the default is exactly what is wanted

        const policies: string[] = typeof declared === "string"
            ? [declared]
            : Object.values(declared).filter((v): v is string => typeof v === "string");

        for (const policy of policies) {
            expect({ policy, rejected: rejectedByMv3(policy) }).toEqual({ policy, rejected: [] });
        }
    });
});

describe(`the guide source (${SOURCE_PRESENT ? "present" : "ABSENT — skipped, site/ is untracked"})`, () => {
    itSource("carries nothing the build cannot rescue by extraction", () => {
        // Extraction moves a <script> body into a file. It cannot do anything for an
        // inline onclick= or a javascript: href, which `script-src 'self'` kills just
        // as dead and just as quietly — so those must not be written in the first place.
        expect(deadAttributes(readFileSync(GUIDE_SOURCE, "latin1"))).toEqual([]);
    });

    itSource("still has the interactive layer the packaged copy is built from", () => {
        // If this ever goes to zero the guide became a static page. That may be
        // deliberate, but it must not happen by accident — the extraction step would
        // have nothing to move and the packaged guide would be inert with no error
        // anywhere.
        const { inline } = mask(readFileSync(GUIDE_SOURCE, "latin1"));
        expect(inline.length).toBeGreaterThan(0);
        expect(inline.join("").trim().length).toBeGreaterThan(1000);
    });
});

describe.each(PACKAGE_DIRS)("the packaged guide in dist/browser/$name", ({ dir }) => {
    const built = existsSync(join(dir, "guide.html"));
    const itBuilt = built ? it : it.skip;

    itBuilt("has no inline script, no inline handler and no javascript: URL", () => {
        const html = readFileSync(join(dir, "guide.html"), "latin1");
        const { inline } = mask(html);
        expect(inline.filter(body => body.trim() !== "")).toEqual([]);
        expect(deadAttributes(html)).toEqual([]);
    });

    itBuilt("loads its script from a file that is packaged beside it", () => {
        const { srcs } = mask(readFileSync(join(dir, "guide.html"), "latin1"));
        expect(srcs.length).toBeGreaterThan(0);

        for (const src of srcs) {
            // Remote code is blocked by `script-src 'self'` and forbidden by MV3
            // outright, so a src that is not a relative path is a failure, not a
            // file to go looking for.
            expect({ src, remote: /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith("//") })
                .toEqual({ src, remote: false });

            const name = src.replace(/^\.\//, "").split(/[?#]/)[0];
            expect({ src, packaged: existsSync(join(dir, name)) }).toEqual({ src, packaged: true });
            expect(readFileSync(join(dir, name)).length).toBeGreaterThan(0);
        }
    });

    /*
     * The end-to-end assertion, and the only one that can prove the extraction did
     * not corrupt anything: the bytes in the packaged file are the bytes that were
     * inline in the source. Runs only where both halves exist.
     */
    (built && SOURCE_PRESENT ? it : it.skip)("carries the source's inline block byte for byte", () => {
        const source = mask(readFileSync(GUIDE_SOURCE, "latin1"));
        const { srcs } = mask(readFileSync(join(dir, "guide.html"), "latin1"));

        expect(srcs.length).toBe(source.inline.length);
        srcs.forEach((src, i) => {
            const name = src.replace(/^\.\//, "").split(/[?#]/)[0];
            expect(readFileSync(join(dir, name), "latin1")).toBe(source.inline[i]);
        });
    });
});
