/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED.
 *
 * browser/manifestv2.json documents its own decisions in "_comment"-prefixed keys.
 * They are not decoration: one of them records that the add-on id was changed in
 * v0.2.8 because AMO permanently blocks the GUID of a deleted add-on, and that it
 * must never change again once published because it is how Firefox recognises an
 * update. Another records why strict_min_version is 140.0 rather than 128. Nothing
 * else in this repository holds that knowledge.
 *
 * The build copied them straight into the package, and Firefox validates
 * browser_specific_settings against a schema. Loading dist/extension-firefox.zip in
 * about:debugging printed, verbatim:
 *
 *   Reading manifest: Warning processing
 *   browser_specific_settings.gecko.data_collection_permissions._comment:
 *   An unexpected property was found in the WebExtension manifest.
 *   Reading manifest: Warning processing browser_specific_settings.gecko._comment_id:
 *   An unexpected property was found in the WebExtension manifest.
 *   Reading manifest: Warning processing
 *   browser_specific_settings.gecko._comment_min_version:
 *   An unexpected property was found in the WebExtension manifest.
 *
 * Four documentation keys were shipping; three of them warned. The fourth sits
 * directly under browser_specific_settings rather than inside `gecko` and Mozilla's
 * schema happens not to complain about it. That asymmetry is a fact about their
 * validator, not a rule worth encoding, so the build removes all of them at every
 * depth.
 *
 * WHY IT IS FIXED AT PACKAGE TIME AND NOT IN THE SOURCE. Deleting the comments
 * would silence the warnings and lose the reasons, which is a worse trade than the
 * warnings. So this takes the shape the guide's inline-script extraction already
 * took in scripts/build/buildWeb.mjs: the SOURCE stays self-contained and
 * documented, and the ARTIFACT is what the store validates. Both halves are
 * asserted below, because either one alone is satisfiable by doing the wrong thing
 * - deleting the comments passes a packaged-only check, and never building passes a
 * source-only one.
 *
 * WHY A WHOLE FILE. A manifest warning is not a load failure. The extension
 * installs, runs, and behaves identically; the only symptom is text in
 * about:debugging and in an AMO reviewer's log. Nothing in the build, the test
 * suite or checkExtensionPackages.mjs said a word about it through every release so
 * far, which is precisely the class of defect that needs an explicit assertion
 * rather than a hope that someone reads the output.
 *
 * WHAT RUNS ALWAYS AND WHAT DOES NOT. The detector controls and the SOURCE
 * assertions always run - both manifests are tracked. The PACKAGED assertions are
 * skipped without dist/browser/*-unpacked, i.e. unless the web build has run in
 * this tree. Skipping is stated in the test title rather than being silent, because
 * a suite that quietly checks nothing looks exactly like one that passes.
 *
 * The detector below is a third implementation of the same walk - buildWeb.mjs
 * strips, checkExtensionPackages.mjs reports, this one tests - and that is
 * deliberate rather than wasteful. A shared helper cannot disagree with itself, and
 * this file cannot import either of those scripts anyway: one runs a build on
 * import and the other runs its whole gate at module scope. It carries a positive
 * AND a negative control, because the way a check like this dies is by matching
 * nothing and printing green.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Each source manifest and the package directory buildExtension() writes it into. */
const MANIFESTS = [
    { source: "manifest.json", target: "chromium-unpacked" },
    { source: "manifestv2.json", target: "firefox-unpacked" }
];

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------------------
// The scanners.
// ---------------------------------------------------------------------------

/**
 * Every key path in `value` whose last segment starts with "_comment", written the
 * way Firefox writes it when it warns about one.
 *
 * Recurses through arrays as well as objects. content_scripts and
 * web_accessible_resources are arrays of objects in one manifest shape or the
 * other, so an object-only walk would be blind to a documentation key added inside
 * either - and blind is indistinguishable from clean.
 */
function commentPaths(value: unknown, path = ""): string[] {
    if (Array.isArray(value)) return value.flatMap((element, i) => commentPaths(element, `${path}[${i}]`));
    if (value === null || typeof value !== "object") return [];

    return Object.keys(value).flatMap(key => {
        const here = path === "" ? key : `${path}.${key}`;
        return [
            ...(key.startsWith("_comment") ? [here] : []),
            ...commentPaths((value as Record<string, unknown>)[key], here)
        ];
    });
}

/**
 * A deep copy of `value` with every "_comment"-prefixed key removed.
 *
 * A copy rather than an in-place delete: the fixtures below are reused across
 * tests, and a scanner that quietly ate its own input would make later assertions
 * depend on execution order.
 */
function withoutComments<T>(value: T): T {
    if (Array.isArray(value)) return value.map(element => withoutComments(element)) as unknown as T;
    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !key.startsWith("_comment"))
            .map(([key, element]) => [key, withoutComments(element)])
    ) as T;
}

// ---------------------------------------------------------------------------
// Controls. Both directions, or the packaged assertion below is worthless: a walk
// that returns [] for everything passes it without looking at anything.
// ---------------------------------------------------------------------------

/** Documentation keys at five depths, including inside two different arrays. */
const DOCUMENTED = {
    manifest_version: 2,
    _comment: "at the root",
    browser_specific_settings: {
        _comment: "one level down",
        gecko: {
            _comment_id: "why the id is what it is",
            id: "x@example.test",
            _comment_min_version: "why 140.0",
            strict_min_version: "140.0",
            data_collection_permissions: {
                _comment: "why these three",
                required: ["personalCommunications", "websiteContent", "authenticationInfo"]
            }
        }
    },
    content_scripts: [
        { _comment: "inside an array element", js: ["content.js"] },
        { js: ["other.js"], nested: { deep: [{ _comment_deep: "an array inside an object inside an array" }] } }
    ]
};

/** The same shapes with nothing to find, plus three near misses that must not match. */
const UNDOCUMENTED = {
    manifest_version: 3,
    comment: "no leading underscore, so not a documentation key",
    x_comment: "does not START with _comment",
    description: "a VALUE that merely says _comment is not a key called _comment",
    browser_specific_settings: { gecko: { id: "x@example.test", strict_min_version: "140.0" } },
    content_scripts: [{ js: ["content.js"] }, { js: [] }],
    nothing: null
};

describe("the detector can fail", () => {
    it("finds every documentation key, at every depth, including inside arrays", () => {
        expect(commentPaths(DOCUMENTED)).toEqual([
            "_comment",
            "browser_specific_settings._comment",
            "browser_specific_settings.gecko._comment_id",
            "browser_specific_settings.gecko._comment_min_version",
            "browser_specific_settings.gecko.data_collection_permissions._comment",
            "content_scripts[0]._comment",
            "content_scripts[1].nested.deep[0]._comment_deep"
        ]);
    });

    it("finds none where there are none (negative control)", () => {
        expect(commentPaths(UNDOCUMENTED)).toEqual([]);
        expect(commentPaths({})).toEqual([]);
        expect(commentPaths([])).toEqual([]);
        expect(commentPaths(null)).toEqual([]);
        expect(commentPaths("_comment")).toEqual([]);
    });

    it("strips exactly those keys and nothing else", () => {
        const stripped = withoutComments(DOCUMENTED);

        expect(commentPaths(stripped)).toEqual([]);
        // The settings the comments were explaining have to survive the strip -
        // taking a neighbour with it is the failure mode that would actually break
        // the extension rather than merely warn about it.
        expect(stripped.browser_specific_settings.gecko.id).toBe("x@example.test");
        expect(stripped.browser_specific_settings.gecko.strict_min_version).toBe("140.0");
        expect(stripped.browser_specific_settings.gecko.data_collection_permissions.required)
            .toEqual(["personalCommunications", "websiteContent", "authenticationInfo"]);
        expect(stripped.content_scripts[0]).toEqual({ js: ["content.js"] });
        expect(stripped.content_scripts[1]).toEqual({ js: ["other.js"], nested: { deep: [{}] } });
    });

    it("leaves a comment-free object untouched, and does not mutate its input", () => {
        expect(withoutComments(UNDOCUMENTED)).toEqual(UNDOCUMENTED);
        // DOCUMENTED was passed to withoutComments in the test above. If the strip
        // mutated rather than copied, this would already be empty.
        expect(commentPaths(DOCUMENTED)).toHaveLength(7);
    });
});

// ---------------------------------------------------------------------------
// The source keeps the knowledge.
// ---------------------------------------------------------------------------

describe("browser/manifestv2.json (the source)", () => {
    const source = readJson(join(ROOT, "browser", "manifestv2.json"));
    const { gecko } = source.browser_specific_settings;

    it("still records why the add-on id is what it is, and that it must not change again", () => {
        expect(typeof gecko._comment_id).toBe("string");
        expect(gecko._comment_id).toMatch(/do not change it again/i);
    });

    it("still records why strict_min_version is 140.0", () => {
        expect(typeof gecko._comment_min_version).toBe("string");
        expect(gecko._comment_min_version).toMatch(/140/);
    });

    /*
     * The fix must not be "delete the comments". If this ever drops to zero the
     * packaged assertions below would still pass - silently, and for the wrong
     * reason - while the reasons for the id and the minimum version were gone.
     */
    it("still carries the documentation keys the build is responsible for removing", () => {
        expect(commentPaths(source).length).toBeGreaterThanOrEqual(4);
    });
});

// ---------------------------------------------------------------------------
// The package does not.
// ---------------------------------------------------------------------------

describe.each(MANIFESTS)("the packaged manifest in dist/browser/$target", ({ source, target }) => {
    const packaged = join(ROOT, "dist", "browser", target, "manifest.json");
    const built = existsSync(packaged);
    const itBuilt = built ? it : it.skip;

    it(`is ${built ? "present" : "ABSENT - the assertions below are SKIPPED, run the web build first"}`, () => {
        expect(existsSync(join(ROOT, "browser", source))).toBe(true);
    });

    itBuilt("ships no documentation keys for Firefox to warn about", () => {
        expect(commentPaths(readJson(packaged))).toEqual([]);
    });

    /*
     * ...and the strip changed nothing else. The whole packaged manifest is compared
     * against its source, so a transformation that dropped a permission, reordered a
     * content script or lost web_accessible_resources fails here rather than in
     * somebody's browser. `version` is the one field the build is supposed to add:
     * neither source manifest declares it, buildExtension() stamps it in from
     * package.json, and it is taken from the packaged copy here so this stays a test
     * about the strip rather than a second version test.
     */
    itBuilt("differs from its source only by the version the build stamps in", () => {
        const out = readJson(packaged);
        expect(typeof out.version).toBe("string");
        expect(out).toEqual({ ...withoutComments(readJson(join(ROOT, "browser", source))), version: out.version });
    });
});

describe("the packaged Firefox settings the comments were explaining", () => {
    const packaged = join(ROOT, "dist", "browser", "firefox-unpacked", "manifest.json");
    const itBuilt = existsSync(packaged) ? it : it.skip;

    /*
     * Stated separately from the deep comparison above because these four are the
     * ones with consequences. A missing id makes the add-on unupdatable, a missing
     * strict_min_version lets it install where data_collection_permissions is
     * ignored, and a missing declaration is the thing AMO rejects.
     */
    itBuilt("keeps the id, both minimum versions and the data collection declaration", () => {
        const wanted = readJson(join(ROOT, "browser", "manifestv2.json")).browser_specific_settings;
        const got = readJson(packaged).browser_specific_settings;

        expect(got?.gecko?.id).toBe(wanted.gecko.id);
        expect(got?.gecko?.strict_min_version).toBe(wanted.gecko.strict_min_version);
        expect(got?.gecko?.data_collection_permissions?.required)
            .toEqual(wanted.gecko.data_collection_permissions.required);
        expect(got?.gecko_android?.strict_min_version).toBe(wanted.gecko_android.strict_min_version);
    });
});
