/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The seam between plugin settings and the provider registry, for the one
 * provider where that seam was not connected.
 *
 * "apps-script" shipped selectable in the settings dropdown, with its own
 * validated settings field, its own provider implementation and 54 tests of that
 * implementation — and could never translate anything. apiKeyFor() in
 * src/plugins/channelTranslator/provider.ts switched on the provider id and had
 * no case for it, so the registry was handed undefined, saw needsKey, and refused
 * the provider with "needs a Web App URL of your own" at a user who had already
 * pasted one. Nothing failed: the type is `string | undefined` and undefined is a
 * legal answer, so neither tsc nor any test could see it.
 *
 * The defect was in the WIRING, not in either end of it, and every test in this
 * repo was on one end or the other. test/appsScriptProvider.test.ts constructs
 * the provider directly with a URL it supplies itself; test/settingsCopy.test.ts
 * reads the settings source as text. Neither can observe which settings field
 * reaches which provider, which is what this file asserts.
 *
 * Both mocks are required rather than convenient. provider.ts imports
 * @api/Notices and ./settings, and settings.ts in turn resolves @api/Settings and
 * @webpack/common — Vencord build aliases that do not exist under vitest — so the
 * module cannot be imported at all without standing in for them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The stand-in settings store, hoisted so vi.mock() below can close over it and
 * each test can rewrite it before importing. Only the fields apiKeyFor() reads
 * are present; anything else it reached for would be an undefined that shows up
 * as a failure here rather than as a silent refusal in front of a user.
 */
const store = vi.hoisted(() => ({
    provider: "google",
    appsScriptUrl: "",
    // NOT settings any more — both were deleted with the paid providers. They are
    // kept in the stand-in store deliberately, as decoys: apiKeyFor() must not
    // reach for a field just because one is there, and a store holding only the
    // right answer cannot tell the difference between reading it and guessing.
    deeplApiKey: "",
    googleCloudApiKey: ""
}));

vi.mock("@api/Notices", () => ({ showNotice: vi.fn(), popNotice: vi.fn() }));
vi.mock("../src/plugins/channelTranslator/settings", () => ({ settings: { store } }));

const DEPLOYMENT = "https://script.google.com/macros/s/AKfycbwWiringTest_1234/exec";

/** A transport that records where it was pointed and answers like a deployed proxy. */
function recordingTransport(translations: string[]) {
    const calls: { url: string; init?: unknown; }[] = [];
    const http = async (url: string, init?: unknown) => {
        calls.push({ url, init });
        return { status: 200, body: JSON.stringify({ translations }) };
    };
    return { http, calls };
}

/** A transport that fails the test if anything reaches it. */
const unreachable = async () => {
    throw new Error("must not be reached");
};

async function currentProvider(http: any) {
    const { currentProvider: fn } = await import("../src/plugins/channelTranslator/provider");
    return fn(http);
}

beforeEach(() => {
    vi.resetModules();
    store.provider = "google";
    store.appsScriptUrl = "";
    store.deeplApiKey = "";
    store.googleCloudApiKey = "";
});

describe("apps-script settings wiring", () => {
    it("constructs the provider when a deployment URL is configured", async () => {
        store.provider = "apps-script";
        store.appsScriptUrl = DEPLOYMENT;

        const resolution = await currentProvider(unreachable);

        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;
        expect(resolution.provider.id).toBe("apps-script");
        expect(resolution.provider.needsKey).toBe(true);
    });

    it("sends the request to the URL that is in appsScriptUrl", async () => {
        // The assertion that actually pins apiKeyFor's return VALUE rather than
        // its truthiness. A case returning any non-empty string would satisfy the
        // test above; only this one fails if the wrong field is forwarded.
        store.provider = "apps-script";
        store.appsScriptUrl = DEPLOYMENT;
        store.deeplApiKey = "a-deepl-key-that-must-not-travel";

        const { http, calls } = recordingTransport(["hola"]);
        const resolution = await currentProvider(http);

        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;

        const results = await resolution.provider.translate(["hello"], "auto", "es");

        expect(results.map(r => r.text)).toEqual(["hola"]);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(DEPLOYMENT);
        expect(JSON.stringify(calls[0])).not.toContain("a-deepl-key-that-must-not-travel");
    });

    it("refuses, in words, when no deployment URL is configured", async () => {
        store.provider = "apps-script";

        const resolution = await currentProvider(unreachable);

        expect(resolution.ok).toBe(false);
        if (resolution.ok) return;
        // The noun matters: this provider's credential is a URL, and telling the
        // user to go and find an API key sends them looking for a field that does
        // not exist. See CREDENTIAL_NOUN in core/providers/registry.ts.
        expect(resolution.reason).toContain("a Web App URL");
        expect(resolution.reason).not.toContain("an API key");
    });

    it("does not fall back to another provider's credential", async () => {
        // The failure this guards against is worse than a refusal: a fallback
        // would satisfy the needs-a-key check and then post Discord message text
        // to whatever that other field happens to hold.
        store.provider = "apps-script";
        store.deeplApiKey = "sk-deepl";
        store.googleCloudApiKey = "sk-google-cloud";

        const resolution = await currentProvider(unreachable);

        expect(resolution.ok).toBe(false);
    });

    it("refuses a URL that is not a deployment, at request time", async () => {
        // isValid on the setting is advice — it stops a bad paste being saved, not
        // a bad value being used, and settings written before that validator
        // existed are still on disk. checkDeploymentUrl() is the control, and this
        // asserts the wired-up path reaches it.
        store.provider = "apps-script";
        store.appsScriptUrl = "https://script.google.com/home/projects/abc/edit";

        const resolution = await currentProvider(unreachable);

        // It resolves: the registry only asks whether the string is non-empty.
        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;

        await expect(resolution.provider.translate(["hello"], "auto", "es")).rejects.toThrow(/apps-script/);
    });
});

describe("the providers that are gone are gone from the wiring too", () => {
    /*
     * This describe used to be "the other providers still read their own field",
     * and it pinned that selecting deepl or google-cloud constructed that
     * provider from its own key. Both are deleted, so there is no field to read
     * and no provider to construct — and the old assertions would now pass or
     * fail for reasons that have nothing to do with the wiring.
     *
     * The property that replaces them is the one the deletion has to keep true:
     * a stale provider id left in a user's saved settings — which is exactly
     * what an upgrade produces — must be REFUSED IN WORDS, not silently served
     * by something else. A settings file that still says provider: "deepl" is
     * the normal case after this change, not a hypothetical.
     */
    it.each(["deepl", "google-cloud"] as const)(
        "%s, still saved in an upgraded settings file, is refused rather than substituted",
        async provider => {
            store.provider = provider;
            store.appsScriptUrl = DEPLOYMENT;
            store.deeplApiKey = "sk-deepl";
            store.googleCloudApiKey = "sk-google-cloud";

            // unreachable is the transport: a substitution would have to send
            // something, and sending anything fails this test by throwing.
            const resolution = await currentProvider(unreachable);

            expect(resolution.ok, `${provider} must not resolve to anything`).toBe(false);
            if (resolution.ok) return;
            // The user gets a sentence naming the id they have selected, not a
            // credential complaint about a provider that no longer exists.
            expect(resolution.reason).toContain(`Unknown translation provider "${provider}"`);
            expect(resolution.reason).not.toContain("an API key");
        }
    );

    it("does not forward a stale key to the provider it DOES construct", async () => {
        // The dangerous shape: apps-script selected, dead keys still on disk, and
        // apiKeyFor() reaching for whichever field is non-empty. Message text
        // would then be posted to a string that is not a deployment URL.
        store.provider = "apps-script";
        store.appsScriptUrl = DEPLOYMENT;
        store.deeplApiKey = "sk-deepl-must-not-travel";
        store.googleCloudApiKey = "sk-google-cloud-must-not-travel";

        const { http, calls } = recordingTransport(["hola"]);
        const resolution = await currentProvider(http);

        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;
        await resolution.provider.translate(["hello"], "auto", "es");

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(DEPLOYMENT);
        const sent = JSON.stringify(calls[0]);
        expect(sent).not.toContain("sk-deepl-must-not-travel");
        expect(sent).not.toContain("sk-google-cloud-must-not-travel");
    });

    it("keeps the keyless provider keyless", async () => {
        store.provider = "google";

        const resolution = await currentProvider(unreachable);

        expect(resolution.ok).toBe(true);
        if (!resolution.ok) return;
        expect(resolution.provider.needsKey).toBe(false);
    });

    it("an unknown id really is refused, and a known one really is not (controls)", async () => {
        // Both directions, so the refusal above cannot be passing because
        // currentProvider() refuses everything.
        store.provider = "not-a-provider-at-all";
        expect((await currentProvider(unreachable)).ok).toBe(false);

        store.provider = "google";
        expect((await currentProvider(unreachable)).ok).toBe(true);
    });
});
