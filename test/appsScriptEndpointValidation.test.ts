/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { build } from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { checkDeploymentUrl } from "../src/plugins/channelTranslator/core/providers/appsScript";

/**
 * validateAppsScriptUrl() in state.ts: can this candidate Apps Script deployment
 * URL actually translate?
 *
 * THE ASSERTION THIS FILE EXISTS FOR is that a malformed candidate cannot reach
 * the transport. checkDeploymentUrl() is local, instant and free, and its refusal
 * prose already names the exact menu path to fix each mistake; a request made
 * before it runs spends one of the deployment's ~5,000 daily calls to learn
 * something that was already known, and makes the user wait for it. Ordering is
 * therefore behaviour, not style.
 *
 * ── WHY THIS FILE BUNDLES INSTEAD OF SCANNING ────────────────────────────────
 *
 * state.ts cannot be imported under vitest: it resolves `@api/MessageUpdater`
 * and `@webpack/common`, aliases that exist only inside the Vencord build.
 * test/providerChokepoint.test.ts and test/panelSettingsOverlap.test.ts
 * record the same constraint and answer it with a SOURCE SCAN.
 *
 * A source scan can show that `checkDeploymentUrl` appears earlier in the file
 * than `provider.translate`. It cannot show that no request was made, and "no
 * request was made" is the claim. So this file does both, and the split is
 * deliberate:
 *
 *   describe("… actually runs …")  bundles state.ts with esbuild, stubbing ONLY
 *                                  the four Vencord-alias modules, and runs the
 *                                  real function against a RECORDING transport.
 *                                  core/ is real — the real checkDeploymentUrl,
 *                                  the real registry, the real meterIfBilled.
 *                                  A call count of 0 is then a measurement.
 *
 *   describe("… the source says …") scans, for the things execution cannot see:
 *                                  that the meter wrapping has the same shape as
 *                                  translationProvider()'s (meterIfBilled is a
 *                                  NO-OP for apps-script by identity, so no
 *                                  behaviour can prove it is there), and that the
 *                                  settings id exists and is hidden.
 *
 * Every matcher below is exercised against text that must match AND text that
 * must not, in the "controls" block at the foot of the file, so a silently
 * broken extractor cannot pass this suite by returning nothing.
 */

const ROOT = process.cwd();
const PLUGIN = join(ROOT, "src", "plugins", "channelTranslator");
const STATE = join(PLUGIN, "state.ts");
const PROVIDER = join(PLUGIN, "provider.ts");
const SETTINGS = join(PLUGIN, "settings.ts");
const PLUGIN_MANAGER = join(ROOT, "src", "api", "PluginManager.ts");
const PLUGIN_MODAL = join(ROOT, "src", "components", "settings", "tabs", "plugins", "PluginModal.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures. The deployment id is the part of the URL that IS the credential —
// anyone holding it can spend the deployment's daily quota — so it is given a
// distinctive value here and asserted absent from every refusal message.
// ───────────────────────────────────────────────────────────────────────────

const DEPLOY_ID = "AKfycbZZTESTDEPLOYMENTIDZZ0123456789";
const URL_OK = `https://script.google.com/macros/s/${DEPLOY_ID}/exec`;

/** A different, also-valid URL, used to prove the STORED one is never consulted. */
const STORED_ID = "AKfycbQQSTOREDNOTTHECANDIDATEQQ98765";
const URL_STORED = `https://script.google.com/macros/s/${STORED_ID}/exec`;

/** Every paste that must be refused locally, i.e. with no request at all. */
const LOCALLY_REFUSED: ReadonlyArray<readonly [string, string]> = [
    ["the Apps Script EDITOR url out of the address bar", `https://script.google.com/home/projects/${DEPLOY_ID}/edit`],
    ["the /dev twin, which only answers its owner", `https://script.google.com/macros/s/${DEPLOY_ID}/dev`],
    ["a url truncated before /exec", `https://script.google.com/macros/s/${DEPLOY_ID}`],
    ["http rather than https", `http://script.google.com/macros/s/${DEPLOY_ID}/exec`],
    ["some other host entirely", `https://evil.example.com/macros/s/${DEPLOY_ID}/exec`],
    ["a url with embedded credentials", `https://user:pw@script.google.com/macros/s/${DEPLOY_ID}/exec`],
    ["not a web address at all", "my apps script"]
];

// ───────────────────────────────────────────────────────────────────────────
// The harness: state.ts, really executed.
// ───────────────────────────────────────────────────────────────────────────

interface Recorded { url: string; init?: { method?: string; body?: string; }; }
interface HttpReply { status: number; body: string; retryAfterMs?: number; }

/** Every request the plugin actually issued, in order. The instrument. */
let calls: Recorded[] = [];

/** What the fake deployment answers. Replaced per test. */
let reply: (url: string, init?: any) => Promise<HttpReply> = async () => {
    throw new Error("no reply configured — a test issued a request it did not expect");
};

/**
 * The settings object the bundle sees. Reached through a global so this file can
 * both seed it and read back what state.ts wrote to it.
 */
interface SettingsStore {
    provider: string;
    appsScriptUrl: string;
    lastGoodAppsScriptUrl: string;
    monthlyCharacterCap: number;
    usageBlob: string;
}
const store: SettingsStore = {
    provider: "apps-script",
    appsScriptUrl: URL_STORED,
    lastGoodAppsScriptUrl: "",
    monthlyCharacterCap: 0,
    usageBlob: ""
};

/**
 * The four modules that do not exist under vitest, and nothing else.
 *
 * `./settings` is stubbed rather than bundled because settings.ts pulls React,
 * @api/Settings and the whole component tree; its VALUES are all this function
 * needs, and the two source-level assertions below check the real file's text.
 * Everything under core/ is left REAL — this suite is worthless if it stubs the
 * validator it is testing the ordering of.
 */
const STUBS: Readonly<Record<string, string>> = {
    "@api/MessageUpdater": "export const updateMessage = () => {};",
    "@webpack/common":
        "export const ChannelStore = { getChannel: () => null };" +
        "export const MessageStore = { getMessages: () => null };",
    "@api/Notices": "export const showNotice = () => {}; export const popNotice = () => {};",
    settings:
        "export const settings = { store: globalThis.__TRANSLATOR_TEST_STORE__ };" +
        "export const usageStore = () => ({" +
        "    load: () => globalThis.__TRANSLATOR_TEST_STORE__.usageBlob," +
        "    save: (json) => { globalThis.__TRANSLATOR_TEST_STORE__.usageBlob = json; }" +
        "});" +
        // PROVIDER_OPTIONS, DEFAULT_PROVIDER_ID and providerName are here only
        // because provider.ts — which state.ts imports — now names them, and
        // esbuild fails the bundle on an import a stub does not export. Nothing
        // in THIS suite reads any of them: they feed
        // migrateUnavailableProvider(), which this file never calls. Their real
        // definitions live in settings.ts and are pinned, against the real file,
        // by test/providerMigration.test.ts and
        // test/pluginNamesLiveControls.test.ts.
        "export const PROVIDER_OPTIONS = [" +
        "    { label: \"Google (free, shared)\", value: \"google\", default: true }," +
        "    { label: \"Google Free API\", value: \"apps-script\" }" +
        "];" +
        "export const DEFAULT_PROVIDER_ID = \"google\";" +
        "export const providerName = id =>" +
        "    (PROVIDER_OPTIONS.find(o => o.value === id) || {}).label || id;"
};

type StateModule = {
    validateAppsScriptUrl(candidateUrl: string): Promise<{ ok: true; } | { ok: false; reason: string; }>;
};

let state: StateModule;
let bundlePath = "";

beforeAll(async () => {
    (globalThis as any).__TRANSLATOR_TEST_STORE__ = store;

    const stubPlugin = {
        name: "vencord-alias-stubs",
        setup(b: any) {
            b.onResolve(
                { filter: /^@api\/MessageUpdater$|^@webpack\/common$|^@api\/Notices$/ },
                (a: any) => ({ path: a.path, namespace: "stub" })
            );
            b.onResolve({ filter: /^\.\/settings$/ }, () => ({ path: "settings", namespace: "stub" }));
            b.onLoad({ filter: /.*/, namespace: "stub" }, (a: any) => ({
                contents: STUBS[a.path],
                loader: "ts"
            }));
        }
    };

    const result = await build({
        entryPoints: [STATE],
        bundle: true,
        format: "esm",
        platform: "node",
        write: false,
        logLevel: "silent",
        plugins: [stubPlugin]
    });

    bundlePath = join(tmpdir(), `channelTranslator-state-${process.pid}-${Date.now()}.mjs`);
    writeFileSync(bundlePath, result.outputFiles[0].text, "utf8");
    state = (await import(pathToFileURL(bundlePath).href)) as StateModule;
}, 120_000);

afterAll(() => {
    if (bundlePath && existsSync(bundlePath)) rmSync(bundlePath, { force: true });
});

/** Install a transport that RECORDS every request and answers with `reply`. */
function installBridge(): void {
    (globalThis as any).VencordNative = {
        pluginHelpers: {
            ChannelTranslator: {
                fetchTranslation: (url: string, init?: any) => {
                    calls.push({ url, init });
                    return reply(url, init);
                }
            }
        }
    };
}

/**
 * A VencordNative with no ChannelTranslator under it — the shape a desktop
 * install whose main process never registered this plugin's native.ts actually
 * has. Assigned rather than deleted, because state.ts reads the bare global
 * identifier and an undeclared one would throw ReferenceError, which is a
 * different failure from the one under test.
 */
function removeBridge(): void {
    (globalThis as any).VencordNative = { pluginHelpers: {} };
}

const okReply = (translations: string[]): HttpReply => ({
    status: 200,
    body: JSON.stringify({ translations })
});

beforeEach(() => {
    calls = [];
    store.provider = "apps-script";
    store.appsScriptUrl = URL_STORED;
    store.lastGoodAppsScriptUrl = "";
    store.monthlyCharacterCap = 0;
    store.usageBlob = "";
    reply = async () => okReply(["vale"]);
    installBridge();
});

describe("validateAppsScriptUrl actually runs, against a recording transport", () => {
    it("the harness is running the real module, not a stub of it", () => {
        expect(typeof state.validateAppsScriptUrl).toBe("function");
    });

    // ───────────────────────────────────────────────────────────────────────
    // (a) nothing pasted
    // ───────────────────────────────────────────────────────────────────────

    it("an empty candidate is refused with no request at all", async () => {
        const result = await state.validateAppsScriptUrl("");
        expect(result.ok).toBe(false);
        expect(calls).toEqual([]);
    });

    it("a whitespace-only candidate is refused with no request at all", async () => {
        const result = await state.validateAppsScriptUrl("   \t\r\n  ");
        expect(result.ok).toBe(false);
        expect(calls).toEqual([]);
    });

    it("the empty refusal tells the user where to get the URL", async () => {
        const result = await state.validateAppsScriptUrl("");
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toMatch(/Manage deployments/i);
        expect(result.reason).toMatch(/\/exec/);
    });

    // ───────────────────────────────────────────────────────────────────────
    // (b) THE ASSERTION THAT MATTERS. Local shape check before any network.
    // ───────────────────────────────────────────────────────────────────────

    it.each(LOCALLY_REFUSED)(
        "%s is refused locally — the transport is never reached",
        async (_label, candidate) => {
            const result = await state.validateAppsScriptUrl(candidate);
            expect(result.ok).toBe(false);
            expect(
                calls,
                "checkDeploymentUrl() must run BEFORE the request. A refusal that costs a round " +
                "trip also costs one of the deployment's ~5,000 daily calls."
            ).toEqual([]);
        }
    );

    /**
     * WHAT THE CALL COUNT ABOVE DOES **NOT** PROVE, said plainly because the
     * first draft of this file did not know it.
     *
     * createAppsScriptProvider().translate() in core/providers/appsScript.ts
     * calls checkDeploymentUrl() on its own configured URL and throws before it
     * touches the transport (appsScript.ts:339). So a build of state.ts that had
     * NO local check at all would still record zero requests for a malformed
     * candidate: the count is guaranteed twice over, and therefore discriminates
     * nothing on its own. It is asserted anyway because it is the user-facing
     * claim, but it is not the evidence.
     *
     * THIS is the evidence. When state.ts answers locally, the reason is
     * checkDeploymentUrl()'s own string, character for character. When the
     * provider answers instead, appsScript.ts prefixes it with "apps-script: ".
     * Deleting the local check therefore changes this assertion and nothing else
     * would — which is exactly the mutation this file has to survive.
     */
    it.each(LOCALLY_REFUSED)(
        "%s is answered by state.ts itself, not by a provider throw",
        async (_label, candidate) => {
            const local = checkDeploymentUrl(candidate);
            expect(local.ok, "fixture is not actually refused by the local check").toBe(false);
            if (local.ok) return;

            const result = await state.validateAppsScriptUrl(candidate);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.reason).toBe(local.reason);
            expect(
                result.reason,
                "the \"apps-script: \" prefix means the provider answered, i.e. the local check " +
                "was skipped and construction happened before the URL was known to be usable"
            ).not.toContain("apps-script:");
        }
    );

    /**
     * THE CONTROL THAT MAKES THE SEVEN ABOVE MEAN ANYTHING, and the reason it is
     * one test rather than two: the same `calls` array, the same transport, the
     * same module, within one function body. A recorder that had silently stopped
     * recording would make the first half pass and the second half fail.
     */
    it("the same instrument records 0 for a malformed URL and 1 for a good one", async () => {
        const refused = await state.validateAppsScriptUrl(`https://script.google.com/macros/s/${DEPLOY_ID}/dev`);
        expect(refused.ok).toBe(false);
        expect(calls.length, "a malformed URL reached the transport").toBe(0);

        const accepted = await state.validateAppsScriptUrl(URL_OK);
        expect(accepted.ok).toBe(true);
        expect(calls.length, "the recorder is not recording — every 0 above is meaningless").toBe(1);
    });

    it("reuses checkDeploymentUrl's own prose rather than inventing a second wording", async () => {
        const editor = await state.validateAppsScriptUrl(`https://script.google.com/home/projects/${DEPLOY_ID}/edit`);
        expect(editor.ok).toBe(false);
        if (editor.ok) return;
        // The one sentence a user cannot work out for themselves: this is a
        // different page of the same product, not a typo.
        expect(editor.reason).toMatch(/EDITOR/);
        expect(editor.reason).toMatch(/Manage deployments/);

        const dev = await state.validateAppsScriptUrl(`https://script.google.com/macros/s/${DEPLOY_ID}/dev`);
        expect(dev.ok).toBe(false);
        if (dev.ok) return;
        expect(dev.reason).toMatch(/\/dev/);
    });

    // ───────────────────────────────────────────────────────────────────────
    // (i) the URL is the credential
    // ───────────────────────────────────────────────────────────────────────

    it("no refusal ever quotes the deployment id or the whole URL", async () => {
        const candidates = [
            "",
            "   ",
            ...LOCALLY_REFUSED.map(([, url]) => url)
        ];
        for (const candidate of candidates) {
            const result = await state.validateAppsScriptUrl(candidate);
            expect(result.ok).toBe(false);
            if (result.ok) continue;
            expect(result.reason, `the deployment id leaked for: ${candidate.slice(0, 40)}`)
                .not.toContain(DEPLOY_ID);
            expect(result.reason).not.toContain(candidate.trim() || " never");
        }
    });

    it("a failing probe does not quote the URL back either", async () => {
        reply = async () => ({ status: 401, body: "" });
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).not.toContain(DEPLOY_ID);
        expect(result.reason).not.toContain(URL_OK);
        // …and it still explains the actual cause.
        expect(result.reason).toMatch(/Who has access/);
    });

    // ───────────────────────────────────────────────────────────────────────
    // (c) resolved against the CANDIDATE, never the stored URL
    // ───────────────────────────────────────────────────────────────────────

    it("probes the candidate, not the URL already in settings", async () => {
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(URL_OK);
        expect(calls[0].url).not.toContain(STORED_ID);
        // …and the stored URL is not disturbed by checking a different one.
        expect(store.appsScriptUrl).toBe(URL_STORED);
    });

    it("sends the URL checkDeploymentUrl rebuilt — query and fragment dropped", async () => {
        const result = await state.validateAppsScriptUrl(`  ${URL_OK}?token=leak#frag  `);
        expect(result.ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(URL_OK);
        expect(calls[0].url).not.toContain("token=leak");
        expect(calls[0].url).not.toContain("#frag");
    });

    // ───────────────────────────────────────────────────────────────────────
    // (e) the smallest honest request
    // ───────────────────────────────────────────────────────────────────────

    it("the probe is one real translate POST carrying one two-letter word", async () => {
        await state.validateAppsScriptUrl(URL_OK);
        expect(calls).toHaveLength(1);
        expect(calls[0].init?.method).toBe("POST");
        const body = JSON.parse(String(calls[0].init?.body));
        expect(body.q).toEqual(["ok"]);
        expect(body.target).toBe("es");
        expect(body.source).toBe("en");
        expect(String(calls[0].init?.body).length).toBeLessThan(120);
    });

    it("one check is one call — it does not retry into the daily allowance", async () => {
        reply = async () => ({ status: 500, body: "" });
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        expect(calls, "a verification that retries spends several of the ~5,000 daily calls")
            .toHaveLength(1);
    });

    // ───────────────────────────────────────────────────────────────────────
    // (f) success and failure translation
    // ───────────────────────────────────────────────────────────────────────

    it("a deployment that answers with a translation is ok, and carries nothing else", async () => {
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result).toEqual({ ok: true });
    });

    it("a sign-in page at HTTP 200 is reported as an access problem, not as bad JSON", async () => {
        reply = async () => ({ status: 200, body: "<!doctype html><html><body>Sign in</body></html>" });
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toMatch(/Who has access/);
    });

    it("a spent daily quota says it is not a bill", async () => {
        reply = async () => ({
            status: 200,
            body: JSON.stringify({ error: "Service invoked too many times for one day: translate." })
        });
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toMatch(/5,000/);
        expect(result.reason).toMatch(/no billing at all/);
    });

    it("a non-Error throw does not become an empty reason", async () => {
        reply = () => Promise.reject("");
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.trim().length).toBeGreaterThan(0);
        expect(result.reason).toMatch(/no reason/i);
    });

    it("a thrown object with no message does not become an empty reason", async () => {
        reply = () => Promise.reject({ notAnError: true } as any);
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason.trim().length).toBeGreaterThan(0);
    });

    // ───────────────────────────────────────────────────────────────────────
    // (g) no transport at all
    // ───────────────────────────────────────────────────────────────────────

    it("an absent native bridge is a clear refusal, not an unhandled rejection", async () => {
        removeBridge();
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // Not the internal sentence, which reads as though the URL were wrong.
        expect(result.reason).not.toContain("native bridge unavailable");
        expect(result.reason).toMatch(/Nothing is wrong with the URL you pasted/);
        expect(calls).toEqual([]);
    });

    it("the bridge check does not fire when the bridge is present (negative control)", async () => {
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(calls).toHaveLength(1);
    });

    // ───────────────────────────────────────────────────────────────────────
    // "last GOOD", meant literally
    // ───────────────────────────────────────────────────────────────────────

    it("records the URL only after a request came back with a translation", async () => {
        expect(store.lastGoodAppsScriptUrl).toBe("");
        const result = await state.validateAppsScriptUrl(`${URL_OK}?token=leak`);
        expect(result.ok).toBe(true);
        // The canonical form — the string the request was actually made against.
        expect(store.lastGoodAppsScriptUrl).toBe(URL_OK);
    });

    it("does not record a URL that failed its probe", async () => {
        reply = async () => ({ status: 404, body: "" });
        const result = await state.validateAppsScriptUrl(URL_OK);
        expect(result.ok).toBe(false);
        expect(store.lastGoodAppsScriptUrl, "\"last good\" must never mean \"last typed\"").toBe("");
    });

    it("does not record a URL refused before it was ever sent", async () => {
        const result = await state.validateAppsScriptUrl(`https://script.google.com/macros/s/${DEPLOY_ID}/dev`);
        expect(result.ok).toBe(false);
        expect(store.lastGoodAppsScriptUrl).toBe("");
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Source-level, for what execution cannot see.
// ───────────────────────────────────────────────────────────────────────────

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/**
 * Only the executable lines. The subject is heavily commented and its comments
 * NAME the very identifiers being ordered below — a matcher that cannot tell an
 * explanation from an instruction would forbid the file from explaining itself.
 * Same instrument as test/panelSettingsOverlap.test.ts, for the same reason.
 */
function codeIndexOf(source: string, needle: string): number {
    let offset = 0;
    for (const line of source.split("\n")) {
        if (!isCommentLine(line) && line.includes(needle)) return offset;
        offset += line.length + 1;
    }
    return -1;
}

function codeContains(source: string, needle: string): boolean {
    return codeIndexOf(source, needle) > -1;
}

/** An import of the identifier, not a mention of it in prose. */
function importsIdentifier(source: string, identifier: string): boolean {
    return new RegExp(`^import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`, "m").test(source);
}

/** The text of a top-level `<prefix> name(` … `\n}` block. */
function fnBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    expect(start, `${signature} was not found`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    expect(end, `${signature} is unterminated`).toBeGreaterThan(start);
    return source.slice(start, end);
}

/** The `id: { … }` block of one entry in definePluginSettings. */
function settingBlock(source: string, id: string): string {
    const start = source.indexOf(`    ${id}: {`);
    expect(start, `${id} was not found in settings.ts`).toBeGreaterThan(-1);
    const end = source.indexOf("\n    }", start);
    expect(end, `${id} is unterminated`).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("what the source has to say that running it cannot", () => {
    const body = () => fnBody(read(STATE), "export async function validateAppsScriptUrl(");

    it("the files it claims to read exist and are not empty", () => {
        for (const file of [STATE, PROVIDER, SETTINGS, PLUGIN_MANAGER, PLUGIN_MODAL]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    /*
     * WHAT THESE TWO USED TO ASSERT, AND WHY REPLACING THEM IS NOT A WEAKENING.
     *
     * There were three assertions here about a meter: that validateAppsScriptUrl()
     * wrapped its provider in meterIfBilled(new UsageMeter(usageStore()), {
     * monthlyCharacterCap }), that the wrapping was character-for-character the
     * chokepoint's, and that the meter came between resolution and the probe.
     *
     * The wrapper was ALWAYS a no-op on this path — apps-script was never in the
     * BILLED set, so meterIfBilled() returned the free provider by identity — and
     * it was kept only so that provider construction had one shape and a future
     * BILLED provider validated through here would be metered by default. There
     * are no billed providers any more and core/usage.ts is deleted, so the
     * wrapper is gone from both sites.
     *
     * The claim that survives is the one that was doing the work: the two sites
     * still construct a provider the SAME way, so a difference between them
     * cannot hide. It is asserted below over the shape that is actually there,
     * and the ghosts are named individually so a half-restored wrapper fails.
     */
    it("builds the provider with the SAME shape translationProvider() uses", () => {
        const chokepoint = fnBody(read(STATE), "export function translationProvider(");
        const validate = body();

        // The chokepoint is a bare currentProvider() call; this path cannot use it
        // (it must resolve the CANDIDATE, not the stored URL) so it calls
        // appsScriptProviderFor(). Both are one call, wrapped in nothing.
        expect(codeContains(chokepoint, "currentProvider(http)")).toBe(true);
        expect(codeContains(validate, "appsScriptProviderFor(trimmed, http)")).toBe(true);

        for (const dead of ["meterIfBilled(", "UsageMeter(", "usageStore(", "monthlyCharacterCap"]) {
            expect(codeContains(chokepoint, dead), `${dead} in translationProvider()`).toBe(false);
            expect(codeContains(validate, dead), `${dead} in validateAppsScriptUrl()`).toBe(false);
        }
    });

    it("codeContains() can see a call that IS there (positive control)", () => {
        // Four of the assertions above are negative, and a codeContains() that had
        // stopped matching anything at all would satisfy every one of them.
        expect(codeContains(body(), "checkDeploymentUrl(")).toBe(true);
        expect(codeContains(body(), "a-call-that-is-not-in-this-function(")).toBe(false);
    });

    it("checks the URL shape before anything that could reach the network", () => {
        const src = body();
        const shapeCheck = codeIndexOf(src, "checkDeploymentUrl(");
        const resolve = codeIndexOf(src, "appsScriptProviderFor(");
        const probe = codeIndexOf(src, "provider.translate(");

        for (const [name, index] of [["checkDeploymentUrl", shapeCheck], ["appsScriptProviderFor", resolve], ["provider.translate", probe]] as const) {
            expect(index, `${name} not found in validateAppsScriptUrl()`).toBeGreaterThan(-1);
        }
        expect(shapeCheck).toBeLessThan(resolve);
        expect(resolve).toBeLessThan(probe);
    });

    it("returns on a failed shape check rather than falling through to the probe", () => {
        const src = body();
        const check = codeIndexOf(src, "checkDeploymentUrl(");
        const guard = codeIndexOf(src, "if (!shape.ok) return");
        expect(guard).toBeGreaterThan(check);
        expect(guard).toBeLessThan(codeIndexOf(src, "provider.translate("));
    });

    it("records the last good URL AFTER the await, never before it", () => {
        const src = body();
        const probe = codeIndexOf(src, "await provider.translate(");
        const write = codeIndexOf(src, "settings.store.lastGoodAppsScriptUrl =");
        expect(probe).toBeGreaterThan(-1);
        expect(write, "nothing writes lastGoodAppsScriptUrl").toBeGreaterThan(-1);
        expect(write, "\"last good\" would mean \"last typed\"").toBeGreaterThan(probe);
    });

    it("does not reach past provider.ts into the registry", () => {
        // Duplicated from test/providerChokepoint.test.ts on purpose: that
        // file explains the rule, this one explains why THIS function obeys it.
        expect(importsIdentifier(read(STATE), "resolveProvider")).toBe(false);
        expect(importsIdentifier(read(STATE), "appsScriptProviderFor")).toBe(true);
    });

    it("appsScriptProviderFor lives in provider.ts and reads no settings for the URL", () => {
        const src = read(PROVIDER);
        const fn = fnBody(src, "export function appsScriptProviderFor(");
        expect(codeContains(fn, 'resolveProvider("apps-script"')).toBe(true);
        expect(codeContains(fn, "{ apiKey: candidateUrl }")).toBe(true);
        expect(codeContains(fn, "settings.store"), "it must resolve the CANDIDATE, not the stored URL").toBe(false);
    });

    it("its comment tells a reader who moves it why the test will fail", () => {
        const src = read(PROVIDER);
        const doc = src.slice(0, src.indexOf("export function appsScriptProviderFor("));
        const nearest = doc.lastIndexOf("/**");
        const explanation = doc.slice(nearest);
        expect(explanation).toMatch(/[Cc]hokepoint/);
        expect(explanation).toMatch(/resolveProvider/);
    });

    it("no comment in the function promises a spend cap that does not exist", () => {
        // It used to have to say the meter was a no-op here, because a no-op
        // meterIfBilled() call sat in the code and needed explaining. The call is
        // gone with the providers it existed for, so the requirement inverts: the
        // function must not describe metering, capping or billing at all. A
        // comment promising a spend cap in a plugin that cannot spend is a worse
        // lie than the one this test was originally written to prevent.
        //
        // Scoped to AFFIRMATIVE claims, not to the words. The function's own
        // comment explains at length that a meterIfBilled() wrapper used to sit
        // on one of these lines and why it went — naming it in order to bury it.
        // A guard that forbade the word would forbid its own explanation, which
        // is how these comments rot. The identifiers themselves are already
        // refused at the CODE level by the shape test above.
        const src = body().toLowerCase();
        expect(src).not.toMatch(/meters?\s+(?:the\s+)?apps[- ]script/);
        expect(src).not.toMatch(/is (?:metered|capped|billed)/);
        expect(src).not.toMatch(/character cap|spend cap|monthly cap/);
    });

    it("would notice such a claim coming back (positive control)", () => {
        const claims = [
            "// this path meters apps-script against the monthly cap",
            "// everything validated here is metered and capped by default",
            "// the probe is billed against the monthly character cap"
        ].map(c => c.toLowerCase());
        expect(claims[0]).toMatch(/meters?\s+(?:the\s+)?apps[- ]script/);
        expect(claims[1]).toMatch(/is (?:metered|capped|billed)/);
        expect(claims[2]).toMatch(/character cap|spend cap|monthly cap/);
        // …and the surviving explanation is NOT flagged by any of the three.
        const kept = "// there used to be a meterIfBilled() wrapper on this line, kept deliberately".toLowerCase();
        expect(kept).not.toMatch(/meters?\s+(?:the\s+)?apps[- ]script/);
        expect(kept).not.toMatch(/is (?:metered|capped|billed)/);
        expect(kept).not.toMatch(/character cap|spend cap|monthly cap/);
    });
});

describe("the lastGoodAppsScriptUrl setting", () => {
    const block = () => settingBlock(read(SETTINGS), "lastGoodAppsScriptUrl");

    it("exists in the plugin's settings source", () => {
        expect(read(SETTINGS)).toContain("lastGoodAppsScriptUrl: {");
    });

    it("is a STRING defaulting to empty", () => {
        expect(block()).toContain("type: OptionType.STRING");
        expect(block()).toMatch(/default:\s*""/);
    });

    it("is hidden, so the cog does not grow a second Apps Script URL box", () => {
        expect(block()).toMatch(/hidden:\s*true/);
    });

    it("says plainly that it is written only after verification", () => {
        // The name promises "last GOOD". The description has to carry the same
        // promise, because the description is what a future maintainer reads
        // before deciding to write this field from a text box's onChange.
        const flat = block().replace(/"\s*\+\s*\r?\n\s*"/g, "");
        expect(flat).toMatch(/VERIFIED/);
        expect(flat).toMatch(/never merely because a URL was typed or saved/i);
    });

    it("the renderer this relies on really does honour `hidden`", () => {
        // Read, not assumed. src/api/PluginManager.ts defines the predicate and
        // src/components/settings/tabs/plugins/PluginModal.tsx is the one caller
        // that decides whether a control is drawn.
        const manager = read(PLUGIN_MANAGER);
        expect(manager).toContain("export function isSettingHidden(");
        expect(manager).toContain('if (!("hidden" in setting)) return false;');

        const modal = read(PLUGIN_MODAL);
        expect(modal).toContain("isSettingHidden");
        expect(modal).toContain("if (isSettingHidden(settings, setting)) return null;");
    });

    it("sits with the other bookkeeping settings, not with the credentials", () => {
        const src = read(SETTINGS);
        expect(src.indexOf("lastGoodAppsScriptUrl: {")).toBeGreaterThan(src.indexOf("usageBlob: {"));
        expect(src.indexOf("lastGoodAppsScriptUrl: {")).toBeGreaterThan(src.indexOf("appsScriptUrl: {"));
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Instrument controls. Every extractor above, run against text that must match
// and text that must not.
// ───────────────────────────────────────────────────────────────────────────

describe("controls — the instruments themselves", () => {
    const SYNTHETIC = [
        "// checkDeploymentUrl(x) mentioned only in a comment",
        "export async function synth(a: string) {",
        "    const shape = checkDeploymentUrl(a);",
        "    // provider.translate() named in a comment BEFORE the real call",
        "    await provider.translate([\"ok\"], \"en\", \"es\");",
        "}",
        ""
    ].join("\n");

    it("codeIndexOf finds an executable line (positive control)", () => {
        expect(codeIndexOf(SYNTHETIC, "checkDeploymentUrl(")).toBeGreaterThan(-1);
    });

    it("codeIndexOf ignores a mention in a comment (negative control)", () => {
        // The only line containing it outside a comment is the `const shape` one,
        // so the offset returned must be past the leading comment line.
        const commentOnly = "// checkDeploymentUrl(a)\nconst x = 1;\n";
        expect(codeIndexOf(commentOnly, "checkDeploymentUrl(")).toBe(-1);
        expect(codeContains(commentOnly, "checkDeploymentUrl(")).toBe(false);
    });

    it("codeIndexOf orders by the CODE line, not the comment line (the trap)", () => {
        const check = codeIndexOf(SYNTHETIC, "checkDeploymentUrl(");
        const probe = codeIndexOf(SYNTHETIC, "provider.translate(");
        expect(check).toBeLessThan(probe);
        // Proof the comment on the line before the probe was skipped: a plain
        // indexOf would have found the comment first and reported it earlier.
        expect(SYNTHETIC.indexOf("provider.translate(")).toBeLessThan(probe);
    });

    it("fnBody extracts a whole function (positive control)", () => {
        const extracted = fnBody(SYNTHETIC, "export async function synth(");
        expect(extracted).toContain("checkDeploymentUrl(a)");
        expect(extracted).toContain("provider.translate(");
    });

    it("fnBody stops at the function's end (negative control)", () => {
        const two = SYNTHETIC + "\nexport function other() {\n    const marker = 1;\n}\n";
        expect(fnBody(two, "export async function synth(")).not.toContain("marker");
    });

    it("settingBlock extracts one entry (positive control)", () => {
        const synthetic = [
            "export const settings = definePluginSettings({",
            "    alpha: {",
            "        type: OptionType.STRING,",
            "        default: \"\",",
            "        hidden: true",
            "    },",
            "    beta: {",
            "        type: OptionType.NUMBER,",
            "        default: 7",
            "    }",
            "});"
        ].join("\n");
        const alpha = settingBlock(synthetic, "alpha");
        expect(alpha).toMatch(/hidden:\s*true/);
        expect(alpha).not.toContain("beta");
        expect(alpha).not.toContain("default: 7");
    });

    it("settingBlock does not smear one entry into the next (negative control)", () => {
        const synthetic = [
            "export const settings = definePluginSettings({",
            "    alpha: {",
            "        type: OptionType.STRING,",
            "        default: \"\"",
            "    },",
            "    beta: {",
            "        type: OptionType.STRING,",
            "        default: \"\",",
            "        hidden: true",
            "    }",
            "});"
        ].join("\n");
        expect(/hidden:\s*true/.test(settingBlock(synthetic, "alpha"))).toBe(false);
        expect(/hidden:\s*true/.test(settingBlock(synthetic, "beta"))).toBe(true);
    });

    it("importsIdentifier sees an import and not a mention (controls)", () => {
        expect(importsIdentifier('import { resolveProvider } from "./x";\n', "resolveProvider")).toBe(true);
        expect(importsIdentifier("// resolveProvider is imported nowhere here\n", "resolveProvider")).toBe(false);
    });

    it("the recording transport records — and records nothing when nothing is sent", async () => {
        calls = [];
        expect(calls).toHaveLength(0);
        await state.validateAppsScriptUrl(URL_OK);
        expect(calls, "positive control: a good URL must produce exactly one request").toHaveLength(1);
        calls = [];
        await state.validateAppsScriptUrl("not a url");
        expect(calls, "negative control: a refused URL must produce none").toHaveLength(0);
    });
});
