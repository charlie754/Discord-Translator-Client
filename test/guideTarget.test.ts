/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * src/plugins/channelTranslator/settings.ts renders an "Open the setup guide"
 * button. In the browser-extension build it opens guide.html out of the
 * extension package, which works. In every other build — the desktop mod, the
 * plain web build — it fell through to HOSTED_GUIDE_URL, which was
 * "https://example.invalid/discord-translator/setup-guide". RFC 6761 reserves
 * .invalid so that name can never resolve: the desktop button's only possible
 * outcome was a DNS failure. Measured before the fix, with node's https client:
 * ENOTFOUND.
 *
 * That button is also the TERMINUS of the rate-limit escape route.
 * panel/Panel.tsx's "Rate limited" state opens this settings screen (see
 * test/panelRateLimitEscape.test.ts), and this settings screen offered the
 * guide — so on desktop the entire way out of a rate limit ended at a dead
 * link. Nothing in the build noticed, because a string is a valid string.
 *
 * WHY THIS RUNS THE MODULE INSTEAD OF READING IT.
 *
 * Its sibling suites (settingsCopy, panelRateLimitEscape) scan source TEXT,
 * because settings.ts imports @api/Settings, @components/*, @webpack/common and
 * ~git-remote, none of which resolve under vitest. A text scan is the right
 * tool for asserting on prose, and the wrong one here: the bug was not a
 * spelling, it was what one function RETURNS, and a regex over a source file
 * cannot fail the way a user's click fails.
 *
 * So this suite compiles the real settings.ts with esbuild — the same compiler
 * the real build uses — into CommonJS, and evaluates it with the unresolvable
 * imports replaced by stubs. IS_EXTENSION arrives as a function parameter,
 * shadowing the build-time global; EXTENSION_BASE_URL stays a live property
 * read on a stub module object, exactly as it is a live binding in the real
 * build. Every assertion below is therefore made against a value the shipped
 * code actually produced, not against its source text.
 *
 * The harness is only trustworthy if it can fail, so `describe("harness")`
 * carries a positive and a negative control, and the placeholder assertions are
 * re-run against a deliberately reverted source to prove they catch the
 * original defect.
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SETTINGS_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "settings.ts");
const SETTINGS_SOURCE = readFileSync(SETTINGS_PATH, "utf8");

/** The slug gitRemotePlugin bakes in; the test supplies it rather than shelling out to git. */
const REMOTE = "charlie754/Discord-Translator-Client";

interface GuideTarget {
    url: string;
    kind: "packaged" | "hosted" | "repo";
}

interface SettingsModule {
    HOSTED_GUIDE_URL: string;
    PROJECT_REPO_URL: string;
    guideTarget(): GuideTarget | null;
    guideUrl(): string | null;
    resolveHostedOrRepo(hostedUrl: string, repoUrl: string): GuideTarget | null;
}

interface LoadedModule {
    exports: SettingsModule;
    /** Every module id the compiled file actually required, in order. */
    required: string[];
    /** The definition object handed to definePluginSettings. */
    definition: Record<string, any>;
    /** Every React.createElement call the load and any render made. */
    render(component: unknown): RenderedNode;
}

interface RenderedNode {
    type: unknown;
    props: Record<string, any> | null;
    children: unknown[];
}

interface LoadOptions {
    isExtension?: boolean;
    /** undefined models the window before browser/content.js posts the meta message. */
    extensionBaseUrl?: string;
    gitRemote?: string;
    /** Lets a test mutate the real source to prove an assertion can fail. */
    patchSource?: (source: string) => string;
}

/**
 * Compile and evaluate the real settings.ts.
 *
 * Unknown module ids THROW rather than returning a permissive stub. A
 * catch-all would let this harness keep passing after settings.ts grew an
 * import nobody here had considered — including the settings-UI barrel that
 * would close an import cycle — which is the opposite of what it is for.
 */
function loadSettings(opts: LoadOptions = {}): LoadedModule {
    const {
        isExtension = false,
        extensionBaseUrl,
        gitRemote = REMOTE,
        patchSource = (s: string) => s
    } = opts;

    const source = patchSource(SETTINGS_SOURCE);
    const compiled = transformSync(source, {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "settings.ts"
    }).code;

    const required: string[] = [];
    const created: RenderedNode[] = [];

    const createElement = (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => {
        const node: RenderedNode = { type, props, children };
        created.push(node);
        return node;
    };

    let definition: Record<string, any> = {};

    // OptionType.SELECT and friends are read while the module body runs, so this
    // one has to answer any property. It answers with the property's own name,
    // which keeps the definition object readable in a failure message.
    const optionType = new Proxy({}, { get: (_t, key) => String(key) });

    const modules: Record<string, unknown> = {
        "@api/Settings": {
            definePluginSettings: (def: Record<string, any>) => {
                definition = def;
                return { store: {}, use: () => ({}), def };
            }
        },
        "@components/Button": { Button: "Button" },
        "@components/Heading": { Heading: "Heading" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/types": { OptionType: optionType },
        // A mutable object, because EXTENSION_BASE_URL is a live binding: the
        // real one is assigned when browser/content.js posts the extension
        // origin into the page, long after this module is evaluated.
        "@utils/web-metadata": { EXTENSION_BASE_URL: extensionBaseUrl },
        "@webpack/common": { React: { createElement } },
        // esbuild emits __toESM(require(...)) for a default import; __esModule
        // is what stops it wrapping the string in another object.
        "~git-remote": { __esModule: true, default: gitRemote },
        "./usageSettings": { renderUsageSettings: () => null }
    };

    const require_ = (id: string) => {
        required.push(id);
        if (!(id in modules)) {
            throw new Error(
                `settings.ts imported ${JSON.stringify(id)}, which this harness has no stub for. ` +
                "Add one — and if it is a settings-UI barrel, check for an import cycle first."
            );
        }
        return modules[id];
    };

    const module_ = { exports: {} as SettingsModule };
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "IS_EXTENSION", compiled);
    run(require_, module_, module_.exports, isExtension);

    return {
        exports: module_.exports,
        required,
        definition,
        render(component: unknown) {
            created.length = 0;
            (component as () => unknown)();
            // The outermost element is created last, since its children are
            // evaluated as arguments before the call itself.
            const root = created[created.length - 1];
            if (!root) throw new Error("component rendered nothing");
            return root;
        }
    };
}

/** Every node in a rendered tree, depth-first. */
function flatten(node: RenderedNode): RenderedNode[] {
    const out: RenderedNode[] = [node];
    for (const child of node.children) {
        if (child && typeof child === "object" && "children" in (child as any)) {
            out.push(...flatten(child as RenderedNode));
        }
    }
    return out;
}

/** The text of every string child in a rendered tree, joined. */
function textOf(node: RenderedNode): string {
    return flatten(node)
        .flatMap(n => n.children.filter((c): c is string => typeof c === "string"))
        .join(" ");
}

function buttons(node: RenderedNode): RenderedNode[] {
    return flatten(node).filter(n => n.type === "Button");
}

/**
 * The property the whole suite turns on: is this string something a browser
 * could actually open?
 *
 * Written out here rather than imported from settings.ts on purpose. An
 * assertion that reuses the implementation's own predicate cannot catch that
 * predicate being wrong — it would agree with it by construction.
 */
const RESERVED_TLD = /\.(invalid|test|example|localhost)$/i;
const RESERVED_DOMAIN = /^example\.(com|net|org)$/i;

function assertOpenable(url: string, label: string): void {
    expect(url, `${label}: must not be empty`).not.toBe("");
    expect(url.trim(), `${label}: must not be whitespace`).not.toBe("");
    expect(url, `${label}: must not carry a stringified undefined`).not.toContain("undefined");

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`${label}: ${JSON.stringify(url)} is not an absolute URL`);
    }

    expect(
        ["https:", "chrome-extension:", "moz-extension:"],
        `${label}: unexpected scheme in ${url}`
    ).toContain(parsed.protocol);

    expect(RESERVED_TLD.test(parsed.hostname), `${label}: ${parsed.hostname} can never resolve`)
        .toBe(false);
    expect(RESERVED_DOMAIN.test(parsed.hostname), `${label}: ${parsed.hostname} is a documentation domain`)
        .toBe(false);
}

/** The four shapes settings.ts can be evaluated in, all four of which ship. */
const BUILD_SHAPES: Array<{ label: string; opts: LoadOptions; }> = [
    {
        label: "browser extension, meta message already delivered",
        opts: { isExtension: true, extensionBaseUrl: "chrome-extension://abcdefghijklmnop/" }
    },
    {
        label: "browser extension, settings opened before the meta message lands",
        opts: { isExtension: true, extensionBaseUrl: undefined }
    },
    {
        label: "desktop mod",
        opts: { isExtension: false }
    },
    {
        label: "plain web build",
        opts: { isExtension: false, extensionBaseUrl: undefined }
    }
];

describe("harness", () => {
    it("evaluates the real settings.ts and exposes its guide exports (positive control)", () => {
        const mod = loadSettings();

        // If this ever passes vacuously the whole file is worthless, so it
        // checks the shape of what it loaded rather than merely that it loaded.
        expect(typeof mod.exports.guideTarget).toBe("function");
        expect(typeof mod.exports.guideUrl).toBe("function");
        expect(typeof mod.exports.resolveHostedOrRepo).toBe("function");
        expect(typeof mod.exports.HOSTED_GUIDE_URL).toBe("string");
        expect(Object.keys(mod.definition)).toContain("credentials");
    });

    it("refuses an import it has no stub for (negative control)", () => {
        // A SIDE-EFFECT import, because esbuild drops an imported binding that
        // is never referenced — the first draft of this control used
        // `import { openPluginModal } from ...` and passed vacuously, since the
        // require() it was meant to trigger had been compiled away.
        expect(() => loadSettings({
            patchSource: src => `import "@components/settings";\n${src}`
        })).toThrow(/@components\/settings/);
    });

    it("really re-reads the source it is given (negative control)", () => {
        const mod = loadSettings({
            patchSource: src => src.replace(
                'export const HOSTED_GUIDE_URL = "";',
                'export const HOSTED_GUIDE_URL = "https://guide.example.test/x";'
            )
        });
        expect(mod.exports.HOSTED_GUIDE_URL).toBe("https://guide.example.test/x");
    });
});

describe("the guide target is never empty or a placeholder", () => {
    for (const { label, opts } of BUILD_SHAPES) {
        it(`${label}: guideUrl() is either null or openable, never ""`, () => {
            const url = loadSettings(opts).exports.guideUrl();

            // null is the supported "nothing to open" answer. "" is not: it is a
            // string a caller can hand to window.open by accident.
            expect(url === null || typeof url === "string").toBe(true);
            if (url === null) return;
            assertOpenable(url, label);
        });

        it(`${label}: guideTarget() agrees with guideUrl()`, () => {
            const mod = loadSettings(opts).exports;
            const target = mod.guideTarget();
            expect(target?.url ?? null).toBe(mod.guideUrl());
            if (target) expect(["packaged", "hosted", "repo"]).toContain(target.kind);
        });
    }

    it("no build shape can reach a .invalid host — the exact pre-fix defect", () => {
        for (const { label, opts } of BUILD_SHAPES) {
            const url = loadSettings(opts).exports.guideUrl();
            expect(url ?? "", label).not.toMatch(/\.invalid/i);
        }
    });

    it("catches the pre-fix value if it is ever restored (mutation control)", () => {
        const reverted = loadSettings({
            isExtension: false,
            patchSource: src => src.replace(
                'export const HOSTED_GUIDE_URL = "";',
                'export const HOSTED_GUIDE_URL = "https://example.invalid/discord-translator/setup-guide";'
            )
        });

        // The guard in usableHttpsUrl rejects it, so the button falls through to
        // the project page rather than shipping the dead link a second time.
        expect(reverted.exports.HOSTED_GUIDE_URL).toContain("example.invalid");
        expect(reverted.exports.guideTarget()?.kind).toBe("repo");
        expect(reverted.exports.guideUrl()).not.toMatch(/\.invalid/i);
    });
});

describe("the shipped constants", () => {
    it("HOSTED_GUIDE_URL is unset, or set to something openable — never a placeholder", () => {
        const value = loadSettings().exports.HOSTED_GUIDE_URL;
        if (value.trim() === "") return; // the operator has not pointed it anywhere yet
        assertOpenable(value, "HOSTED_GUIDE_URL");
    });

    it("PROJECT_REPO_URL is built from the ~git-remote slug, not typed in", () => {
        const mod = loadSettings({ gitRemote: "someone/some-fork" }).exports;
        expect(mod.PROJECT_REPO_URL).toBe("https://github.com/someone/some-fork");
    });

    it('PROJECT_REPO_URL is "" rather than a bare host when the build has no remote', () => {
        // gitRemotePlugin yields "" when `git remote get-url origin` fails and
        // DISCORD_TRANSLATOR_REMOTE is unset. "https://github.com/" would be a
        // button that opens GitHub's front page for no reason.
        const mod = loadSettings({ gitRemote: "" }).exports;
        expect(mod.PROJECT_REPO_URL).toBe("");
    });
});

describe("resolveHostedOrRepo", () => {
    const load = () => loadSettings().exports.resolveHostedOrRepo;

    it("prefers a real hosted guide over the project page", () => {
        expect(load()("https://guide.example-host.dev/setup", "https://github.com/a/b"))
            .toEqual({ url: "https://guide.example-host.dev/setup", kind: "hosted" });
    });

    it("falls back to the project page when nothing is hosted", () => {
        expect(load()("", "https://github.com/a/b"))
            .toEqual({ url: "https://github.com/a/b", kind: "repo" });
    });

    it("returns null when neither exists, so the caller can hide the control", () => {
        expect(load()("", "")).toBeNull();
    });

    for (const junk of [
        "",
        "   ",
        "TODO",
        "coming soon",
        "github.com/a/b",
        "http://guide.somewhere.dev/setup",
        "https://example.invalid/setup",
        "https://guide.test/setup",
        "https://example.com/setup",
        "https://localhost/setup"
    ]) {
        it(`treats ${JSON.stringify(junk)} as no hosted guide at all`, () => {
            expect(load()(junk, "https://github.com/a/b")?.kind).toBe("repo");
            expect(load()(junk, "")).toBeNull();
        });
    }
});

describe("the extension path is untouched", () => {
    it("opens guide.html from the extension origin", () => {
        const mod = loadSettings({
            isExtension: true,
            extensionBaseUrl: "chrome-extension://abcdefghijklmnop/"
        }).exports;

        expect(mod.guideTarget()).toEqual({
            url: "chrome-extension://abcdefghijklmnop/guide.html",
            kind: "packaged"
        });
    });

    it("does not build \"undefinedguide.html\" before the meta message arrives", () => {
        const mod = loadSettings({ isExtension: true, extensionBaseUrl: undefined }).exports;
        expect(mod.guideUrl() ?? "").not.toContain("undefined");
        expect(mod.guideTarget()?.kind).not.toBe("packaged");
    });
});

describe("the rendered credentials section", () => {
    function renderCredentials(opts: LoadOptions) {
        const mod = loadSettings(opts);
        const component = mod.definition.credentials.component;
        // definePluginSettings holds `() => React.createElement(CredentialsSection)`,
        // so one call yields the element whose type IS the component.
        const element = component() as RenderedNode;
        return mod.render(element.type);
    }

    it("renders exactly one button, labelled for where it actually goes", () => {
        const tree = renderCredentials({ isExtension: false, gitRemote: REMOTE });
        const found = buttons(tree);

        expect(found).toHaveLength(1);
        expect(found[0].children).toEqual(["Open the project page on GitHub"]);
        expect(typeof found[0].props?.onClick).toBe("function");
        expect(textOf(tree)).toContain("site/free/index.html");
    });

    it("calls the guide the guide when it really is the guide", () => {
        const tree = renderCredentials({
            isExtension: true,
            extensionBaseUrl: "chrome-extension://abcdefghijklmnop/"
        });
        expect(buttons(tree)[0].children).toEqual(["Open the setup guide"]);
    });

    it("renders NO button when nothing is reachable, and says where the guide is instead", () => {
        // Neither a hosted copy nor an origin remote: the state in which the old
        // code still drew a button that could only fail.
        const tree = renderCredentials({ isExtension: false, gitRemote: "" });

        expect(buttons(tree)).toHaveLength(0);
        expect(textOf(tree)).toContain("site/free/index.html");
        expect(textOf(tree)).toContain("not reachable from this build");
    });
});

describe("import hygiene", () => {
    it("does not import the settings-UI barrel, so it closes no cycle", () => {
        // panel/Panel.tsx imports @components/settings, whose ./tabs re-export
        // reaches ~plugins and therefore back to this plugin. settings.ts is a
        // leaf and must stay one: it is imported BY Panel.tsx.
        const { required } = loadSettings();
        expect(required).not.toContain("@components/settings");
        expect(required.filter(id => id.startsWith("@components/")).sort())
            .toEqual(["@components/Button", "@components/Heading", "@components/Paragraph"]);
    });

    it("pulls the repo slug from ~git-remote rather than hardcoding a URL", () => {
        expect(loadSettings().required).toContain("~git-remote");
    });
});
