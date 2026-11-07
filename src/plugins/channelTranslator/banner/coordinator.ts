/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./banner-core.js";
import "./banner-machine.js";
import "./banner-fetch.js";
import "./banner-key.js";

import { React } from "@webpack/common";

import { goatBannerGateFromExtension } from "../../../../browser/translationBridge";
import { IS_FIREFOX, metaReady } from "../../../utils/web-metadata";
import { type GoatBannerStorage, goatBannerStorage } from "./storage";

type BannerRunnerModel =
    | { kind: "dagoat"; immediate?: boolean }
    | {
        kind: "online";
        banner: Record<string, unknown>;
        photo: { kind: string; dataUrl: string };
        immediate?: boolean;
    };

export type Model =
    | { kind: "dagoat" }
    | { kind: "online"; banner: Record<string, unknown>; photoDataUrl: string };

type SetTimer = (atMs: number, callback: () => void) => unknown;

type RunnerDeps = {
    storage?: GoatBannerStorage;
    fetch?: typeof fetch;
    setTimer?: SetTimer;
    clearTimer?: () => void;
    now?: () => number;
    gate?: () => Promise<boolean>;
    publicKeyRaw?: Uint8Array;
};

type BannerGlobals = typeof globalThis & {
    GoatBannerFetch: {
        run: (machine: unknown, options: Record<string, unknown>) => Controls;
    };
    GoatBannerKey: {
        publicKeyHex: string;
        keyId: string;
        floor: number;
        firefoxOnline: boolean;
    };
    GoatBannerMachine: {
        create: (options: { floor: number; kinds: string[] }) => unknown;
    };
};

type Controls = {
    shown: () => Promise<unknown>;
    hidden: () => Promise<unknown>;
    pointer: (over: boolean) => Promise<unknown>;
    focus: (inside: boolean) => Promise<unknown>;
    click: () => Promise<unknown>;
};

const globals = globalThis as BannerGlobals;
const KINDS = ["webp"];
const ORIGIN = "https://goatcam.dagoat.io";
const defaultGate = async () => true;
const isExtensionBuild = typeof IS_EXTENSION !== "undefined" && IS_EXTENSION;

let latestModel: Model = { kind: "dagoat" };
let mountedCount = 0;
let controls: Controls | null = null;
let runnerDeps: RunnerDeps = {};
let gate = defaultGate;
let timer: ReturnType<typeof setTimeout> | null = null;
let visibilityRequested: boolean | null = null;
let visibilityRunning = false;
const subscribers = new Set<() => void>();

const hexBytes = (hex: string): Uint8Array => {
    if (hex.length % 2 !== 0) throw new TypeError("invalid banner key");
    const result = new Uint8Array(hex.length / 2);
    for (let index = 0; index < result.length; index++) {
        const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
        if (!Number.isInteger(byte)) throw new TypeError("invalid banner key");
        result[index] = byte;
    }
    return result;
};

const notify = () => {
    for (const subscriber of subscribers) subscriber();
};

const render = async (runnerModel: BannerRunnerModel) => {
    if (runnerModel.kind === "dagoat") {
        latestModel = { kind: "dagoat" };
    } else {
        if (runnerModel.photo.kind !== "webp" || !runnerModel.photo.dataUrl.startsWith("data:image/webp;base64,")) {
            throw new TypeError("invalid verified banner photo");
        }
        // The shared runner constructs this URL directly from its verified WebP bytes.
        latestModel = {
            kind: "online",
            banner: runnerModel.banner,
            photoDataUrl: runnerModel.photo.dataUrl
        };
    }
    notify();
};

const setDefaultTimer = (atMs: number, callback: () => void) => {
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
        timer = null;
        callback();
    }, Math.max(0, atMs - Date.now()));
    return timer;
};

const clearDefaultTimer = () => {
    if (timer !== null) {
        globalThis.clearTimeout(timer);
        timer = null;
    }
};

const ensureRunner = () => {
    if (controls !== null) return controls;

    const machine = globals.GoatBannerMachine.create({ floor: globals.GoatBannerKey.floor, kinds: KINDS });
    const setTimer = runnerDeps.setTimer ?? setDefaultTimer;
    const clearTimer = runnerDeps.clearTimer ?? clearDefaultTimer;
    const options: Record<string, unknown> = {
        storage: runnerDeps.storage ?? goatBannerStorage,
        setTimer,
        clearTimer,
        render,
        openLink: () => undefined,
        gate: () => gate(),
        origin: ORIGIN,
        publicKeyRaw: runnerDeps.publicKeyRaw ?? hexBytes(globals.GoatBannerKey.publicKeyHex),
        kinds: KINDS,
        onError: (error: unknown) => console.warn("[goatcam-banner] runner error:", error)
    };
    if (runnerDeps.fetch !== undefined) options.fetch = runnerDeps.fetch;
    if (runnerDeps.now !== undefined) options.now = runnerDeps.now;

    controls = globals.GoatBannerFetch.run(machine, options);
    return controls;
};

const requestVisibility = () => {
    visibilityRequested = mountedCount > 0;
    if (visibilityRunning || (visibilityRequested === false && controls === null)) return;

    visibilityRunning = true;
    void (async () => {
        while (visibilityRequested !== null) {
            const requested = visibilityRequested;
            visibilityRequested = null;
            const runner = requested ? ensureRunner() : controls;
            if (runner === null) continue;
            if (requested) await runner.shown();
            else await runner.hidden();
        }
        visibilityRunning = false;
    })().catch(error => {
        visibilityRunning = false;
        console.warn("[goatcam-banner] visibility error:", error);
    });
};

export function useGoatBannerModel(): Model {
    const [, forceUpdate] = React.useState(0);
    React.useEffect(() => {
        const subscriber = () => forceUpdate(value => value + 1);
        subscribers.add(subscriber);
        mountedCount += 1;
        if (mountedCount === 1) requestVisibility();

        return () => {
            if (!subscribers.delete(subscriber)) return;
            mountedCount -= 1;
            if (mountedCount === 0) requestVisibility();
        };
    }, []);
    return latestModel;
}

export const bannerEvents = {
    pointer(over: boolean) {
        void ensureRunner().pointer(over);
    },
    focus(inside: boolean) {
        void ensureRunner().focus(inside);
    },
    click() {
        void ensureRunner().click();
    }
};

export function setGoatBannerGate(nextGate: () => Promise<boolean>) {
    gate = nextGate;
}

export function configureGoatBannerGate() {
    if (!isExtensionBuild) return undefined;

    // ponytail: one shared extension bundle waits for runtime metadata; separate
    // Chrome and Firefox bundles only if the package-specific behavior grows.
    const extensionGate = async () => {
        await metaReady;
        if (IS_FIREFOX && globals.GoatBannerKey.firefoxOnline !== true) return false;
        return IS_FIREFOX ? goatBannerGateFromExtension() : true;
    };

    setGoatBannerGate(extensionGate);
    return extensionGate;
}

export function __resetGoatBannerForTests(deps: RunnerDeps = {}) {
    if (controls !== null) void controls.hidden();
    clearDefaultTimer();
    controls = null;
    runnerDeps = deps;
    gate = deps.gate ?? defaultGate;
    latestModel = { kind: "dagoat" };
    mountedCount = 0;
    visibilityRequested = null;
    visibilityRunning = false;
    subscribers.clear();
}
