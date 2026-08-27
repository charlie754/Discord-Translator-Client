/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED: ONE SETTING, TWO AUTHORITIES.
 *
 * `appsScriptUrl` is validated on two different screens. The Apps Script section
 * of the client settings tab checks it with checkDeploymentUrl() from
 * core/providers/appsScript.ts, which accepts EITHER the whole Web App URL or the
 * short Deployment ID that Google's Deploy dialog puts a copy button beside. The
 * plugin cog's own box checks it with appsScriptUrlProblem() in settings.ts.
 *
 * That second function used to be an independent parser with its own rules. It
 * did `new URL(value)` and answered a bare Deployment ID with "That is not a
 * URL.", then told the user to go and paste it on the other screen instead — a
 * valid credential, refused, with a detour offered in place of an answer. Two
 * parsers over one setting is a defect that cannot be fixed by making them agree
 * once, because nothing then keeps them agreeing; the fix was to delete one of
 * them, and appsScriptUrlProblem() is now a four-line adapter over the other.
 *
 * SO THE CENTRAL ASSERTION HERE IS A BICONDITIONAL, not a list of examples:
 *
 *     appsScriptUrlProblem(x) === null   ⟺   checkDeploymentUrl(x).ok
 *
 * over a table that includes every refusal shape the provider distinguishes. An
 * example-by-example suite would pass again the moment someone reintroduced a
 * local rule for a case nobody thought to list. This one cannot: it asserts that
 * the two functions return the same verdict, so a rule added to either side
 * without the other fails it.
 *
 * WHY THE ESBUILD HARNESS. settings.ts imports Vencord aliases (@api/Settings,
 * @components/*, @webpack/common, ~git-remote) that do not resolve under vitest,
 * so it cannot simply be imported — the same constraint test/guideTarget.test.ts
 * and test/settingsCopy.test.ts document. It is compiled with esbuild, the
 * compiler the real build uses, and evaluated against a stub map. The one thing
 * NOT stubbed is checkDeploymentUrl itself: core/ resolves fine under vitest, so
 * the REAL provider module is handed in. That is what makes the biconditional a
 * measurement of two live functions rather than of a fake agreeing with itself.
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkDeploymentUrl } from "../src/plugins/channelTranslator/core/providers/appsScript";

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const SETTINGS_PATH = join(PLUGIN, "settings.ts");
const SETTINGS_SOURCE = readFileSync(SETTINGS_PATH, "utf8");

type Problem = (value: string) => string | null;

/**
 * Compile and evaluate the real settings.ts, returning its exported validator.
 *
 * `patchSource` exists for the instrument controls at the bottom of this file:
 * it re-evaluates the module with the delegation deliberately broken, so the
 * assertions above can be shown to FAIL on a bad implementation. Without that,
 * a suite of `expect(...).toBe(null)` proves only that something returned null.
 *
 * Unknown module ids THROW rather than returning a permissive stub, for the
 * reason test/guideTarget.test.ts gives: a catch-all would let this harness keep
 * passing after settings.ts grew an import nobody here had considered.
 */
function loadProblem(patchSource: (s: string) => string = s => s): Problem {
    const source = patchSource(SETTINGS_SOURCE);
    const compiled = transformSync(source, {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "settings.ts"
    }).code;

    // OptionType.SELECT and friends are read while the module body runs, so this
    // has to answer any property; it answers with the property's own name.
    const optionType = new Proxy({}, { get: (_t, key) => String(key) });

    const modules: Record<string, unknown> = {
        "@api/Settings": { definePluginSettings: (def: Record<string, any>) => ({ store: {}, use: () => ({}), def }) },
        "@components/Button": { Button: "Button" },
        "@components/Heading": { Heading: "Heading" },
        "@components/Paragraph": { Paragraph: "Paragraph" },
        "@utils/types": { OptionType: optionType },
        "@utils/web-metadata": { EXTENSION_BASE_URL: undefined },
        "@webpack/common": { React: { createElement: () => null } },
        "~git-remote": { __esModule: true, default: "charlie754/Discord-Translator-Client" },
        // THE REAL PROVIDER MODULE. See the header: this is the whole point.
        "./core/providers/appsScript": { checkDeploymentUrl }
    };

    const require_ = (id: string) => {
        if (!(id in modules)) {
            throw new Error(`settings.ts imported ${JSON.stringify(id)}, which this harness has no stub for.`);
        }
        return modules[id];
    };

    const module_ = { exports: {} as { appsScriptUrlProblem?: Problem; } };
    // eslint-disable-next-line no-new-func
    new Function("require", "module", "exports", "IS_EXTENSION", compiled)(
        require_, module_, module_.exports, false
    );

    const problem = module_.exports.appsScriptUrlProblem;
    if (typeof problem !== "function") {
        throw new Error("settings.ts no longer exports appsScriptUrlProblem()");
    }
    return problem;
}

const appsScriptUrlProblem = loadProblem();

/** A deployment id of the shape Google hands out. Not a real deployment. */
const ID = "AKfycbxTESTdeploymentIDnotreal123456";
const URL_OK = `https://script.google.com/macros/s/${ID}/exec`;

/**
 * Every input shape the provider distinguishes, and what it should be judged as.
 *
 * `accepted` is the EXPECTED verdict, written out by hand rather than computed
 * from checkDeploymentUrl(). If it were computed the biconditional test below
 * would be comparing the provider with itself and would pass for any pair of
 * functions whatsoever, including two broken ones.
 */
const CASES: ReadonlyArray<{ input: string; accepted: boolean; label: string; }> = [
    // The form this whole change exists to accept.
    { input: ID, accepted: true, label: "a bare Deployment ID" },
    { input: `  ${ID}\n`, accepted: true, label: "a bare Deployment ID with surrounding whitespace" },

    // The form that already worked, and must go on working. A regression here
    // breaks every existing install.
    { input: URL_OK, accepted: true, label: "the whole Web App URL" },
    { input: `${URL_OK}?foo=bar#frag`, accepted: true, label: "a Web App URL carrying a query and fragment" },
    {
        input: `https://script.google.com/a/macros/example.com/s/${ID}/exec`,
        accepted: true,
        label: "a Google Workspace Web App URL"
    },

    // Refusals, one per shape checkDeploymentUrl() tells apart.
    { input: `https://script.google.com/macros/s/${ID}/dev`, accepted: false, label: "the /dev URL" },
    {
        input: "https://script.google.com/home/projects/1a2b3c4d5e6f/edit",
        accepted: false,
        label: "the Apps Script editor URL"
    },
    { input: `http://script.google.com/macros/s/${ID}/exec`, accepted: false, label: "an http:// URL" },
    { input: `https://evil.example.com/macros/s/${ID}/exec`, accepted: false, label: "a URL on the wrong host" },
    {
        input: `https://user:pw@script.google.com/macros/s/${ID}/exec`,
        accepted: false,
        label: "a URL carrying embedded credentials"
    },
    { input: `script.google.com/macros/s/${ID}/exec`, accepted: false, label: "the URL with https:// missing" },
    { input: `macros/s/${ID}/exec`, accepted: false, label: "only the tail of the URL" },
    { input: "AKfycbShort", accepted: false, label: "a truncated Deployment ID" },
    { input: "my apps script", accepted: false, label: "a phrase with spaces in it" },
    { input: "https://", accepted: false, label: "a bare scheme" }
];

describe("the cog's validator delegates to the provider's, and cannot drift from it", () => {
    /**
     * 🔴 THE STRONGEST ASSERTION IN THIS FILE.
     *
     * Not "these inputs are accepted" but "these two functions agree". A second
     * parser reintroduced into settings.ts fails this the moment it disagrees
     * with the provider about ANY input in the table, including the ones a future
     * author adds to the table rather than to the implementation.
     */
    it("returns null exactly when checkDeploymentUrl() says ok, for every shape", () => {
        const disagreements = CASES
            .map(({ input, label }) => ({
                label,
                cog: appsScriptUrlProblem(input) === null,
                provider: checkDeploymentUrl(input).ok
            }))
            .filter(row => row.cog !== row.provider);

        expect(
            disagreements,
            "the cog's box and the Apps Script settings row disagree about these values — one " +
            "screen accepts what the other refuses, which is the two-parser defect returning:\n" +
            disagreements.map(d => `  ${d.label}: cog accepts=${d.cog}, provider accepts=${d.provider}`).join("\n")
        ).toEqual([]);
    });

    it("the table it agrees over is the one written here, not one computed from the provider", () => {
        // Guards the test above from the failure mode where `accepted` drifts into
        // being read off checkDeploymentUrl(): then the biconditional compares the
        // provider with itself and holds for any implementation at all.
        for (const { input, accepted, label } of CASES) {
            expect(checkDeploymentUrl(input).ok, `the provider's verdict on ${label} changed`).toBe(accepted);
            expect(appsScriptUrlProblem(input) === null, `the cog's verdict on ${label} changed`).toBe(accepted);
        }
    });

    it("surfaces the provider's refusal verbatim, not a re-wording of it", () => {
        // A paraphrase would be a second copy of the copy, free to drift exactly
        // as the second parser did. Identity is the only version of this that
        // cannot rot.
        for (const { input, accepted, label } of CASES) {
            if (accepted) continue;
            const check = checkDeploymentUrl(input);
            if (check.ok) throw new Error(`table says ${label} is refused but the provider accepts it`);
            expect(appsScriptUrlProblem(input), `the message for ${label} is not the provider's own`)
                .toBe(check.reason);
        }
    });
});

describe("the specific promises the settings screen makes about this box", () => {
    it("accepts a bare Deployment ID — the value Google's copy button gives you", () => {
        expect(appsScriptUrlProblem(ID)).toBeNull();
    });

    it("still accepts the whole Web App URL (negative control)", () => {
        // Without this, "accepts an ID" is satisfied by a validator that accepts
        // everything, and by one that dropped URL support to gain ID support.
        // Every existing install has a URL in this box, and a Workspace account
        // has no other option at all.
        expect(appsScriptUrlProblem(URL_OK)).toBeNull();
        expect(appsScriptUrlProblem(`https://script.google.com/a/macros/example.com/s/${ID}/exec`)).toBeNull();
    });

    it("an empty box is not an error, and neither is a whitespace-only one", () => {
        // THE ONE DELIBERATE DIVERGENCE from checkDeploymentUrl(), asserted rather
        // than excluded. "" is the default value of this setting: every user who
        // has not chosen this provider has it, and painting their cog red for not
        // configuring a provider they are not using would be the bug. The provider
        // quite reasonably calls "" not-ok, because its callers are about to make
        // a request and have nothing to send.
        expect(appsScriptUrlProblem("")).toBeNull();
        expect(appsScriptUrlProblem("   \n\t ")).toBeNull();
        expect(checkDeploymentUrl("").ok, "the divergence this test documents has moved").toBe(false);
    });

    it("refuses the /dev URL, and says which URL to fetch instead", () => {
        const problem = appsScriptUrlProblem(`https://script.google.com/macros/s/${ID}/dev`);
        expect(problem).not.toBeNull();
        expect(problem, "the refusal does not name /dev, so it does not name the actual problem")
            .toContain("/dev");
        expect(problem, "the refusal does not say to use /exec instead").toContain("/exec");
    });

    it("refuses a wrong host, and names the host it got", () => {
        const problem = appsScriptUrlProblem(`https://evil.example.com/macros/s/${ID}/exec`);
        expect(problem).not.toBeNull();
        expect(problem, "the refusal does not name the host that was pasted").toContain("evil.example.com");
        expect(problem, "the refusal does not name the host it requires").toContain("script.google.com");
    });

    it("refuses an http:// URL, and names the scheme problem", () => {
        const problem = appsScriptUrlProblem(`http://script.google.com/macros/s/${ID}/exec`);
        expect(problem).not.toBeNull();
        expect(problem, "the refusal does not mention https").toContain("https://");
        expect(problem, "the refusal does not name the scheme that was pasted").toContain("http://");
    });

    it("refuses a truncated ID rather than accepting a half-copied credential", () => {
        const problem = appsScriptUrlProblem("AKfycbShort");
        expect(problem).not.toBeNull();
        expect(problem, "the refusal does not say the value is too short").toContain("too short");
    });

    it("no refusal quotes the pasted value back", () => {
        // The value is the credential. A reason that echoed it would put it into a
        // settings notice and, from there, into any screenshot of one. The wrong-host
        // case is excluded: it names the HOST, which is the thing being objected to
        // and is not secret.
        const SECRET = "AKfycbSUPERSECRETdeploymentIDvalue999";
        for (const value of [`https://script.google.com/macros/s/${SECRET}/dev`, `${SECRET} ${SECRET}`]) {
            const problem = appsScriptUrlProblem(value);
            expect(problem, "a refusal quoted the credential back at the user").not.toContain(SECRET);
        }
    });

    it("the signpost to the other screen is gone from settings.ts", () => {
        // While this box could not take an ID, its refusal named a screen that
        // could. It takes one now, so that sentence is a false instruction.
        expect(
            SETTINGS_SOURCE,
            "appsScriptUrlProblem() still redirects an ID-holding user to another screen"
        ).not.toContain("If you copied the short Deployment ID instead");
    });

    it("and settings.ts no longer carries a URL parser of its own", () => {
        // The signpost assertion above is satisfied by deleting one sentence. This
        // is the code behind it: the old branch called `new URL()` inside
        // appsScriptUrlProblem() and decided the answer locally.
        const fn = SETTINGS_SOURCE.slice(SETTINGS_SOURCE.indexOf("export function appsScriptUrlProblem"));
        const body = fn.slice(0, fn.indexOf("\n}"));
        expect(body, "appsScriptUrlProblem() parses the value itself again").not.toContain("new URL(");
        expect(body, "appsScriptUrlProblem() no longer delegates").toContain("checkDeploymentUrl(trimmed)");
    });
});

/**
 * INSTRUMENT CONTROLS.
 *
 * Everything above asserts that a correct implementation passes. These assert
 * that an incorrect one FAILS — which is the half that decides whether the tests
 * are measuring anything. Each rebuilds settings.ts with the delegation broken in
 * a specific way and shows the corresponding assertion going red.
 */
describe("the assertions above can fail (instrument controls)", () => {
    /** Replace the delegating body with a fixed return value. */
    const withBody = (body: string) => (src: string) =>
        src.replace("    const shape = checkDeploymentUrl(trimmed);\n    return shape.ok ? null : shape.reason;", body);

    it("the patcher actually patches — an unmatched replacement would fake every control", () => {
        // If the source ever reformats, `withBody` silently becomes a no-op and
        // all three controls below start passing against the REAL implementation,
        // reporting success while measuring nothing.
        const patched = withBody("    return null;")(SETTINGS_SOURCE);
        expect(patched, "withBody() matched nothing — the controls below are vacuous")
            .not.toBe(SETTINGS_SOURCE);
    });

    it("a validator that accepts everything fails the biconditional (negative control)", () => {
        const permissive = loadProblem(withBody("    return null;"));
        const disagreements = CASES.filter(({ input }) =>
            (permissive(input) === null) !== checkDeploymentUrl(input).ok);
        expect(disagreements.length, "an accept-everything validator agreed with the provider").toBeGreaterThan(0);
    });

    it("a validator that refuses everything fails the biconditional (negative control)", () => {
        const hostile = loadProblem(withBody("    return \"no\";"));
        const disagreements = CASES.filter(({ input }) =>
            (hostile(input) === null) !== checkDeploymentUrl(input).ok);
        expect(disagreements.length, "a refuse-everything validator agreed with the provider").toBeGreaterThan(0);
    });

    it("a validator that re-words the refusal fails the verbatim assertion (negative control)", () => {
        // The exact defect the verbatim rule exists to prevent: correct verdicts,
        // second copy of the copy. The biconditional CANNOT catch this one, which
        // is why the verbatim assertion is separate.
        const paraphrased = loadProblem(withBody(
            "    const shape = checkDeploymentUrl(trimmed);\n" +
            "    return shape.ok ? null : \"That is not a URL.\";"
        ));
        const bad = CASES.filter(({ input, accepted }) => {
            if (accepted) return false;
            const check = checkDeploymentUrl(input);
            return !check.ok && paraphrased(input) !== check.reason;
        });
        expect(bad.length, "a paraphrasing validator passed the verbatim assertion").toBeGreaterThan(0);
        // And it still agrees on every VERDICT, proving the two assertions are
        // independent rather than one restating the other.
        const disagreements = CASES.filter(({ input }) =>
            (paraphrased(input) === null) !== checkDeploymentUrl(input).ok);
        expect(disagreements, "the paraphrasing control changed a verdict, so it tests the wrong thing")
            .toEqual([]);
    });

    it("the old second parser fails this suite (positive control)", () => {
        // The implementation that actually shipped, restored verbatim. If the
        // suite cannot tell it from the delegating one, it is measuring nothing —
        // this is the exact defect the file was written for.
        const OLD = [
            "    let url: URL;",
            "    try {",
            "        url = new URL(trimmed);",
            "    } catch {",
            "        return \"That is not a URL. Paste the whole Web App URL, starting with https://.\";",
            "    }",
            "    if (url.protocol !== \"https:\") return \"must start with https\";",
            "    if (url.hostname !== \"script.google.com\") return \"wrong host\";",
            "    if (!url.pathname.endsWith(\"/exec\")) return \"use /exec\";",
            "    return null;"
        ].join("\n");
        const old = loadProblem(withBody(OLD));

        // The headline symptom: a valid Deployment ID, refused.
        expect(old(ID), "the old parser accepted a bare Deployment ID — it did not").not.toBeNull();
        // And therefore the biconditional breaks on exactly that row.
        const disagreements = CASES.filter(({ input }) =>
            (old(input) === null) !== checkDeploymentUrl(input).ok);
        expect(
            disagreements.map(d => d.label),
            "the old second parser agreed with the provider everywhere, so this suite could not " +
            "have caught the defect it was written for"
        ).toContain("a bare Deployment ID");
    });
});
