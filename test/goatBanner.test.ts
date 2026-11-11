import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";

const SOURCE_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "panel", "goatBanner.tsx");
const VALID_PATH = join(process.cwd(), "test", "banner", "vectors", "cases", "valid.signed");
const MAX_TEXT_PATH = join(process.cwd(), "test", "banner", "vectors", "cases", "max-text.signed");
const SOURCE = readFileSync(SOURCE_PATH, "utf8");
const DAGOAT_URL = "https://dagoat.io";
const SVG_NS = "http://www.w3.org/2000/svg";
const MAPS_IPHONE_PREVIEW_SHA256 = "bb1247eb9a66af97d32f6f52b6252e3fa0174a5dba954210bbaa66919114cc28";

type Banner = Record<string, any>;

interface Node {
    type: unknown;
    props: Record<string, any>;
    children: unknown[];
}

interface Loaded {
    css: string;
    source: string;
    events: {
        pointer: ReturnType<typeof vi.fn>;
        focus: ReturnType<typeof vi.fn>;
        click: ReturnType<typeof vi.fn>;
    };
    helpers: {
        qrPathFromRows(rows: string[]): string;
        fitClass(text: string, max: number): string;
    };
    render(variant: "panel" | "settings"): Node;
}

function payload(path: string): Banner {
    return JSON.parse(readFileSync(path, "utf8").split(/\r?\n/, 2)[1]);
}

const valid = payload(VALID_PATH);
const maxText = payload(MAX_TEXT_PATH);
const photoDataUrl = "data:image/webp;base64,verified-webp";

function onlineModel(banner: Banner = valid) {
    return { kind: "online", banner, photoDataUrl };
}

const liveBanner = {
    ...valid,
    tagline: ["Your iPhone, NOW", "your PC’s webcam."],
    badge: "1440p · 60 fps"
};

function load(model: { kind: "dagoat" } | ReturnType<typeof onlineModel> = { kind: "dagoat" }, patchSource: (source: string) => string = s => s): Loaded {
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

    const events = {
        pointer: vi.fn(),
        focus: vi.fn(),
        click: vi.fn()
    };
    const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node =>
        ({ type, props: props ?? {}, children: children.flat() });
    const modules: Record<string, unknown> = {
        "@webpack/common": { React: { useEffect: () => undefined } },
        "../banner/coordinator": {
            bannerEvents: events,
            useGoatBannerModel: () => model
        }
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
        events,
        helpers: {
            qrPathFromRows: module_.exports.qrPathFromRows,
            fitClass: module_.exports.fitClass
        },
        render: (variant: "panel" | "settings") => module_.exports.GoatBanner({ variant })
    };
}

function elements(root: Node): Node[] {
    const out: Node[] = [];
    const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const node = value as Node;
        out.push(node);
        node.children.forEach(walk);
    };
    walk(root);
    return out;
}

function texts(root: Node): string[] {
    const out: string[] = [];
    const walk = (value: unknown) => {
        if (typeof value === "string" || typeof value === "number") out.push(String(value));
        else if (value && typeof value === "object") (value as Node).children.forEach(walk);
    };
    walk(root);
    return out;
}

const classes = (node: Node) => String(node.props.className ?? "").split(/\s+/).filter(Boolean);
const byClass = (tree: Node, className: string) => elements(tree).filter(node => classes(node).includes(className));
const firstClass = (tree: Node, className: string) => byClass(tree, className)[0];

function anchor(tree: Node): Node {
    const found = elements(tree).find(node => node.type === "a");
    if (!found) throw new Error("banner render did not contain an anchor");
    return found;
}

function strayUrls(loaded: Loaded): string[] {
    const allowed = new Set([DAGOAT_URL, valid.link, SVG_NS]);
    const stray: string[] = [];
    for (const variant of ["panel", "settings"] as const) {
        for (const node of elements(loaded.render(variant))) {
            for (const value of Object.values(node.props)) {
                if (typeof value !== "string") continue;
                for (const url of value.match(/https?:\/\/[^\s"'`)<>]+/g) ?? []) {
                    if (!allowed.has(url)) stray.push(`${variant}: ${url}`);
                }
            }
        }
    }
    return stray;
}

function iphonePreviewDataUrl(source: string): string {
    const match = source.match(/const IPHONE_PREVIEW_DATA_URL = "([^"]+)";/);
    if (!match) throw new Error("goatBanner.tsx is missing the iPhone preview data URL");
    return match[1];
}

describe("Goat banner pure helpers", () => {
    it("builds one QR path square per 1 cell and nothing for 0 cells", () => {
        const { qrPathFromRows } = load().helpers;
        expect(qrPathFromRows(["101", "000", "001"])).toBe("M0 0h1v1h-1zM2 0h1v1h-1zM2 2h1v1h-1z");
        expect(qrPathFromRows(["000", "000"])).toBe("");
    });

    it("returns the fitting classes at the shrink and ellipsis boundaries", () => {
        const { fitClass } = load().helpers;
        const max = 48;
        expect(fitClass("x".repeat(max), max)).toBe("");
        expect(fitClass("x".repeat(max + 1), max)).toBe("goat-fit-shrink");
        expect(fitClass("x".repeat(Math.ceil(max / 0.85) + 1), max)).toBe("goat-fit-shrink goat-fit-ellipsis");
    });
});

describe("Goat banner two-model drawing", () => {
    it("renders the original DaGoat copy and destination", () => {
        const tree = load().render("panel");
        const copy = texts(firstClass(tree, "goat__copy"));
        expect(copy).toContain("Goat Project - Help fight Cancer, Alzheimer’s, Parkinson’s, COVID-19, Dengue, Hepatitis C etc.");
        expect(copy).toContain("Contribute your idle compute to Earn GOAT.");

        const link = anchor(tree);
        expect(link.props.href).toBe(DAGOAT_URL);
        expect(link.props.rel).toBe("noopener noreferrer");
        expect(classes(tree)).toContain("goat--dagoat");
    });

    it("draws the signed online fields, photo, QR, and accessible labels", () => {
        const loaded = load(onlineModel(liveBanner));
        const tree = loaded.render("settings");
        const banner = liveBanner;
        const link = anchor(tree);

        expect(classes(tree)).toContain("goat--online");
        // Founder layout 2026-11-07: the caption is two rows split at the spaced em dash.
        const rows = elements(tree).filter(node => classes(node).includes("goat__line--row"));
        expect(rows.length).toBe(banner.headline.includes(" — ") ? 2 : 1);
        expect(rows.map(row => texts(row).join("")).join(" ")).toBe(banner.headline);
        expect(texts(firstClass(tree, "goat-lockup__name")).join("")).toBe(banner.wordmark);
        expect(texts(firstClass(tree, "gc-tag__a")).join("")).toBe(banner.tagline[0]);
        expect(texts(firstClass(tree, "gc-tag__b")).join("")).toBe(banner.tagline[1]);
        expect(firstClass(tree, "gc-tag__a").children.some(child => (child as Node).type === "em")).toBe(true);
        expect(firstClass(tree, "gc-tag__a").children.find(child => (child as Node).type === "em")).toMatchObject({
            children: [banner.headlineEm]
        });
        expect(texts(firstClass(tree, "gc-badge__text")).join("")).toBe(banner.badge);
        expect(link.props.href).toBe(banner.link);
        expect(link.props.target).toBe("_blank");
        expect(link.props.rel).toBe("noopener noreferrer");
        expect(link.props["aria-label"]).toBe(banner.labels.link);

        const qr = elements(tree).find(node => node.type === "svg" && node.props.viewBox === "0 0 37 37");
        expect(qr?.props.role).toBe("img");
        expect(qr?.props["aria-label"]).toBe(banner.labels.qr);
        expect(qr?.children.map(child => (child as Node).type)).toEqual(["rect", "path"]);
        expect((qr?.children[1] as Node).props.d).toBe(loaded.helpers.qrPathFromRows(banner.qr.rows));
    });

    it("matches the master stage geometry, preview, and DOM order", () => {
        const css = load(onlineModel()).css;
        expect(css).toContain(".gc-stage");
        expect(css).toMatch(/\.goat--panel \.goat-lockup\s*\{[^}]*--gc-content-scale:\s*1\.05;/s);
        expect(css).toMatch(/\.goat--settings \.goat-lockup\s*\{[^}]*--gc-content-scale:\s*1\.06;/s);
        expect(css).toMatch(/--gc-qr-zoom:\s*1;/);
        expect(css).toMatch(/\.goat--panel \.gc-iphone\s*\{[^}]*--gc-iphone-h:\s*50px;/s);
        expect(css).toMatch(/\.goat--panel \.gc-qr\s*\{[^}]*--gc-qr-x:\s*var\(--gc-panel-qr-x\)/s);
        expect(css).toMatch(/text-transform:\s*none/);
        expect(css).toMatch(/--gc-scrim:\s*radial-gradient\(ellipse 58% 62%/);
        expect(css).not.toContain("!important");

        const loaded = load(onlineModel());
        expect(createHash("sha256").update(iphonePreviewDataUrl(loaded.source), "utf8").digest("hex")).toBe(MAPS_IPHONE_PREVIEW_SHA256);
        for (const variant of ["panel", "settings"] as const) {
            const tree = loaded.render(variant);
            const link = anchor(tree);
            const stage = firstClass(tree, "gc-stage");
            const word = firstClass(tree, "goat-lockup__word");
            const badge = firstClass(tree, "gc-badge");
            const iphone = firstClass(tree, "gc-iphone");
            const screen = firstClass(tree, "gc-iphone__screen");
            const qr = firstClass(tree, "gc-qr");
            const vf = firstClass(tree, "gc-vf");

            expect(iphone.props["aria-hidden"]).toBe("true");
            expect(screen.props.src).toBe(iphonePreviewDataUrl(loaded.source));
            expect(stage.children).toEqual([badge, word, iphone, qr]);
            expect(link.children.indexOf(vf)).toBeLessThan(link.children.indexOf(stage));
        }
    });

    it("uses signed effects and positions instead of drawing hidden static features", () => {
        const noEffects = { ...valid, effects: { viewfinder: false, steam: false }, badge: "" };
        const tree = load(onlineModel(noEffects)).render("panel");
        expect(byClass(tree, "gc-vf")).toHaveLength(0);
        expect(byClass(tree, "gc-steam")).toHaveLength(0);
        expect(byClass(tree, "gc-osd")).toHaveLength(0);

        const image = elements(tree).find(node => node.type === "img");
        expect(image?.props.src).toBe(photoDataUrl);
        const word = firstClass(tree, "goat-lockup__word");
        expect(word.props.style).toBeUndefined();
    });

    it("passes anchor events to the shared banner controls without preventing navigation", () => {
        const loaded = load(onlineModel());
        const link = anchor(loaded.render("panel"));
        link.props.onPointerEnter({});
        link.props.onPointerLeave({});
        link.props.onFocus({});
        link.props.onBlur({});
        link.props.onClick({});
        expect(loaded.events.pointer.mock.calls).toEqual([[true], [false]]);
        expect(loaded.events.focus.mock.calls).toEqual([[true], [false]]);
        expect(loaded.events.click).toHaveBeenCalledTimes(1);
    });

    it("renders data that looks like markup as literal text", () => {
        const tree = load(onlineModel({ ...valid, headline: "<b>x", headlineEm: undefined })).render("panel");
        expect(texts(firstClass(tree, "goat__line")).join("")).toBe("<b>x");
        expect(elements(tree).some(node => node.type === "b")).toBe(false);
    });

    it("marks max-text vector fields for the node-test fitting contract", () => {
        const loaded = load(onlineModel(maxText));
        const tree = loaded.render("panel");
        const expected = (value: string, max: number) => loaded.helpers.fitClass(value, max).split(" ").filter(Boolean);
        expect(classes(firstClass(tree, "goat__line")).slice(2)).toEqual(expected(maxText.headline, 48));
        expect(classes(firstClass(tree, "goat-lockup__name")).slice(1)).toEqual(expected(maxText.wordmark, 12));
        expect(classes(firstClass(tree, "gc-badge__text")).slice(1)).toEqual(expected(maxText.badge, 16));
        const parts = [firstClass(tree, "gc-tag__a"), firstClass(tree, "gc-tag__b")];
        maxText.tagline.forEach((part: string, index: number) => {
            expect(classes(parts[index]).slice(1)).toEqual(expected(part, 18));
        });
        // Pixel fit is intentionally left to the visual gate; node has no layout engine.
    });
});

describe("Goat banner absence detectors", () => {
    it("finds an accidental extra URL in rendered props", () => {
        const patched = load(onlineModel(), source => source.replace("href={banner.link}", 'href="https://cdn.example.com/unexpected.png"'));
        expect(strayUrls(patched)).toContain("panel: https://cdn.example.com/unexpected.png");
    });

    it("keeps HTML injection out of the real component", () => {
        const loaded = load(onlineModel());
        expect(loaded.source).not.toContain("dangerouslySetInnerHTML");
        expect(loaded.css).toContain(".goat--dagoat");
        expect(loaded.css).toContain(".goat--online");
    });
});

describe("module load", () => {
    // Regression for 0.2.17 pre-release: a top-level JSX constant ran
    // Vencord.Webpack.Common.React.createElement while the bundle was still
    // evaluating, before `Vencord` existed, and the whole mod failed to start.
    it("evaluates without calling the JSX factory", () => {
        const compiled = transformSync(SOURCE, {
            loader: "tsx",
            format: "cjs",
            target: "es2022",
            jsx: "transform",
            jsxFactory: "VencordCreateElement",
            jsxFragment: "VencordFragment",
            sourcefile: "goatBanner.tsx"
        }).code;
        const throwingFactory = () => { throw new Error("JSX factory called while the module was loading"); };
        const modules: Record<string, unknown> = {
            "@webpack/common": { React: {} },
            "../banner/coordinator": { bannerEvents: {}, useGoatBannerModel: () => ({ kind: "dagoat" }) }
        };
        const module_ = { exports: {} as any };
        // eslint-disable-next-line no-new-func
        const run = new Function("require", "module", "exports", "VencordCreateElement", "VencordFragment", compiled);
        expect(() => run((id: string) => modules[id], module_, module_.exports, throwingFactory, Symbol("Fragment"))).not.toThrow();
    });
});
