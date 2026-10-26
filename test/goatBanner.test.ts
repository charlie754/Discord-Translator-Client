/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The GOAT Cam banner (src/plugins/channelTranslator/panel/goatBanner.tsx) is the
 * only promotional surface in the plugin, and PRIVACY.md makes three promises
 * about it that nothing else checks:
 *
 *   1. it links to goatcam.dagoat.io and to nothing else, and fetches nothing -
 *      no remote image, no url() in its stylesheet;
 *   2. the QR code and the coffee photo are the GOAT Cam master's, inline - the
 *      QR is the App Store route and must never be re-encoded or drawn over;
 *   3. nothing of the banner it replaced survives (the Goat Project copy, its
 *      bare-domain link, its wordmark).
 *
 * Like test/panelEndpointModal.test.ts, this compiles the REAL component with
 * esbuild using the real build's JSX settings (factory VencordCreateElement) and
 * evaluates it with only @webpack/common stubbed, so the assertions are about
 * what a render PRODUCES rather than about the source text. The source text is
 * swept as well, comments included, for the strings of the old banner.
 *
 * Every assertion that pins an ABSENCE has a control below that feeds the same
 * detector a patched copy and watches it fire, because "found nothing" is also
 * what a broken detector returns.
 */

import { transformSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = join(__dirname, "..", "src", "plugins", "channelTranslator", "panel", "goatBanner.tsx");
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

const SITE = "https://goatcam.dagoat.io";
/** The SVG namespace is an identifier, not a destination; it is allowed only as an xmlns value. */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * SHA-256 of the master's QR path data and photo data URI (GOAT Cam repository,
 * brand/goatcam-banner, 2026-10-25). The QR decodes to the App Store listing; a
 * changed byte here is a re-encoded or damaged code, which is exactly what must not ship.
 */
const QR_PATH_SHA256 = "5970ff43d0c4b0467b1f09638833db96f3e6a5d2c56e8428584dbb179b53667f";
const PHOTO_URI_SHA256 = "92d9e4774fc8d304f63ef16a04c2addd56f0ef7a5ecb22129dac1eafb142e378";

const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
/** Strings of the Goat Project banner this one replaced. A bare dagoat.io is the old link; goatcam.dagoat.io is not matched. */
const OLD_BANNER: [string, RegExp][] = [
    ["bare dagoat.io host", /(?<![\w.-])dagoat\.io/i],
    ["Help fight Cancer", /Help fight Cancer/i],
    ["Earn GOAT", /Earn GOAT/i],
    ["Goatproject", /Goatproject/i]
];

interface Node {
    type: unknown;
    props: Record<string, unknown>;
    children: unknown[];
}

interface Loaded {
    css: string;
    render(variant: "panel" | "settings"): Node;
}

function load(patchSource: (source: string) => string = s => s): Loaded {
    const compiled = transformSync(patchSource(SOURCE), {
        loader: "tsx",
        format: "cjs",
        target: "es2022",
        jsx: "transform",
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        sourcefile: "goatBanner.tsx"
    }).code;

    const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node =>
        ({ type, props: props ?? {}, children: children.flat() });

    const modules: Record<string, unknown> = {
        "@webpack/common": { React: { useEffect: () => { } } }
    };
    const require_ = (id: string) => {
        if (!(id in modules)) throw new Error(`goatBanner.tsx imported ${JSON.stringify(id)}, which this harness has no stub for.`);
        return modules[id];
    };

    const module_ = { exports: {} as any };
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "VencordCreateElement", "VencordFragment", compiled);
    run(require_, module_, module_.exports, createElement, Symbol("Fragment"));
    return {
        css: module_.exports.GOAT_BANNER_CSS,
        render: variant => module_.exports.GoatBanner({ variant })
    };
}

function elements(root: Node): Node[] {
    const out: Node[] = [];
    const walk = (n: unknown) => {
        if (!n || typeof n !== "object") return;
        out.push(n as Node);
        (n as Node).children.forEach(walk);
    };
    walk(root);
    return out;
}

function texts(root: Node): string[] {
    const out: string[] = [];
    const walk = (n: unknown) => {
        if (typeof n === "string" || typeof n === "number") out.push(String(n));
        else if (n && typeof n === "object") (n as Node).children.forEach(walk);
    };
    walk(root);
    return out;
}

const classes = (n: Node) => String(n.props.className ?? "").split(/\s+/).filter(Boolean);

/** Every URL in a render and its stylesheet that is not one of the two allowed forms. */
function strayUrls({ css, render }: Loaded): string[] {
    const stray: string[] = [];
    for (const variant of ["panel", "settings"] as const) {
        const tree = render(variant);
        for (const n of elements(tree)) {
            for (const [name, value] of Object.entries(n.props)) {
                if (typeof value !== "string") continue;
                for (const url of value.match(URL_RE) ?? []) {
                    if (url === SITE && name === "href") continue;
                    if (url === SVG_NS && name === "xmlns") continue;
                    stray.push(`${variant} <${String(n.type)} ${name}>: ${url}`);
                }
            }
        }
        for (const t of texts(tree)) for (const url of t.match(URL_RE) ?? []) stray.push(`${variant} text: ${url}`);
    }
    for (const url of css.match(URL_RE) ?? []) stray.push(`css: ${url}`);
    return stray;
}

/** Every old-banner string found in the source text, the stylesheet or either render. */
function oldBannerHits(loaded: Loaded, sourceText: string): string[] {
    const haystacks: [string, string][] = [["source", sourceText], ["css", loaded.css]];
    for (const variant of ["panel", "settings"] as const) {
        const tree = loaded.render(variant);
        const props = elements(tree).flatMap(n => Object.values(n.props).filter(v => typeof v === "string") as string[]);
        haystacks.push([`${variant} render`, [...texts(tree), ...props].join("\n")]);
    }
    return haystacks.flatMap(([where, text]) => OLD_BANNER.filter(([, re]) => re.test(text)).map(([what]) => `${what} in ${where}`));
}

function qrSvg(tree: Node): Node | undefined {
    return elements(tree).find(n => n.type === "svg" && n.props.viewBox === "0 0 37 37");
}

function photo(tree: Node): Node | undefined {
    return elements(tree).find(n => n.type === "img" && String(n.props.src ?? "").startsWith("data:image/webp;base64,"));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const REAL = load();

describe("GOAT Cam banner - destinations and fetches", () => {
    it("links to goatcam.dagoat.io and contains no other URL (the SVG namespace aside)", () => {
        expect(strayUrls(REAL)).toEqual([]);
    });

    it("has exactly one link, the plate itself, opening the site in a new window", () => {
        for (const variant of ["panel", "settings"] as const) {
            const anchors = elements(REAL.render(variant)).filter(n => n.type === "a");
            expect(anchors).toHaveLength(1);
            const [a] = anchors;
            expect(a.props.href).toBe(SITE);
            expect(a.props.target).toBe("_blank");
            expect(String(a.props.rel).split(" ").sort()).toEqual(["noopener", "noreferrer"]);
            expect(String(a.props["aria-label"])).toContain("goatcam.dagoat.io");
            // The plate IS the anchor, so :focus-visible on the focused element is
            // :focus-visible on .goat-lockup, which is what the stylesheet animates.
            expect(classes(a)).toEqual(["goat-lockup", "goat__link"]);
            expect(elements(REAL.render(variant)).filter(n => classes(n).includes("goat-lockup"))).toEqual([a]);
        }
        expect(REAL.css).toContain(".goat-lockup:is(:hover,:focus-visible,.is-active) .gl-thumb{");
    });

    it("references no remote asset from its stylesheet", () => {
        expect(REAL.css).not.toMatch(/url\(|@import/i);
    });

    it("gates the panel lift on .shell:hover and leaves the settings lift ungated", () => {
        expect(classes(REAL.render("panel"))).toEqual(["goat", "goat--panel", "goat--gated"]);
        expect(classes(REAL.render("settings"))).toEqual(["goat", "goat--settings"]);
        expect(REAL.css).toContain(".shell:hover .goat--gated .goat-lockup:hover{transform:var(--gc-lift)");
    });
});

describe("GOAT Cam banner - QR code and photo are the master's, inline", () => {
    it("carries the 37x37 App Store QR, byte-identical to the master", () => {
        for (const variant of ["panel", "settings"] as const) {
            const svg = qrSvg(REAL.render(variant));
            expect(svg, "no svg with viewBox 0 0 37 37").toBeDefined();
            expect(svg!.props.shapeRendering).toBe("crispEdges");
            expect(svg!.props.role).toBe("img");
            const modules = svg!.children.find(c => (c as Node).type === "path") as Node;
            expect(modules.props.fill).toBe("#1c130c");
            expect(sha256(String(modules.props.d))).toBe(QR_PATH_SHA256);
            // nothing drawn over it: a background rect and the modules path, and nothing else
            expect(svg!.children.map(c => (c as Node).type)).toEqual(["rect", "path"]);
        }
    });

    it("carries the coffee photo as an inline WebP data URI, byte-identical to the master", () => {
        for (const variant of ["panel", "settings"] as const) {
            const img = photo(REAL.render(variant));
            expect(img, "no data:image/webp photo").toBeDefined();
            expect(sha256(String(img!.props.src))).toBe(PHOTO_URI_SHA256);
            expect(img!.props.alt).toBe("");
        }
    });
});

describe("GOAT Cam banner - nothing of the old banner remains", () => {
    it("has none of the Goat Project strings in its source, stylesheet or render", () => {
        expect(oldBannerHits(REAL, SOURCE)).toEqual([]);
    });

    it("says what GOAT Cam is, and never mentions a microphone or a price", () => {
        const copy = texts(REAL.render("panel")).join("");
        expect(copy).toContain("GOAT Cam — your iPhone, NOW your PC’s webcam.");
        expect(copy).toContain("Free Windows 11 app · USB or Wi‑Fi · Scan for the iPhone app.");
        expect(copy).not.toMatch(/microphone|\bmic\b|[$£€]\s?\d|\bUSD\b|\bprice\b|\/mo(nth)?\b/i);
    });
});

/**
 * The controls. Each feeds a detector above a patched copy of the real source and
 * requires it to fire - otherwise the empty results above prove nothing.
 */
describe("GOAT Cam banner - the detectors can fail", () => {
    it("a second destination in the markup is caught", () => {
        const patched = load(s => s.replace('target="_blank"', 'target="_blank" title="https://cdn.example.com/x.png"'));
        expect(strayUrls(patched)).toEqual([
            "panel <a title>: https://cdn.example.com/x.png",
            "settings <a title>: https://cdn.example.com/x.png"
        ]);
    });

    it("a changed link target is caught", () => {
        const patched = load(s => s.replace('const GOAT_URL = "https://goatcam.dagoat.io"', 'const GOAT_URL = "https://dagoat.io"'));
        expect(strayUrls(patched)).toEqual(["panel <a href>: https://dagoat.io", "settings <a href>: https://dagoat.io"]);
        expect(oldBannerHits(patched, "")).toEqual(["bare dagoat.io host in panel render", "bare dagoat.io host in settings render"]);
    });

    it("a remote asset in the stylesheet is caught", () => {
        const patched = load(s => s.replace(".goat{margin-top:22px;", ".goat{background:url(https://cdn.example.com/a.png);margin-top:22px;"));
        expect(strayUrls(patched)).toEqual(["css: https://cdn.example.com/a.png"]);
        expect(patched.css).toMatch(/url\(/);
    });

    it("old banner copy is caught, and goatcam.dagoat.io is not mistaken for the bare domain", () => {
        const patched = load(s => s.replace("GOAT Cam &mdash; your iPhone,", "Goat Project - Help fight Cancer, Earn GOAT,"));
        expect(oldBannerHits(patched, "")).toEqual([
            "Help fight Cancer in panel render", "Earn GOAT in panel render",
            "Help fight Cancer in settings render", "Earn GOAT in settings render"
        ]);
        expect(oldBannerHits(REAL, "GOATPROJECT")).toEqual(["Goatproject in source"]);
        expect(OLD_BANNER[0][1].test("see https://dagoat.io")).toBe(true);
        expect(OLD_BANNER[0][1].test("see https://goatcam.dagoat.io")).toBe(false);
    });

    it("a missing or re-encoded QR, and a missing photo, are caught", () => {
        expect(qrSvg(load(s => s.replace('viewBox="0 0 37 37"', 'viewBox="0 0 41 41"')).render("panel"))).toBeUndefined();
        const reencoded = qrSvg(load(s => s.replace('fill="#1c130c" d="M', 'fill="#1c130c" d="M0 0h1v1H0z M')).render("panel"))!;
        expect(sha256(String((reencoded.children[1] as Node).props.d))).not.toBe(QR_PATH_SHA256);
        expect(photo(load(s => s.replace("data:image/webp;base64,", "data:image/png;base64,")).render("panel"))).toBeUndefined();
    });
});
