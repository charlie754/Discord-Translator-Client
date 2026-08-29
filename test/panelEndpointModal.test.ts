/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * When the translator is rate limited the panel offers "Use your own free
 * endpoint". That button used to call openPluginModal() on this plugin's own
 * registry entry — the whole cog: target language, display mode, the DM switch,
 * the credential section and four hidden bookkeeping strings. A user who pressed
 * a button about a rate limit was dropped into a screen they had not asked for
 * and left to find the two controls that answer it.
 *
 * Operator, verbatim: "once it hit Rate Limit, user click Use your own free
 * endpoint-> pop-up a window ONLY SHOW Provider -> \"Google Default Public Key\"
 * and \"Google Free API\" and provide a fill box for user put Client ID/URL into
 * it(must have grey hints inside fill box), once user choose Google Free API,
 * show -> Setup Guide."
 *
 * THAT QUOTE IS LEFT EXACTLY AS IT WAS SAID, and one of the two names inside it
 * has since changed. "Google Default Public Key" is now "Google (free, shared)"
 * — a later operator decision, because the old name claimed a key that path has
 * never used. Editing words inside a block labelled "verbatim" would destroy the
 * only record of what was actually asked for, so the quote stands unaltered and
 * the CURRENT names live in exactly one place: PROVIDER_OPTIONS in settings.ts,
 * which this file loads rather than copies. OPERATOR_PROVIDER_LABELS below is
 * the one place this suite spells them, and the test that compares the two is
 * what would catch the next rename landing in only one of them.
 *
 * So the window has THREE controls and no fourth, and each of the three carries
 * a claim that nothing else in the suite can check:
 *
 *   1. The provider control offers EXACTLY TWO options, under exactly those two
 *      names. A third entry, or a reworded one, is a defect.
 *   2. The endpoint box carries a placeholder — the "grey hints inside fill
 *      box" — and it must name BOTH shapes the validator accepts, because
 *      checkDeploymentUrl() takes a bare Deployment ID as well as a full URL.
 *   3. "Setup Guide" is rendered ONLY when the provider is "Google Free API".
 *      The other provider needs no account, no key and no deployment, so a
 *      setup guide beside it is a control answering a question nobody asked.
 *
 * ── WHY THIS FILE RUNS THE MODULE INSTEAD OF READING IT ──────────────────────
 *
 * Its sibling test/panelRateLimitEscape.test.ts scans source TEXT, and says why:
 * panel/*.tsx resolves @webpack/common, which exists only inside the Vencord
 * build. A text scan is the right instrument for "is the button inside the
 * degraded guard" and the wrong one for every claim above — "exactly two
 * options" and "the link is absent on the other provider" are statements about
 * what a render PRODUCES, and a regex over a source file cannot fail the way a
 * user's click fails.
 *
 * So this suite compiles the real EndpointModal.tsx with esbuild, using the same
 * JSX settings the real build uses (scripts/build/common.mjs: jsx "transform",
 * factory VencordCreateElement), and evaluates it with only the unresolvable
 * modules stubbed. The factory is a recorder rather than React, so the tree is
 * inspectable; a plain factory does not invoke a function component, so the
 * component's body is called explicitly and visibly in renderEndpointModal().
 *
 * TWO THINGS ARE DELIBERATELY NOT STUBBED. PROVIDER_OPTIONS and
 * appsScriptUrlProblem() are loaded out of the REAL settings.ts — the same way
 * test/providerMigration.test.ts loads it — so no provider name and no refusal
 * string in this file is a second copy of one in the source. A hand-written copy
 * of the two labels here would agree with a renamed dropdown by construction and
 * measure nothing.
 *
 * Every assertion that pins an ABSENCE has a control that makes the same query
 * find something, because "no Setup Guide link was found" is exactly what a
 * broken query returns too.
 */

import { transformSync } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The REAL validator, handed to the real settings.ts below. core/ resolves fine
// under vitest, so nothing here is a hand-written stand-in for the authority on
// what a usable Apps Script endpoint is.
import { checkDeploymentUrl } from "../src/plugins/channelTranslator/core/providers/appsScript";

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "src", "plugins", "channelTranslator");
const MODAL_PATH = join(PLUGIN, "panel", "EndpointModal.tsx");
const SETTINGS_PATH = join(PLUGIN, "settings.ts");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

/**
 * The operator's two names, written out once, as the specification of record.
 *
 * The first entry was "Google Default Public Key" when this window was built —
 * the wording quoted verbatim in the header above — and is now
 * "Google (free, shared)". The old name named a key that path has never had: it
 * is the shared public gtx endpoint, no credential of any kind, and "shared" is
 * the property that explains the rate limit THIS WINDOW EXISTS TO ANSWER. Only
 * the label moved; the id behind it is still "google", so nothing a user has on
 * disk changed with it.
 *
 * Written out here rather than read off PROVIDER_OPTIONS on purpose: a test that
 * derives its expectation from the implementation agrees with a rename by
 * construction, and this is the assertion that is supposed to fail when a name
 * changes without the operator asking for it.
 */
const OPERATOR_PROVIDER_LABELS = ["Google (free, shared)", "Google Free API"];

/** The provider id "Google Free API" stands for — core/providers/registry.ts's key. */
const APPS_SCRIPT_ID = "apps-script";

// ───────────────────────────────────────────────────────────────────────────
// The real settings.ts, for the two constants the window is not allowed to copy
// ───────────────────────────────────────────────────────────────────────────

interface SettingsExports {
    PROVIDER_OPTIONS: Array<{ value: string; label: string; default?: boolean; }>;
    DEFAULT_PROVIDER_ID: string;
    appsScriptUrlProblem(value: string): string | null;
}

/**
 * Compile and evaluate the real settings.ts far enough to read its exports.
 *
 * Unknown module ids THROW rather than returning a permissive stub, for the
 * reason test/guideTarget.test.ts gives: a catch-all would let this keep passing
 * after settings.ts grew an import nobody here had considered.
 */
function loadSettings(patchSource: (source: string) => string = s => s): SettingsExports {
    const compiled = transformSync(patchSource(read(SETTINGS_PATH)), {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "settings.ts"
    }).code;

    // OptionType.SELECT and friends are read while the module body runs.
    const optionType = new Proxy({}, { get: (_t, key) => String(key) });

    const modules: Record<string, unknown> = {
        "@api/Settings": {
            definePluginSettings: (def: Record<string, any>) => ({ store: {}, use: () => ({}), def })
        },
        "@components/Button": { Button: "Button" },
        "@components/Heading": { Heading: "Heading" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/types": { OptionType: optionType },
        "@utils/web-metadata": { EXTENSION_BASE_URL: undefined },
        "@webpack/common": { React: { createElement: () => null } },
        "~git-remote": { __esModule: true, default: "charlie754/Discord-Translator-Client" },
        "./core/providers/appsScript": { checkDeploymentUrl }
    };

    const require_ = (id: string) => {
        if (!(id in modules)) {
            throw new Error(
                `settings.ts imported ${JSON.stringify(id)}, which this harness has no stub for.`
            );
        }
        return modules[id];
    };

    const module_ = { exports: {} as SettingsExports };
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "IS_EXTENSION", "VencordNative", compiled);
    run(require_, module_, module_.exports, false, undefined);
    return module_.exports;
}

const REAL = loadSettings();

// ───────────────────────────────────────────────────────────────────────────
// The real EndpointModal.tsx, compiled and rendered
// ───────────────────────────────────────────────────────────────────────────

interface RenderedNode {
    type: unknown;
    props: Record<string, any> | null;
    children: unknown[];
}

interface GuideStub {
    url: string | null;
    kind: string;
}

interface RenderOptions {
    provider?: string;
    appsScriptUrl?: string;
    /** null models a build that carries no copy of the guide and has no hosted address. */
    guide?: GuideStub | null;
    /** Models a Discord build in which the webpack find for openModal failed. */
    openModalThrows?: boolean;
    /** Lets a test mutate the real source to prove an assertion can fail. */
    patchSource?: (source: string) => string;
    /** Overridden only by the "a third option would be seen" control. */
    providerOptions?: SettingsExports["PROVIDER_OPTIONS"];
}

interface Rendered {
    /** null only when openModal threw and no tree was produced. */
    tree: RenderedNode | null;
    /** The settings the window read and wrote — one object, as in the real store. */
    store: { provider: string; appsScriptUrl: string; };
    /** Every settings.store.* assignment the window made, in order. */
    writes: Array<{ key: string; value: unknown; }>;
    /** Every target handed to openGuide(). */
    guideOpens: GuideStub[];
    /** Every console.error the window emitted. */
    errors: unknown[][];
    /** Every module id the compiled file actually required. */
    required: string[];
}

const PACKAGED_GUIDE: GuideStub = { url: "https://extension-origin.invalid/guide.html", kind: "packaged" };

function renderEndpointModal(opts: RenderOptions = {}): Rendered {
    const {
        provider = REAL.DEFAULT_PROVIDER_ID,
        appsScriptUrl = "",
        guide = PACKAGED_GUIDE,
        openModalThrows = false,
        patchSource = (s: string) => s,
        providerOptions = REAL.PROVIDER_OPTIONS
    } = opts;

    const compiled = transformSync(patchSource(read(MODAL_PATH)), {
        loader: "tsx",
        format: "cjs",
        target: "es2022",
        // EXACTLY what scripts/build/common.mjs sets. Compiling with a different
        // factory would be testing a bundle the product never ships.
        jsx: "transform",
        jsxFactory: "VencordCreateElement",
        jsxFragment: "VencordFragment",
        sourcefile: "EndpointModal.tsx"
    }).code;

    const store = { provider, appsScriptUrl };
    const writes: Array<{ key: string; value: unknown; }> = [];
    // A proxy over the SAME object settings.use() hands back, so a write is both
    // recorded and visible to the next read — which is what the real settings
    // store does and what "takes effect immediately" means.
    const storeProxy = new Proxy(store, {
        set(target, key, value) {
            writes.push({ key: String(key), value });
            (target as any)[key] = value;
            return true;
        }
    });

    const guideOpens: GuideStub[] = [];
    const errors: unknown[][] = [];
    const required: string[] = [];
    let renderModal: any = null;

    const VencordCreateElement = (
        type: unknown,
        props: Record<string, any> | null,
        ...children: unknown[]
    ): RenderedNode => ({ type, props, children });

    const modules: Record<string, unknown> = {
        "@webpack/common": {
            Modal: "Modal",
            Select: "Select",
            TextInput: "TextInput",
            // The setter is a no-op: this harness renders once, so `draft` is
            // whatever the store held. Every assertion about typing drives the
            // input's own onChange directly instead of pretending to have a
            // reconciler.
            React: { useState: (initial: unknown) => [initial, () => { }] },
            openModal: (render: (props: any) => RenderedNode) => {
                if (openModalThrows) throw new TypeError("openModal is not a function");
                renderModal = render;
                return "modal-key";
            }
        },
        "../settings": {
            PROVIDER_OPTIONS: providerOptions,
            // The real one. A local re-implementation would agree with the window
            // by construction and could not catch it re-wording a refusal.
            appsScriptUrlProblem: REAL.appsScriptUrlProblem,
            guideTarget: () => guide,
            openGuide: (target: GuideStub) => { guideOpens.push(target); },
            settings: { use: () => store, store: storeProxy }
        }
    };

    const require_ = (id: string) => {
        required.push(id);
        if (!(id in modules)) {
            throw new Error(
                `EndpointModal.tsx imported ${JSON.stringify(id)}, which this harness has no stub ` +
                "for. Add one — and if it is a settings-UI barrel, check for an import cycle first."
            );
        }
        return modules[id];
    };

    const module_ = { exports: {} as { openEndpointModal(): void; } };
    // `console` is passed as a parameter so it shadows the global inside the
    // compiled module: the guard's own error is captured rather than printed,
    // and its absence is assertable.
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "VencordCreateElement", "console", compiled);
    run(require_, module_, module_.exports, VencordCreateElement, {
        ...console,
        error: (...args: unknown[]) => { errors.push(args); }
    });

    // The real opener, called the way the panel's onClick calls it.
    module_.exports.openEndpointModal();

    if (renderModal === null) {
        return { tree: null, store, writes, guideOpens, errors, required };
    }

    const element = renderModal({ transitionState: 0, onClose: () => { } });
    // A plain factory records a function component; it does not run one. The
    // body is therefore invoked here, explicitly, rather than by magic inside
    // the factory — so a reader can see where the render happens.
    const tree = (element.type as (props: any) => RenderedNode)(element.props);

    return { tree, store, writes, guideOpens, errors, required };
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

function nodesOfType(node: RenderedNode, type: string): RenderedNode[] {
    return flatten(node).filter(n => n.type === type);
}

/** The text of every string child in a rendered tree, joined. */
function textOf(node: RenderedNode): string {
    return flatten(node)
        .flatMap(n => n.children.filter((c): c is string => typeof c === "string"))
        .join(" ");
}

function only(node: RenderedNode, type: string): RenderedNode {
    const found = nodesOfType(node, type);
    expect(found, `expected exactly one <${type}> in the window`).toHaveLength(1);
    return found[0];
}

// ───────────────────────────────────────────────────────────────────────────

describe("harness", () => {
    it("the files it claims to read exist and are not empty", () => {
        for (const file of [MODAL_PATH, SETTINGS_PATH]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("compiles and renders the real window (positive control)", () => {
        const { tree, required } = renderEndpointModal();
        expect(tree, "the window rendered nothing").not.toBeNull();
        expect(tree!.type).toBe("Modal");
        // A tree of one node would satisfy most "not found" assertions below.
        expect(flatten(tree!).length).toBeGreaterThan(5);
        expect(required).toContain("@webpack/common");
        expect(required).toContain("../settings");
    });

    it("refuses an import it has no stub for (negative control)", () => {
        // A SIDE-EFFECT import, because esbuild drops an imported binding that is
        // never referenced — a named import would be compiled away and the
        // control would pass vacuously.
        expect(() => renderEndpointModal({
            patchSource: src => `import "@components/settings";\n${src}`
        })).toThrow(/@components\/settings/);
    });

    it("really re-reads the source it is given (negative control)", () => {
        const { tree } = renderEndpointModal({
            patchSource: src => src.replace("AKfycb…", "MUTANT-PLACEHOLDER")
        });
        expect(only(tree!, "TextInput").props!.placeholder).toContain("MUTANT-PLACEHOLDER");
    });

    it("loads the REAL labels, not a copy typed into this file", () => {
        // If loadSettings() silently returned {} every label assertion below
        // would compare undefined with undefined.
        expect(Array.isArray(REAL.PROVIDER_OPTIONS)).toBe(true);
        expect(typeof REAL.appsScriptUrlProblem).toBe("function");
        expect(typeof REAL.DEFAULT_PROVIDER_ID).toBe("string");
    });
});

describe("Provider — exactly two choices, in the operator's own words", () => {
    it("PROVIDER_OPTIONS holds exactly two entries", () => {
        expect(REAL.PROVIDER_OPTIONS).toHaveLength(2);
    });

    it("the two labels are the operator's strings, character for character", () => {
        expect(REAL.PROVIDER_OPTIONS.map(o => o.label)).toEqual(OPERATOR_PROVIDER_LABELS);
    });

    it("the names still map to the provider ids the registry is keyed by", () => {
        // The rename was UI copy only. If an id moved with a label, every user's
        // stored provider would be migrated out from under them.
        expect(REAL.PROVIDER_OPTIONS.map(o => o.value)).toEqual(["google", APPS_SCRIPT_ID]);
        expect(REAL.PROVIDER_OPTIONS.filter(o => o.default).map(o => o.value)).toEqual(["google"]);
        expect(REAL.DEFAULT_PROVIDER_ID).toBe("google");
    });

    it("the window renders one provider control, over PROVIDER_OPTIONS itself", () => {
        const select = only(renderEndpointModal().tree!, "Select");
        // Identity, not equality: a second array with the same contents today is
        // the drift PROVIDER_OPTIONS' own comment warns about.
        expect(select.props!.options).toBe(REAL.PROVIDER_OPTIONS);
    });

    it("that control offers exactly two options and no third", () => {
        const select = only(renderEndpointModal().tree!, "Select");
        expect(select.props!.options).toHaveLength(2);
        expect(select.props!.options.map((o: any) => o.label)).toEqual(OPERATOR_PROVIDER_LABELS);
    });

    /**
     * THE CONTROL FOR THE TWO ASSERTIONS ABOVE.
     *
     * "exactly two" is only a measurement if three would have been seen. A third
     * entry is spliced into the REAL settings.ts source and the same query is run
     * against the window rendered over it.
     */
    it("a third provider option WOULD be seen (negative control)", () => {
        const patched = loadSettings(src => src.replace(
            /(export const PROVIDER_OPTIONS[^=]*=\s*\[)/,
            "$1\n    { label: \"A third provider\", value: \"third-provider\" },"
        ));
        expect(patched.PROVIDER_OPTIONS, "the splice did not apply").toHaveLength(3);

        const select = only(renderEndpointModal({ providerOptions: patched.PROVIDER_OPTIONS }).tree!, "Select");
        expect(select.props!.options).toHaveLength(3);
        expect(select.props!.options.map((o: any) => o.label)).toContain("A third provider");
    });

    it("the current provider is the one shown as selected", () => {
        const select = only(renderEndpointModal({ provider: APPS_SCRIPT_ID }).tree!, "Select");
        expect(select.props!.isSelected(APPS_SCRIPT_ID)).toBe(true);
        expect(select.props!.isSelected("google")).toBe(false);
    });

    it("choosing an option writes the plugin's own settings store", () => {
        const rendered = renderEndpointModal({ provider: "google" });
        only(rendered.tree!, "Select").props!.select(APPS_SCRIPT_ID);

        expect(rendered.writes).toEqual([{ key: "provider", value: APPS_SCRIPT_ID }]);
        // The same object settings.use() handed the render, so the next read of
        // the setting sees it — "takes effect immediately".
        expect(rendered.store.provider).toBe(APPS_SCRIPT_ID);
    });

    it("the control is labelled 'Provider'", () => {
        expect(textOf(renderEndpointModal().tree!)).toContain("Provider");
    });
});

describe("the endpoint box — and its grey hint", () => {
    it("the window renders exactly one text box", () => {
        expect(nodesOfType(renderEndpointModal().tree!, "TextInput")).toHaveLength(1);
    });

    it("it carries a placeholder", () => {
        const placeholder = only(renderEndpointModal().tree!, "TextInput").props!.placeholder;
        expect(typeof placeholder).toBe("string");
        expect(placeholder.length).toBeGreaterThan(10);
    });

    it("the placeholder names BOTH forms the validator accepts", () => {
        // checkDeploymentUrl() takes the bare Deployment ID as well as the whole
        // /macros/s/<id>/exec URL. A hint showing only the URL teaches a user
        // that the ID in their clipboard is the wrong thing.
        const placeholder: string = only(renderEndpointModal().tree!, "TextInput").props!.placeholder;
        expect(placeholder).toContain("Deployment ID");
        expect(placeholder).toContain("script.google.com/macros/s/");
    });

    it("both forms the placeholder advertises really are accepted (control)", () => {
        // Without this the placeholder could promise something the validator
        // refuses, and every assertion above would still be green.
        expect(REAL.appsScriptUrlProblem("AKfycbwFakeDeploymentIdLongEnoughToPass1234567890")).toBeNull();
        expect(REAL.appsScriptUrlProblem(
            "https://script.google.com/macros/s/AKfycbwFakeDeploymentIdLongEnough/exec"
        )).toBeNull();
    });

    it("it is a plain text field and never a password field", () => {
        // Declaring an input a password field on the discord.com origin invites
        // Chromium's password manager to autofill an unrelated credential into
        // it — measured on the settings tab's own row.
        const source = read(MODAL_PATH);
        expect(only(renderEndpointModal().tree!, "TextInput").props!.type).toBe("text");
        expect(source).not.toContain('type="password"');
        expect(source).not.toContain('"password"');
    });

    it("a value the validator accepts is committed to the settings store", () => {
        const rendered = renderEndpointModal();
        const good = "https://script.google.com/macros/s/AKfycbwFakeDeploymentIdLongEnough/exec";
        only(rendered.tree!, "TextInput").props!.onChange(good);

        expect(rendered.writes).toEqual([{ key: "appsScriptUrl", value: good }]);
        expect(rendered.store.appsScriptUrl).toBe(good);
    });

    it("a half-typed value is NOT committed", () => {
        // The screen has no Save button, so the validator is what stands between
        // a truncated paste and the next translation failing against it.
        const rendered = renderEndpointModal();
        only(rendered.tree!, "TextInput").props!.onChange("https://script.google.com/mac");
        expect(rendered.writes).toEqual([]);
        expect(rendered.store.appsScriptUrl).toBe("");
    });

    it("the refusal shown is the shared validator's own wording, not a second one", () => {
        const bad = "https://evil.example.com/macros/s/AKfycb/exec";
        const expected = REAL.appsScriptUrlProblem(bad);
        expect(expected, "the probe value is supposed to be refused").not.toBeNull();

        expect(textOf(renderEndpointModal({ appsScriptUrl: bad }).tree!)).toContain(expected!);
    });

    it("an empty box is not an error", () => {
        // It is the default every user who has never chosen Apps Script has.
        const text = textOf(renderEndpointModal({ appsScriptUrl: "" }).tree!);
        expect(REAL.appsScriptUrlProblem("")).toBeNull();
        expect(text).not.toContain("that is not a web address");
    });
});

describe("Setup Guide — shown only for \"Google Free API\"", () => {
    /** The link, whatever it is labelled: the window's only anchor. */
    const links = (opts: RenderOptions) => nodesOfType(renderEndpointModal(opts).tree!, "a");

    it("is ABSENT on the default provider", () => {
        expect(links({ provider: "google" })).toHaveLength(0);
    });

    it("no Setup Guide wording reaches the default provider's window either", () => {
        // Belt and braces on the assertion above: a link rendered as something
        // other than an <a> would slip past a query for anchors.
        expect(textOf(renderEndpointModal({ provider: "google" }).tree!)).not.toContain("Setup Guide");
    });

    it("is PRESENT on Google Free API", () => {
        const found = links({ provider: APPS_SCRIPT_ID });
        expect(found).toHaveLength(1);
        expect(found[0].children.join("")).toContain("Setup Guide");
    });

    /**
     * THE CONTROL FOR "is ABSENT on the default provider".
     *
     * That assertion passes just as happily when the query is broken, the tree is
     * empty, or the window failed to render at all. Here the provider guard is
     * cut out of the REAL source and the identical query is run: it must now find
     * the link on "google". If this goes red, the absence above proved nothing.
     */
    it("the same query WOULD find the link if the guard were removed (negative control)", () => {
        const drop = (src: string) => {
            const patched = src.replace("store.provider === APPS_SCRIPT_PROVIDER && guide &&", "guide &&");
            expect(patched, "the guard's text moved; this control patches nothing").not.toBe(src);
            return patched;
        };

        const found = links({ provider: "google", patchSource: drop });
        expect(found).toHaveLength(1);
        expect(found[0].children.join("")).toContain("Setup Guide");
    });

    it("clicking it opens the guide through the plugin's one opener", () => {
        const rendered = renderEndpointModal({ provider: APPS_SCRIPT_ID });
        const link = only(rendered.tree!, "a");
        link.props!.onClick();

        // openGuide(target), never a window.open of target.url: the "desktop"
        // kind has no url at all, because the renderer is never told where the
        // bundled file is.
        expect(rendered.guideOpens).toEqual([PACKAGED_GUIDE]);
    });

    it("it opens the target guideTarget() resolved, whichever kind that is", () => {
        for (const kind of ["packaged", "hosted", "repo"]) {
            const guide = { url: `https://${kind}.invalid/guide.html`, kind };
            const rendered = renderEndpointModal({ provider: APPS_SCRIPT_ID, guide });
            only(rendered.tree!, "a").props!.onClick();
            expect(rendered.guideOpens).toEqual([guide]);
        }

        // The desktop build's bundled copy: a target with NO url. A link that
        // pulled `url` out of the target would open `null` here.
        const desktop = { url: null, kind: "desktop" };
        const rendered = renderEndpointModal({ provider: APPS_SCRIPT_ID, guide: desktop });
        only(rendered.tree!, "a").props!.onClick();
        expect(rendered.guideOpens).toEqual([desktop]);
    });

    it("says where it goes, so the one label cannot surprise anyone", () => {
        const link = only(renderEndpointModal({ provider: APPS_SCRIPT_ID, guide: { url: "https://x.invalid/g", kind: "repo" } }).tree!, "a");
        expect(link.props!.title).toContain("GitHub");
        expect(link.props!["aria-label"]).toBe(link.props!.title);
    });

    it("no link at all on a build that can reach no guide", () => {
        // guideTarget() returns null when there is no packaged copy, no bundled
        // copy and no hosted address. A control whose only outcome is a failure
        // is worse than the absence of one.
        expect(links({ provider: APPS_SCRIPT_ID, guide: null })).toHaveLength(0);
    });

    it("does not hardcode a URL or point at the repository", () => {
        const source = read(MODAL_PATH);
        expect(source).not.toContain("github.com");
        expect(source).toContain("openGuide(guide)");
        expect(source).toContain("guideTarget()");
    });
});

describe("nothing else is in this window", () => {
    it("renders one provider control, one text box, and no other control", () => {
        const tree = renderEndpointModal({ provider: APPS_SCRIPT_ID }).tree!;
        expect(nodesOfType(tree, "Select")).toHaveLength(1);
        expect(nodesOfType(tree, "TextInput")).toHaveLength(1);
        expect(nodesOfType(tree, "TextArea")).toHaveLength(0);
        expect(nodesOfType(tree, "Button")).toHaveLength(0);
        expect(nodesOfType(tree, "select")).toHaveLength(0);
        expect(nodesOfType(tree, "input")).toHaveLength(0);
        expect(nodesOfType(tree, "button")).toHaveLength(0);
    });

    it("carries none of the settings the plugin cog is for", () => {
        const text = textOf(renderEndpointModal({ provider: APPS_SCRIPT_ID }).tree!);
        for (const absent of [
            "Target Language", "Replace", "Both Language", "bilingual",
            "direct messages", "Ko-fi", "GitHub"
        ]) {
            expect(text, `the window shows "${absent}"`).not.toContain(absent);
        }
    });

    it("the window is named after the button that opens it", () => {
        // The panel's escape button is aria-labelled "Use your own free
        // endpoint". A window with a different name reads as the wrong window.
        expect(renderEndpointModal().tree!.props!.title).toBe("Use your own free endpoint");
    });
});

describe("the opener may not take the panel down with it", () => {
    it("a failure to open is logged, not thrown", () => {
        // It runs inside the floating panel's own React root: an exception there
        // unmounts the panel, so the user loses the toggle, the language row and
        // the button they just pressed.
        let rendered!: Rendered;
        expect(() => { rendered = renderEndpointModal({ openModalThrows: true }); }).not.toThrow();
        expect(rendered.tree).toBeNull();
        expect(rendered.errors).toHaveLength(1);
        expect(String(rendered.errors[0][0])).toContain("[ChannelTranslator]");
    });

    it("nothing is logged on the ordinary path (control)", () => {
        expect(renderEndpointModal().errors).toEqual([]);
    });
});
