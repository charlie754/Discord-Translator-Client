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
 * THE SECOND DEFECT, AND WHY THIS FILE GREW A FIFTH BUILD SHAPE.
 *
 * Killing the dead link left the desktop build resolving to PROJECT_REPO_URL —
 * https://github.com/<slug>, the whole repository page. Openable, honestly
 * labelled, and still not the guide. Operator: "In desktop version, Setup Guide
 * should always link to a page which dedicated on Setup Guide only, not entire
 * repo page." The desktop build now ships site/free/index.html beside itself
 * (scripts/build/build.mjs) and opens it in a window of its own
 * (src/main/ipcMain.ts), so guideTarget() has a fourth kind — "desktop" — whose
 * url is null, because the renderer is deliberately never told where the file
 * is.
 *
 * `describe("the desktop build opens its own bundled copy, not the repository")`
 * below is the guard on that, and it goes red against the pre-fix source: with
 * no "desktop" branch a desktop client resolves to kind "repo" and a github.com
 * URL, whatever the main process is carrying.
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
 * imports replaced by stubs. IS_EXTENSION and VencordNative arrive as function
 * parameters, shadowing the build-time global and the preload-injected one;
 * EXTENSION_BASE_URL stays a live property read on a stub module object, exactly
 * as it is a live binding in the real build. Every assertion below is therefore
 * made against a value the shipped code actually produced, not against its
 * source text.
 *
 * VencordNative is passed as a PARAMETER rather than assigned onto globalThis so
 * that one test's bridge cannot leak into the next, and so that "this build has
 * no bridge at all" is expressible — `typeof VencordNative` is "undefined" for a
 * parameter that was never given a value, which is the exact shape the shipped
 * code guards against.
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

// THE REAL MODULE, not a hand-written stub of it. settings.ts now imports
// checkDeploymentUrl() because appsScriptUrlProblem() delegates its whole
// judgement to it, and core/ resolves fine under vitest — so this harness hands
// over the genuine article, for the same reason test/providerMigration.test.ts
// hands over the real registry rather than a copy. Nothing in THIS file
// exercises the validator; the entry exists so the tests below are measuring
// guide behaviour instead of a module-resolution failure.
import { checkDeploymentUrl } from "../src/plugins/channelTranslator/core/providers/appsScript";

const SETTINGS_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "settings.ts");
const SETTINGS_SOURCE = readFileSync(SETTINGS_PATH, "utf8");

/** The slug gitRemotePlugin bakes in; the test supplies it rather than shelling out to git. */
const REMOTE = "charlie754/Discord-Translator-Client";

/**
 * Written out here rather than imported from settings.ts, like every other
 * expectation in this file: a test that reuses the implementation's own type
 * agrees with it by construction. `url` is nullable because the "desktop" kind
 * has no address at all.
 */
interface GuideTarget {
    url: string | null;
    kind: "packaged" | "desktop" | "hosted" | "repo";
}

interface SettingsModule {
    HOSTED_GUIDE_URL: string;
    PROJECT_REPO_URL: string;
    guideTarget(): GuideTarget | null;
    openGuide(target: GuideTarget): void;
    resolveHostedOrRepo(hostedUrl: string, repoUrl: string): GuideTarget | null;
}

/**
 * The half of VencordNative that settings.ts reaches for, and a record of what
 * it actually called.
 *
 * A RECORDING STUB RATHER THAN A MOCK LIBRARY, because the questions this suite
 * asks are "was the main process asked at all" and "was it asked for the guide
 * with no arguments" — the second of which is the security property the handler
 * comment in src/main/ipcMain.ts is written about, and which a stub that
 * forgets its arguments could not check.
 */
interface NativeBridgeStub {
    calls: Array<{ name: string; args: unknown[]; }>;
    native: {
        hasSetupGuide(...args: unknown[]): boolean;
        openSetupGuide(...args: unknown[]): Promise<boolean>;
    };
}

function nativeBridge(opts: { bundled: boolean; opens?: boolean; } = { bundled: true }): NativeBridgeStub {
    const calls: NativeBridgeStub["calls"] = [];
    return {
        calls,
        native: {
            hasSetupGuide(...args: unknown[]) {
                calls.push({ name: "hasSetupGuide", args });
                return opts.bundled;
            },
            async openSetupGuide(...args: unknown[]) {
                calls.push({ name: "openSetupGuide", args });
                return opts.opens ?? true;
            }
        }
    };
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
    /**
     * The preload-injected bridge. LEFT UNDEFINED BY DEFAULT ON PURPOSE: that
     * models a build with no main process — the plain web build, and the
     * partial-install case state.ts documents — and it is the shape that would
     * make an unguarded `VencordNative.native.x` throw a ReferenceError out of a
     * render.
     */
    vencordNative?: { native: unknown; };
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
        vencordNative,
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
        "./usageSettings": { renderUsageSettings: () => null },
        // The real one — see the import at the top of this file.
        "./core/providers/appsScript": { checkDeploymentUrl }
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
    const run = new Function("require", "module", "exports", "IS_EXTENSION", "VencordNative", compiled);
    // vencordNative is `undefined` unless a test supplies one, and a parameter
    // holding undefined answers `typeof VencordNative === "undefined"` with true
    // — which is the branch the shipped code takes on a build that has no
    // preload at all.
    run(require_, module_, module_.exports, isExtension, vencordNative);

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
 * Run `body` with console.error replaced by a recorder, and hand back every call
 * it captured.
 *
 * WHY THE LOG IS ASSERTED ON AND NOT JUST THE ABSENCE OF A THROW. openGuide()'s
 * contract has two halves — "NOTHING HERE MAY THROW" and "the missing-bridge
 * case is LOGGED rather than raised" — and a test that only checked
 * `not.toThrow()` would be satisfied by the worst possible reading of it: an
 * empty catch block swallowing the failure in silence does not throw either. A
 * user whose setup guide never opens and whose console says nothing has no way
 * to report what happened, so the reason reaching a log is part of the fix
 * rather than decoration on it.
 *
 * A RECORDER RATHER THAN vi.spyOn, for the reason nativeBridge() above is a
 * recording stub rather than a mock: this suite has no global teardown, so a
 * console.error left patched by a failing assertion would land in whichever test
 * ran next. try/finally restores it on the failure path too.
 *
 * Async because one of the two failure shapes below is a REJECTED PROMISE, whose
 * handler only runs on a later microtask — the patch has to stay in place across
 * the await, or that .catch would log into the real console instead of here.
 */
async function captureConsoleErrors(body: () => void | Promise<void>): Promise<unknown[][]> {
    const captured: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { captured.push(args); };
    try {
        await body();
    } finally {
        console.error = original;
    }
    return captured;
}

/**
 * Drain the microtask queue.
 *
 * openGuide() builds a two-deep chain — `.then(…)` and then `.catch(…)` on the
 * promise that returns — so a rejection reaches the handler two turns after the
 * click, not one. Looping well past that rather than awaiting exactly twice
 * keeps this from becoming a test of the chain's current SHAPE: adding another
 * `.then` to it is not a defect and must not turn this file red.
 */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 16; i++) await Promise.resolve();
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

/**
 * The five shapes settings.ts can be evaluated in, all five of which ship.
 *
 * THE TWO DESKTOP SHAPES ARE BOTH REAL, and conflating them is what the whole
 * bundled-guide branch has to avoid. site/ is untracked, so the same source
 * produces a desktop client that carries the guide (built by someone who has
 * site/free/index.html) and one that does not (CI, a fresh clone) — see the
 * warning scripts/build/build.mjs prints in the second case. The first must open
 * its own copy; the second must fall back and say so.
 */
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
        label: "desktop mod carrying its own bundled copy of the guide",
        opts: { isExtension: false, vencordNative: nativeBridge({ bundled: true }) }
    },
    {
        label: "desktop mod built from a checkout with no site/ directory",
        opts: { isExtension: false, vencordNative: nativeBridge({ bundled: false }) }
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
        // openGuide, not the guideUrl() this line used to name: that accessor was
        // deleted, and the guard that it stays deleted is in the desktop block below.
        expect(typeof mod.exports.openGuide).toBe("function");
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
        it(`${label}: any address guideTarget() offers is openable, never ""`, () => {
            const target = loadSettings(opts).exports.guideTarget();

            // THREE OUTCOMES, NOT TWO, which is the whole reason this no longer
            // reads the address through an accessor that collapsed the first two
            // into a bare null. No target at all is "nothing exists, hide the
            // control". A "desktop" target is "the guide exists and its address is
            // deliberately withheld from the renderer". Anything else must carry a
            // string a browser could really open — "" is never one of the three:
            // it is a value a caller can hand to window.open by accident.
            if (target === null) return;

            if (target.kind === "desktop") {
                expect(target.url, `${label}: a desktop target carries no address`).toBeNull();
                return;
            }

            expect(typeof target.url, `${label}: a web target must carry a string url`).toBe("string");
            assertOpenable(target.url!, label);
        });

        it(`${label}: guideTarget() returns a known kind, and only "desktop" has no address`, () => {
            const target = loadSettings(opts).exports.guideTarget();

            // This test also used to assert that guideUrl() was a faithful
            // projection of guideTarget().url. That accessor is deleted, so there
            // is no second source of truth left to disagree with it — but the
            // property that check was really standing in for is the biconditional
            // below, and that is asserted here as directly as before.
            if (target) expect(["packaged", "desktop", "hosted", "repo"]).toContain(target.kind);
            // The one kind with no address, said as a biconditional so that a
            // web kind cannot quietly acquire a null url and a desktop target
            // cannot quietly acquire a string one.
            if (target) expect(target.url === null).toBe(target.kind === "desktop");
        });
    }

    it("no build shape can reach a .invalid host — the exact pre-fix defect", () => {
        for (const { label, opts } of BUILD_SHAPES) {
            const target = loadSettings(opts).exports.guideTarget();
            expect(target?.url ?? "", label).not.toMatch(/\.invalid/i);
            // The whole target, not only its address: with the url read off the
            // object rather than out of an accessor, a dead host must not survive
            // anywhere in what the caller is handed.
            expect(JSON.stringify(target ?? null), label).not.toMatch(/\.invalid/i);
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
        const target = reverted.exports.guideTarget();

        expect(reverted.exports.HOSTED_GUIDE_URL).toContain("example.invalid");
        expect(target?.kind).toBe("repo");
        // Spelled out rather than written `target?.url ?? ""`, which would let a
        // missing address pass this line by default. A "repo" target must HAVE an
        // address, and the address must not be the reverted one.
        expect(typeof target?.url, "a repo target must carry an address").toBe("string");
        expect(target!.url!).not.toMatch(/\.invalid/i);
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
        const target = mod.guideTarget();

        expect(target?.url ?? "").not.toContain("undefined");
        expect(target?.kind).not.toBe("packaged");
    });

    it("prefers the packaged copy even when the runtime also offers a bundled one", () => {
        // Not a shape that ships — an extension has no main process — but the
        // ORDER is the thing being asserted, and an order is only checked by a
        // case where two branches could both fire. If the desktop branch is ever
        // moved above the extension one, the extension stops opening its own
        // guide.html and this is the only test that would notice.
        const mod = loadSettings({
            isExtension: true,
            extensionBaseUrl: "chrome-extension://abcdefghijklmnop/",
            vencordNative: nativeBridge({ bundled: true })
        }).exports;

        expect(mod.guideTarget()?.kind).toBe("packaged");
    });
});

/*
 * THE FIX FOR THE OPERATOR'S REPORT, PINNED.
 *
 * "In desktop version, Setup Guide should always link to a page which dedicated
 * on Setup Guide only, not entire repo page."
 *
 * Every assertion in this block fails against the pre-fix settings.ts: without a
 * "desktop" branch, a desktop client with the guide sitting in its own bundle
 * still resolves to kind "repo" and https://github.com/<slug>.
 */
describe("the desktop build opens its own bundled copy, not the repository", () => {
    const desktop = () => loadSettings({
        isExtension: false,
        gitRemote: REMOTE,
        vencordNative: nativeBridge({ bundled: true })
    });

    it("resolves to the bundled guide rather than to a github.com repository page", () => {
        const target = desktop().exports.guideTarget();

        expect(target, "a desktop build that carries the guide must offer something").not.toBeNull();
        expect(target!.kind).toBe("desktop");
        // The defect, stated as the user meets it: the control must not open the
        // whole project. Asserted on the host rather than on the kind so it
        // still means something if the kinds are ever renamed.
        expect(target!.url ?? "").not.toMatch(/github\.com/i);
        // This assertion used to be made a second time through guideUrl(). That
        // accessor is gone, so the second reading is made of the WHOLE target
        // instead: no field of what the caller is handed may carry a repository
        // URL, which stays true however the kinds are later renamed.
        expect(JSON.stringify(target)).not.toMatch(/github\.com/i);
    });

    it("hands the renderer no path at all — the main process owns the filename", () => {
        const target = desktop().exports.guideTarget()!;

        expect(target.url).toBeNull();
        // Nothing anywhere in the resolved target may look like a file name: the
        // renderer never learns one, so it can never construct one.
        expect(JSON.stringify(target)).not.toMatch(/guide\.html|\.asar|__dirname/);
    });

    it("exports no address-only accessor, so nothing can read that null as \"no guide\"", () => {
        /*
         * THE DELETED guideUrl(), AND WHY IT MUST NOT COME BACK.
         *
         * It returned `guideTarget()?.url ?? null`, so it answered null for two
         * opposite states: no guide anywhere, and the desktop build's bundled
         * guide, whose url is null by design because the renderer is never told
         * where the file is. A caller that read null as "nothing to open" would
         * therefore hide the control on the one build that certainly HAS a guide
         * — the operator's original report, reintroduced one accessor further out.
         * It was already dead in both shipped bundles when it was removed; the
         * only callers left were in this file.
         *
         * Asserted on the export list rather than by calling it, because calling a
         * function that does not exist throws whether or not the trap is back.
         */
        const exported = Object.keys(desktop().exports);

        expect(exported).not.toContain("guideUrl");
        // The line above is only worth anything against a populated list: a
        // harness that exported nothing at all would satisfy it vacuously.
        expect(exported).toEqual(expect.arrayContaining(["guideTarget", "openGuide"]));
    });

    it("asks the main process, and asks it with no arguments", () => {
        const bridge = nativeBridge({ bundled: true });
        const mod = loadSettings({ isExtension: false, vencordNative: bridge }).exports;

        mod.guideTarget();

        expect(bridge.calls.map(c => c.name)).toContain("hasSetupGuide");
        // A question that carried a parameter would be a question the page world
        // could steer — the posture native.ts's host allow-list is written about.
        for (const call of bridge.calls) expect(call.args).toEqual([]);
    });

    it("openGuide() opens it through the bridge, with no arguments and no window.open", () => {
        const bridge = nativeBridge({ bundled: true });
        const mod = loadSettings({ isExtension: false, vencordNative: bridge }).exports;

        const target = mod.guideTarget()!;
        expect(target.kind).toBe("desktop");

        mod.openGuide(target);

        expect(bridge.calls.map(c => c.name)).toContain("openSetupGuide");
        expect(bridge.calls.find(c => c.name === "openSetupGuide")!.args).toEqual([]);
    });

    it("falls back to the project page when this build shipped without the guide", () => {
        // The genuine last resort, and the reason "repo" is still reachable:
        // site/ is untracked, so a desktop package built from a checkout without
        // it has nothing of its own to open.
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: nativeBridge({ bundled: false })
        }).exports;

        expect(mod.guideTarget()).toEqual({
            url: `https://github.com/${REMOTE}`,
            kind: "repo"
        });
    });

    it("does not throw, and claims nothing, when there is no native bridge at all", () => {
        // browser/VencordNativeStub.ts assigns window.VencordNative before any
        // plugin runs, and src/preload.ts exposes it on the desktop — but a
        // partial install, or a renderer bundle newer than the main bundle, has
        // neither. `VencordNative?.x` would throw a ReferenceError on an
        // undeclared global, and this runs inside a render.
        const mod = loadSettings({ isExtension: false, gitRemote: REMOTE }).exports;

        expect(() => mod.guideTarget()).not.toThrow();
        expect(mod.guideTarget()?.kind).toBe("repo");
    });

    it("survives a bridge whose question throws — sendSync does, with no handler", () => {
        const exploding = {
            native: {
                hasSetupGuide() { throw new Error("No handler registered for 'VencordHasSetupGuide'"); },
                async openSetupGuide() { return false; }
            }
        };
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: exploding
        }).exports;

        expect(() => mod.guideTarget()).not.toThrow();
        expect(mod.guideTarget()?.kind).toBe("repo");
    });

    it("survives a bridge whose openSetupGuide() THROWS synchronously", async () => {
        /*
         * THE HALF OF THE CONTRACT THAT HAD NO TEST UNTIL THIS ONE.
         *
         * The .catch inside openGuide() handles openSetupGuide() REJECTING. It
         * cannot handle it THROWING: an exception raised before the call returns
         * means there is no promise in hand to attach .catch to, so the throw
         * leaves openGuide() entirely and lands in Discord's own onClick handler
         * — inside a React tree this plugin does not own and cannot recover.
         *
         * This is not a hypothetical bridge. The sibling question hasSetupGuide()
         * is already known to throw for real, and the test directly above pins
         * it: VencordNative's sendSync raises outright when the main process has
         * no handler registered for the channel, which is exactly what a renderer
         * bundle newer than the main bundle looks like. There is no reason the
         * COMMAND would fail more politely than the QUESTION on the same missing
         * handler.
         *
         * The try/catch in settings.ts is the whole of what makes this pass — see
         * the mutation control below, which cuts it back out and watches the
         * exception come through.
         */
        const thrown = new Error("No handler registered for 'VencordOpenSetupGuide'");
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: {
                native: {
                    hasSetupGuide: () => true,
                    openSetupGuide(): Promise<boolean> { throw thrown; }
                }
            }
        }).exports;

        // Without this the test could pass on a build that resolved to "repo"
        // and never reached the bridge at all — an assertion satisfied by the
        // code under test not running.
        const target = mod.guideTarget()!;
        expect(target.kind, "the desktop branch must be the one taken").toBe("desktop");

        const errors = await captureConsoleErrors(() => {
            expect(() => mod.openGuide(target)).not.toThrow();
        });

        expect(errors, "the failure was contained but never reported").toHaveLength(1);
        expect(String(errors[0][0])).toContain("The setup guide bridge threw when it was called");
        // The ORIGINAL error, passed through rather than re-worded: what the main
        // process actually said is the only part of this a bug report can act on.
        expect(errors[0]).toContain(thrown);
    });

    it("survives a bridge whose openSetupGuide() returns a REJECTED promise", async () => {
        /*
         * The other failure shape, and it breaks differently enough to need its
         * own test: here a promise DOES exist, so nothing is thrown out of the
         * click and `not.toThrow()` passes whether or not anything handles it.
         * What an unguarded version produces instead is an unhandled rejection
         * some ticks later, attributed to no click at all. The .catch is what
         * answers this one, and the assertion that measures it is the logged
         * reason rather than the absence of an exception.
         */
        const rejection = new Error("the main process refused to open the guide");
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: {
                native: {
                    hasSetupGuide: () => true,
                    openSetupGuide: () => Promise.reject(rejection)
                }
            }
        }).exports;

        const target = mod.guideTarget()!;
        expect(target.kind, "the desktop branch must be the one taken").toBe("desktop");

        const errors = await captureConsoleErrors(async () => {
            expect(() => mod.openGuide(target)).not.toThrow();
            await flushMicrotasks();
        });

        expect(errors, "the rejection was never handled").toHaveLength(1);
        expect(String(errors[0][0])).toContain("Failed to open the setup guide");
        expect(errors[0]).toContain(rejection);
    });

    it("the unguarded source really does throw out of the click (mutation control)", async () => {
        /*
         * What makes the two tests above worth having, in the same shape as the
         * desktop-branch control at the end of this describe.
         *
         * With the try/catch cut out of the REAL source — the state settings.ts
         * was in before it was hardened — the identical exploding bridge sends
         * the exception straight through openGuide() and out to the caller, and
         * logs nothing on the way. If this ever stops throwing, the try/catch is
         * no longer what contains it and the two tests above are passing for some
         * other reason.
         *
         * The patch throws when either anchor is missing rather than quietly
         * doing nothing, because a control that silently stopped patching is a
         * control that always passes.
         */
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: {
                native: {
                    hasSetupGuide: () => true,
                    openSetupGuide(): Promise<boolean> { throw new Error("bridge is not there"); }
                }
            },
            patchSource: source => {
                const opened = source.replace(
                    /\n {8}try \{\r?\n(?= {12}native\.openSetupGuide\(\))/,
                    "\n"
                );
                if (opened === source) throw new Error("the try that guards openSetupGuide() was not found");

                const unguarded = opened.replace(
                    /\r?\n {8}\} catch \(err\) \{\r?\n {12}console\.error\("\[ChannelTranslator\] The setup guide bridge threw when it was called", err\);\r?\n {8}\}/,
                    ""
                );
                if (unguarded === opened) throw new Error("the catch that guards openSetupGuide() was not found");
                return unguarded;
            }
        }).exports;

        const target = mod.guideTarget()!;
        expect(target.kind).toBe("desktop");

        const errors = await captureConsoleErrors(() => {
            expect(() => mod.openGuide(target)).toThrow(/bridge is not there/);
        });

        // And it is silent about it, which is the second half of what the guard
        // fixed: the user got nothing and so did the console.
        expect(errors).toEqual([]);
    });

    it("does not cache a \"no\" produced before the bridge existed", () => {
        // The EXTENSION_BASE_URL lesson, one binding over. A settings screen
        // rendered in the moment before the bridge is installed must not be able
        // to pin "this build has no guide" for the rest of the session.
        const late: { native?: unknown; } = {};
        const mod = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: late as { native: unknown; }
        }).exports;

        expect(mod.guideTarget()?.kind).toBe("repo");

        late.native = nativeBridge({ bundled: true }).native;
        expect(mod.guideTarget()?.kind).toBe("desktop");
    });

    it("does cache a real answer, so a render loop is not a sendSync loop", () => {
        const bridge = nativeBridge({ bundled: true });
        const mod = loadSettings({ isExtension: false, vencordNative: bridge }).exports;

        mod.guideTarget();
        mod.guideTarget();
        mod.guideTarget();

        expect(bridge.calls.filter(c => c.name === "hasSetupGuide")).toHaveLength(1);
    });

    it("the pre-fix source really does open the repository page (mutation control)", () => {
        // The control that makes every assertion above meaningful: with the
        // desktop branch cut out of the real source, the identical build shape
        // lands on github.com. If this ever stops failing that way, the branch
        // is no longer what decides the outcome and the tests above are passing
        // for some other reason.
        const reverted = loadSettings({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: nativeBridge({ bundled: true }),
            patchSource: src => {
                const patched = src.replace(
                    /    if \(bundledGuideAvailable\(\)\) \{\r?\n        return \{ url: null, kind: "desktop" \};\r?\n    \}\r?\n/,
                    ""
                );
                if (patched === src) throw new Error("the desktop branch was not found to remove");
                return patched;
            }
        }).exports;

        expect(reverted.guideTarget()).toEqual({
            url: `https://github.com/${REMOTE}`,
            kind: "repo"
        });
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

    it("calls the desktop build's own bundled copy the guide too, and adds no caveat", () => {
        const tree = renderCredentials({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: nativeBridge({ bundled: true })
        });

        expect(buttons(tree)).toHaveLength(1);
        expect(buttons(tree)[0].children).toEqual(["Open the setup guide"]);
        // The two sentences that were shown on every desktop client before this,
        // both of which described a button that opened the repository page.
        expect(textOf(tree)).not.toContain("opens the project page");
        expect(textOf(tree)).not.toContain("not reachable from this build");
    });

    it("still explains itself on a desktop build that shipped without the guide", () => {
        const tree = renderCredentials({
            isExtension: false,
            gitRemote: REMOTE,
            vencordNative: nativeBridge({ bundled: false })
        });

        expect(buttons(tree)[0].children).toEqual(["Open the project page on GitHub"]);
        expect(textOf(tree)).toContain("site/free/index.html");
        // The correction to the copy: it used to say the extension was the only
        // build that carries the guide, which stopped being true.
        expect(textOf(tree)).toContain("desktop client");
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
