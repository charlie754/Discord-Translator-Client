/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeReact = vi.hoisted(() => ({
    useState: undefined as unknown,
    useEffect: undefined as unknown
}));

vi.mock("@webpack/common", () => ({ React: fakeReact }));
vi.mock("@api/DataStore", () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    del: vi.fn(async () => undefined),
    keys: vi.fn(async () => [])
}));

type MessageListener = (event: { source: unknown; data: unknown }) => void;

const makeWindow = () => {
    const listeners = new Map<string, MessageListener[]>();
    const posted: unknown[] = [];
    const window = {
        location: { origin: "https://discord.com" },
        addEventListener(type: string, listener: MessageListener) {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener(type: string, listener: MessageListener) {
            listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== listener));
        },
        postMessage(message: unknown) {
            posted.push(message);
        },
        dispatch(type: string, event: { source: unknown; data: unknown }) {
            for (const listener of listeners.get(type) ?? []) listener(event);
        },
        posted
    };
    return window;
};

describe("GOAT Cam extension gate bridge", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("IS_EXTENSION", false);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("posts the gate request and resolves a well-formed reply", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("location", page.location);
        const { goatBannerGateFromExtension } = await import("../browser/translationBridge");

        const pending = goatBannerGateFromExtension();
        expect(page.posted).toEqual([{ type: "goatcamBanner:gate", id: 1 }]);
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 1, granted: true }
        });

        await expect(pending).resolves.toBe(true);
    });

    it("resolves false for a malformed reply and for the five-second timeout", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("location", page.location);
        const { goatBannerGateFromExtension } = await import("../browser/translationBridge");

        const malformed = goatBannerGateFromExtension();
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 1, granted: "yes" }
        });
        await expect(malformed).resolves.toBe(false);

        vi.useFakeTimers();
        const timeout = goatBannerGateFromExtension();
        await vi.advanceTimersByTimeAsync(5000);
        await expect(timeout).resolves.toBe(false);
    });

    it("content.js ignores a gate request whose source is not this window", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("document", { addEventListener: () => undefined });
        vi.stubGlobal("chrome", {
            runtime: {
                sendMessage: vi.fn(),
                getManifest: () => ({ version: "0.0.0" }),
                getURL: (path: string) => `chrome-extension://test/${path}`
            }
        });
        await import("../browser/content.js");

        page.dispatch("message", {
            source: { otherFrame: true },
            data: { type: "goatcamBanner:gate", id: 3 }
        });

        expect(page.posted).toEqual([]);
    });

    it("Chrome that also defines globalThis.browser still answers true", async () => {
        // Chrome 151 defines `browser` in extension contexts too, so namespace presence
        // is not a Firefox test. Only Firefox has runtime.getBrowserInfo.
        const page = makeWindow();
        const sendMessage = vi.fn();
        const api = {
            runtime: {
                sendMessage,
                getManifest: () => ({ version: "0.0.0" }),
                getURL: (path: string) => `chrome-extension://test/${path}`
            }
        };
        vi.stubGlobal("window", page);
        vi.stubGlobal("document", { addEventListener: () => undefined });
        vi.stubGlobal("chrome", api);
        vi.stubGlobal("browser", api);
        await import("../browser/content.js");

        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate", id: 5 }
        });
        await vi.waitFor(() => expect(page.posted).toEqual([{
            type: "goatcamBanner:gate:result",
            id: 5,
            granted: true
        }]));
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("Firefox relays the gate through the background permission API", async () => {
        const page = makeWindow();
        const sendMessage = vi.fn(() => Promise.resolve({ granted: false }));
        vi.stubGlobal("window", page);
        vi.stubGlobal("document", { addEventListener: () => undefined });
        // What a Firefox CONTENT SCRIPT really gets (measured on Firefox Developer Edition 160):
        // no runtime.getBrowserInfo. This stub used to provide one, which is why the old
        // getBrowserInfo detection passed here while real Firefox was treated as Chrome and the
        // gate answered "granted" without asking the background.
        vi.stubGlobal("browser", {
            runtime: {
                getURL: (path: string) => `moz-extension://0d1f1c4e-test/${path}`,
                getManifest: () => ({ version: "0.2.19" }),
                sendMessage
            }
        });
        await import("../browser/content.js");

        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate", id: 4 }
        });
        await vi.waitFor(() => expect(page.posted).toEqual([{
            type: "goatcamBanner:gate:result",
            id: 4,
            granted: false
        }]));
        expect(sendMessage).toHaveBeenCalledWith({ action: "goatcamBanner:gate" });
    });

    it("Firefox update check without the data permission is refused by the content script", async () => {
        const page: ReturnType<typeof makeWindow> & { top?: unknown } = makeWindow();
        page.top = page;
        const sendMessage = vi.fn(() => Promise.resolve({ granted: false }));
        vi.stubGlobal("window", page);
        vi.stubGlobal("document", { addEventListener: () => undefined });
        vi.stubGlobal("browser", {
            runtime: {
                getURL: (path: string) => `moz-extension://0d1f1c4e-test/${path}`,
                getManifest: () => ({ version: "0.2.19" }),
                sendMessage
            }
        });
        await import("../browser/content.js");

        page.dispatch("message", {
            source: page,
            data: { type: "discordTranslator:update:check", id: 7 }
        });
        await vi.waitFor(() => expect(page.posted).toEqual([{
            type: "discordTranslator:update:check:result",
            id: 7,
            response: { browser: "firefox", installed: "0.2.19", allowed: false }
        }]));
        // The permission question went to the background; nothing asked a Chrome worker.
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ action: "goatcamBanner:gate" });
    });

    it("update messages from a sub-frame never reach the extension", async () => {
        const page: ReturnType<typeof makeWindow> & { top?: unknown } = makeWindow();
        page.top = {};
        const sendMessage = vi.fn();
        const api = {
            runtime: {
                getURL: (path: string) => `chrome-extension://test/${path}`,
                getManifest: () => ({ version: "0.2.19" }),
                sendMessage
            }
        };
        vi.stubGlobal("window", page);
        vi.stubGlobal("document", { addEventListener: () => undefined });
        vi.stubGlobal("chrome", api);
        await import("../browser/content.js");

        page.dispatch("message", { source: page, data: { type: "discordTranslator:update:check", id: 8 } });
        page.dispatch("message", { source: page, data: { type: "discordTranslator:update:reload", id: 9 } });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(page.posted).toEqual([]);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("Firefox with permission granted resolves true and the runner fetches", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("location", page.location);
        vi.stubGlobal("IS_EXTENSION", true);
        vi.stubGlobal("GoatBannerKey", {
            publicKeyHex: "00",
            keyId: "test",
            floor: 0
        });

        const { configureGoatBannerGate, __resetGoatBannerForTests } = await import(
            "../src/plugins/channelTranslator/banner/coordinator"
        );
        const fetchMock = vi.fn(async () => ({ status: 503 }));
        __resetGoatBannerForTests({
            fetch: fetchMock,
            setTimer: () => 0,
            clearTimer: () => undefined
        });

        // The real metadata listener is what tells the page-world bundle that this
        // shared extension bundle is running from the Firefox package.
        page.dispatch("message", {
            source: page,
            data: { type: "vencord:meta", meta: { IS_FIREFOX: true } }
        });

        const gate = configureGoatBannerGate();
        const pending = gate?.();
        await vi.waitFor(() => expect(page.posted).toEqual([{ type: "goatcamBanner:gate", id: 1 }]));
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 1, granted: true }
        });
        await expect(pending).resolves.toBe(true);

        let value = 0;
        fakeReact.useState = (initial: unknown) => [value || initial, (next: unknown) => {
            value = typeof next === "function" ? (next as (value: number) => number)(value) : Number(next);
        }];
        fakeReact.useEffect = (effect: () => (() => void) | undefined) => effect();
        const { useGoatBannerModel } = await import(
            "../src/plugins/channelTranslator/banner/coordinator"
        );
        useGoatBannerModel();
        await vi.waitFor(() => expect(page.posted).toEqual([
            { type: "goatcamBanner:gate", id: 1 },
            { type: "goatcamBanner:gate", id: 2 }
        ]));
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 2, granted: true }
        });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });

    it("Firefox with permission missing resolves false and the runner does not fetch", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("location", page.location);
        vi.stubGlobal("IS_EXTENSION", true);
        vi.stubGlobal("GoatBannerKey", {
            publicKeyHex: "00",
            keyId: "test",
            floor: 0
        });

        const { configureGoatBannerGate, __resetGoatBannerForTests } = await import(
            "../src/plugins/channelTranslator/banner/coordinator"
        );
        const fetchMock = vi.fn(async () => ({ status: 503 }));
        __resetGoatBannerForTests({
            fetch: fetchMock,
            setTimer: () => 0,
            clearTimer: () => undefined
        });

        page.dispatch("message", {
            source: page,
            data: { type: "vencord:meta", meta: { IS_FIREFOX: true } }
        });

        const gate = configureGoatBannerGate();
        const pending = gate?.();
        await vi.waitFor(() => expect(page.posted).toEqual([{ type: "goatcamBanner:gate", id: 1 }]));
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 1, granted: false }
        });
        await expect(pending).resolves.toBe(false);

        let value = 0;
        fakeReact.useState = (initial: unknown) => [value || initial, (next: unknown) => {
            value = typeof next === "function" ? (next as (value: number) => number)(value) : Number(next);
        }];
        fakeReact.useEffect = (effect: () => (() => void) | undefined) => effect();
        const { useGoatBannerModel } = await import(
            "../src/plugins/channelTranslator/banner/coordinator"
        );
        useGoatBannerModel();
        await vi.waitFor(() => expect(page.posted).toEqual([
            { type: "goatcamBanner:gate", id: 1 },
            { type: "goatcamBanner:gate", id: 2 }
        ]));
        page.dispatch("message", {
            source: page,
            data: { type: "goatcamBanner:gate:result", id: 2, granted: false }
        });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("Chrome extension configuration resolves true without a permission message", async () => {
        const page = makeWindow();
        vi.stubGlobal("window", page);
        vi.stubGlobal("location", page.location);
        vi.stubGlobal("IS_EXTENSION", true);
        const { configureGoatBannerGate } = await import(
            "../src/plugins/channelTranslator/banner/coordinator"
        );
        page.dispatch("message", {
            source: page,
            data: { type: "vencord:meta", meta: { IS_FIREFOX: false } }
        });

        const gate = configureGoatBannerGate();
        await expect(gate?.()).resolves.toBe(true);
        expect(page.posted).toEqual([]);
    });
});
