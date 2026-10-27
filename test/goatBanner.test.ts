/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The GOAT Cam banner (src/plugins/channelTranslator/panel/goatBanner.tsx) is the
 * only promotional surface in the plugin, and PRIVACY.md and the founder's v2
 * brief make promises about it that nothing else checks:
 *
 *   1. it links to goatcam.dagoat.io and to nothing else, and fetches nothing -
 *      no remote image, no url() in its stylesheet;
 *   2. the QR code and the photos are the master's and the website's, inline - the
 *      QR is the App Store route and must never be re-encoded or drawn over, and
 *      each variant carries its own photo (800px in the panel, 1600px in settings);
 *   3. the QR enlarges to at least 150 CSS px on hover and on keyboard focus of the
 *      plate, and reduced motion does not take that away (it is functional);
 *   4. nothing survives of the Goat Project banner, nor of what v2 removed: the
 *      second copy line, the animated goat lockup and its effects, and v1's QR
 *      caption.
 *
 * Like test/panelEndpointModal.test.ts, this compiles the REAL component with
 * esbuild using the real build's JSX settings (factory VencordCreateElement) and
 * evaluates it with only @webpack/common stubbed, so the assertions are about
 * what a render PRODUCES rather than about the source text. The source text is
 * swept as well, comments included. The rendered pixels (QR size, decode, focus)
 * are checked in a headless browser, not here; this file pins the rules.
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
 * SHA-256 of the master's QR path data (GOAT Cam repository, brand/goatcam-banner,
 * unchanged from v1 to v2). It decodes to the App Store listing; a changed byte is a
 * re-encoded or damaged code, which is exactly what must not ship.
 */
const QR_PATH_SHA256 = "5970ff43d0c4b0467b1f09638833db96f3e6a5d2c56e8428584dbb179b53667f";
/**
 * SHA-256 of each variant's photo data URI: the base64 of the website's own
 * site/public/assets/hero-coffee-800.webp (byte-identical to the v2 master's) and
 * hero-coffee-1600.webp, with their intrinsic sizes.
 */
const PHOTOS = {
    panel: { sha256: "7f7c0c0815742343f438082b56359aef58d30ac72fd8894bbf8d8a163b3d6bf3", width: 800, height: 498 },
    settings: { sha256: "7a2f85c3e4e8a00eb91b8fcd74c3728820b639b436f51e683688bca7c348e35c", width: 1600, height: 996 }
} as const;
/** SPEC section 7.4: the enlarged QR is at least this many CSS px. */
const QR_ZOOM_FLOOR_PX = 150;

const URL_RE = /https?:\/\/[^\s"'`)<>]+/g;
/** Strings of the Goat Project banner this one replaced. A bare dagoat.io is the old link; goatcam.dagoat.io is not matched. */
const OLD_BANNER: [string, RegExp][] = [
    ["bare dagoat.io host", /(?<![\w.-])dagoat\.io/i],
    ["Help fight Cancer", /Help fight Cancer/i],
    ["Earn GOAT", /Earn GOAT/i],
    ["Goatproject", /Goatproject/i]
];
/** What the v2 redesign removed: the second copy line, the goat lockup and its effects, v1's QR caption and two-line readout. */
const V2_REMOVED: [string, RegExp][] = [
    ["lockup class gl-*", /\bgl-[a-z]/],
    ["meteor layer", /meteor/i],
    ["lockup mark or svg", /goat-lockup__(?:mark|svg)\b/],
    ["second copy line class", /goat__line--ask/],
    ["second copy line text", /Free Windows|USB or Wi|Scan for the iPhone app/i],
    ["v1 QR tile or caption", /gc-qr__(?:tile|cap)\b/],
    ["v1 two-line readout", /gc-osd__(?:t|sep)\b/],
    ["seal glyph", /羊/]
];

interface Node {
    type: unknown;
    props: Record<string, unknown>;
    children: unknown[];
}

interface Loaded {
    css: string;
    source: string;
    render(variant: "panel" | "settings"): Node;
}

function load(patchSource: (source: string) => string = s => s): Loaded {
    const source = patchSource(SOURCE);
    const compiled = transformSync(source, {
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
        source,
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
const byClass = (tree: Node, cls: string) => elements(tree).filter(n => classes(n).includes(cls));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const VARIANTS = ["panel", "settings"] as const;

/** Every URL in a render and its stylesheet that is not one of the two allowed forms. */
function strayUrls({ css, render }: Loaded): string[] {
    const stray: string[] = [];
    for (const variant of VARIANTS) {
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

/** Every pattern of `list` found in the source text, the stylesheet or either render (text, props and class names). */
function hits(list: [string, RegExp][], loaded: Loaded, sourceText = loaded.source): string[] {
    const haystacks: [string, string][] = [["source", sourceText], ["css", loaded.css]];
    for (const variant of VARIANTS) {
        const tree = loaded.render(variant);
        const props = elements(tree).flatMap(n => Object.values(n.props).filter(v => typeof v === "string") as string[]);
        haystacks.push([`${variant} render`, [...texts(tree), ...props].join("\n")]);
    }
    return haystacks.flatMap(([where, text]) => list.filter(([, re]) => re.test(text)).map(([what]) => `${what} in ${where}`));
}

function qrSvg(tree: Node): Node | undefined {
    return elements(tree).find(n => n.type === "svg" && n.props.viewBox === "0 0 37 37");
}

function photo(tree: Node): Node | undefined {
    return elements(tree).find(n => n.type === "img" && String(n.props.src ?? "").startsWith("data:image/webp;base64,"));
}

/** Each variant's photo against its pin: present, the right file, the right intrinsic size. */
function photoProblems(loaded: Loaded): string[] {
    const problems: string[] = [];
    for (const variant of VARIANTS) {
        const img = photo(loaded.render(variant));
        if (!img) { problems.push(`${variant}: no data:image/webp photo`); continue; }
        const want = PHOTOS[variant];
        if (sha256(String(img.props.src)) !== want.sha256) problems.push(`${variant}: photo is not the pinned file`);
        if (img.props.width !== want.width || img.props.height !== want.height) problems.push(`${variant}: intrinsic size ${img.props.width}x${img.props.height}`);
    }
    return problems;
}

/**
 * The QR zoom, read from the stylesheet: the hover AND keyboard-focus trigger, the
 * enlarged size of each variant (rest size x zoom factor), and no reduced-motion
 * rule that takes the enlargement away.
 */
function qrZoomProblems(css: string): string[] {
    const problems: string[] = [];
    if (!css.includes("\n.gc-qr:hover,.goat-lockup:focus-visible .gc-qr{scale:var(--gc-qr-zoom);")) {
        problems.push("no rule scales .gc-qr on both :hover and plate :focus-visible");
    }
    const num = "(\\d+(?:\\.\\d+)?)";
    const sizes: [string, RegExp][] = [
        ["panel", new RegExp(`\\n\\.goat\\{[^}]*--gc-qr:${num}px;[^}]*--gc-qr-zoom:${num};`)],
        ["settings", new RegExp(`\\n\\.goat--settings \\.goat-lockup\\{[^}]*--gc-qr:${num}px;[^}]*--gc-qr-zoom:${num};`)]
    ];
    for (const [variant, re] of sizes) {
        const m = css.match(re);
        if (!m) { problems.push(`${variant}: QR size or zoom not found`); continue; }
        const px = Number(m[1]) * Number(m[2]);
        if (px < QR_ZOOM_FLOOR_PX) problems.push(`${variant}: enlarged QR is ${px.toFixed(1)}px`);
    }
    for (const block of css.match(/@media \(prefers-reduced-motion:reduce\)\{.*\}\}/g) ?? []) {
        if (/\.gc-qr[^{}]*\{[^}]*\bscale\s*:/.test(block)) problems.push("reduced motion overrides the QR scale");
    }
    return problems;
}

const REAL = load();

describe("GOAT Cam banner - destinations and fetches", () => {
    it("links to goatcam.dagoat.io and contains no other URL (the SVG namespace aside)", () => {
        expect(strayUrls(REAL)).toEqual([]);
    });

    it("has exactly one link, the plate itself, and the QR is inside it", () => {
        for (const variant of VARIANTS) {
            const tree = REAL.render(variant);
            const anchors = elements(tree).filter(n => n.type === "a");
            expect(anchors).toHaveLength(1);
            const [a] = anchors;
            expect(a.props.href).toBe(SITE);
            expect(a.props.target).toBe("_blank");
            expect(String(a.props.rel).split(" ").sort()).toEqual(["noopener", "noreferrer"]);
            expect(String(a.props["aria-label"])).toContain("goatcam.dagoat.io");
            // The plate IS the anchor, so :focus-visible on the focused element is
            // :focus-visible on .goat-lockup, which drives the motion and the QR zoom.
            expect(classes(a)).toEqual(["goat-lockup", "goat__link"]);
            expect(byClass(tree, "goat-lockup")).toEqual([a]);
            expect(elements(a)).toContain(byClass(tree, "gc-qr")[0]);
        }
        expect(REAL.css).toContain("\n.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-photo__frame{");
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

describe("GOAT Cam banner - QR code and photos", () => {
    it("carries the 37x37 App Store QR, byte-identical to the master, with nothing drawn over it", () => {
        for (const variant of VARIANTS) {
            const tree = REAL.render(variant);
            const svg = qrSvg(tree);
            expect(svg, "no svg with viewBox 0 0 37 37").toBeDefined();
            expect(byClass(tree, "gc-qr")[0].children).toEqual([svg]);
            expect(svg!.props.shapeRendering).toBe("crispEdges");
            expect(svg!.props.role).toBe("img");
            expect(svg!.children.map(c => (c as Node).type)).toEqual(["rect", "path"]);
            const modules = svg!.children[1] as Node;
            expect(modules.props.fill).toBe("#1c130c");
            expect(sha256(String(modules.props.d))).toBe(QR_PATH_SHA256);
        }
    });

    it("carries the website's photo inline: 800px in the panel, 1600px in settings", () => {
        expect(photoProblems(REAL)).toEqual([]);
        for (const variant of VARIANTS) expect(photo(REAL.render(variant))!.props.alt).toBe("");
    });

    it("enlarges the QR to at least 150 CSS px on hover and on keyboard focus, reduced motion included", () => {
        expect(qrZoomProblems(REAL.css)).toEqual([]);
    });
});

describe("GOAT Cam banner - nothing removed remains", () => {
    it("has none of the Goat Project strings in its source, stylesheet or render", () => {
        expect(hits(OLD_BANNER, REAL)).toEqual([]);
    });

    it("has none of what v2 removed in its source, stylesheet or render", () => {
        expect(hits(V2_REMOVED, REAL)).toEqual([]);
    });

    it("says what GOAT Cam is in one headline, and never mentions a microphone or a price", () => {
        for (const variant of VARIANTS) {
            const tree = REAL.render(variant);
            const lines = byClass(tree, "goat__line");
            expect(lines).toHaveLength(1);
            expect(texts(lines[0]).join("")).toBe("GOAT Cam — your iPhone, NOW your PC’s webcam.");
            expect(texts(byClass(tree, "goat-lockup__name")[0]).join("")).toBe("GOAT Cam");
            expect(texts(byClass(tree, "goat-lockup__tag")[0]).join("")).toBe("iPhone app·On the App Store");
            expect(texts(tree).join(" ")).not.toMatch(/microphone|\bmic\b|[$£€]\s?\d|\bUSD\b|\bprice\b|\/mo(nth)?\b/i);
        }
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
        expect(hits(OLD_BANNER, patched, "")).toEqual(["bare dagoat.io host in panel render", "bare dagoat.io host in settings render"]);
    });

    it("a remote asset in the stylesheet is caught", () => {
        const patched = load(s => s.replace(".goat{margin-top:22px;", ".goat{background:url(https://cdn.example.com/a.png);margin-top:22px;"));
        expect(strayUrls(patched)).toEqual(["css: https://cdn.example.com/a.png"]);
        expect(patched.css).toMatch(/url\(/);
    });

    it("old banner copy is caught, and goatcam.dagoat.io is not mistaken for the bare domain", () => {
        const patched = load(s => s.replace("GOAT Cam &mdash; your iPhone,", "Goat Project - Help fight Cancer, Earn GOAT,"));
        expect(hits(OLD_BANNER, patched, "")).toEqual([
            "Help fight Cancer in panel render", "Earn GOAT in panel render",
            "Help fight Cancer in settings render", "Earn GOAT in settings render"
        ]);
        expect(hits(OLD_BANNER, REAL, "GOATPROJECT")).toEqual(["Goatproject in source"]);
        expect(OLD_BANNER[0][1].test("see https://dagoat.io")).toBe(true);
        expect(OLD_BANNER[0][1].test("see https://goatcam.dagoat.io")).toBe(false);
    });

    it("a returning lockup element, effect rule or second copy line is caught", () => {
        const lockup = load(s => s.replace('<span className="gc-vf" aria-hidden="true" />', '<span className="gc-vf" aria-hidden="true" /><span className="gl-head" />'));
        expect(hits(V2_REMOVED, lockup, "")).toEqual(["lockup class gl-* in panel render", "lockup class gl-* in settings render"]);
        const effects = load(s => s.replace(".goat{margin-top:22px;", ".goat-lockup__meteors{opacity:0}\n.goat{margin-top:22px;"));
        expect(hits(V2_REMOVED, effects, "")).toEqual(["meteor layer in css"]);
        const ask = load(s => s.replace("your PC&rsquo;s webcam.</span>", "your PC&rsquo;s webcam.</span><span className=\"goat__line goat__line--ask\">Free Windows 11 app</span>"));
        expect(hits(V2_REMOVED, ask, "")).toEqual([
            "second copy line class in panel render", "second copy line text in panel render",
            "second copy line class in settings render", "second copy line text in settings render"
        ]);
    });

    it("a missing or re-encoded QR is caught", () => {
        expect(qrSvg(load(s => s.replace('viewBox="0 0 37 37"', 'viewBox="0 0 41 41"')).render("panel"))).toBeUndefined();
        const reencoded = qrSvg(load(s => s.replace('fill="#1c130c" d="M', 'fill="#1c130c" d="M0 0h1v1H0z M')).render("panel"))!;
        expect(sha256(String((reencoded.children[1] as Node).props.d))).not.toBe(QR_PATH_SHA256);
    });

    it("a missing photo, or the wrong photo in a variant, is caught", () => {
        expect(photoProblems(load(s => s.replaceAll("data:image/webp;base64,", "data:image/png;base64,")))).toEqual([
            "panel: no data:image/webp photo", "settings: no data:image/webp photo"
        ]);
        expect(photoProblems(load(s => s.replace("const photo = PHOTOS[variant];", "const photo = PHOTOS.panel;")))).toEqual([
            "settings: photo is not the pinned file", "settings: intrinsic size 800x498"
        ]);
    });

    it("a QR zoom that lost its focus trigger, shrank below 150px or is cancelled by reduced motion is caught", () => {
        const css = REAL.css;
        expect(qrZoomProblems(css.replace(".gc-qr:hover,.goat-lockup:focus-visible .gc-qr{", ".gc-qr:hover{")))
            .toEqual(["no rule scales .gc-qr on both :hover and plate :focus-visible"]);
        expect(qrZoomProblems(css.replace("--gc-qr-zoom:2.2223;", "--gc-qr-zoom:1.5;"))).toEqual(["panel: enlarged QR is 108.0px"]);
        expect(qrZoomProblems(css.replace("--gc-qr:74px;", "--gc-qr:60px;"))).toEqual(["settings: enlarged QR is 129.7px"]);
        expect(qrZoomProblems(css.replace("@media (prefers-reduced-motion:reduce){.gc-steam{display:none;}", "@media (prefers-reduced-motion:reduce){.gc-steam{display:none;}.gc-qr:hover{scale:1;}")))
            .toEqual(["reduced motion overrides the QR scale"]);
    });
});
