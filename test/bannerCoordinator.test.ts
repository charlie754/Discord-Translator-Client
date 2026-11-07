import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fakeDataStore = vi.hoisted(() => {
    const values = new Map<string, unknown>();
    return {
        values,
        get: vi.fn(async (key: string) => values.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
            values.set(key, value);
        }),
        del: vi.fn(async (key: string) => {
            values.delete(key);
        }),
        keys: vi.fn(async () => [...values.keys()])
    };
});

const fakeReact = vi.hoisted(() => ({
    useState: undefined as unknown,
    useEffect: undefined as unknown
}));

vi.mock("@api/DataStore", () => fakeDataStore);
vi.mock("@webpack/common", () => ({ React: fakeReact }));

import {
    __resetGoatBannerForTests,
    useGoatBannerModel
} from "../src/plugins/channelTranslator/banner/coordinator";

type HookState = {
    value: unknown;
    tick: number;
    effectRegistered: boolean;
    cleanup: (() => void) | undefined;
    render: () => void;
};

const signed = new Uint8Array(readFileSync(join(process.cwd(), "test/banner/vectors/cases/photo-ok-webp.signed")));
const photo = new Uint8Array(readFileSync(join(process.cwd(), "test/banner/vectors/photos/hero-coffee-800.webp")));
const vectorManifest = JSON.parse(readFileSync(join(process.cwd(), "test/banner/vectors/cases.json"), "utf8")) as { publicKeyHex: string };
const vectorPublicKeyRaw = new Uint8Array(vectorManifest.publicKeyHex.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
const vectorNow = Date.parse("2026-11-02T12:00:00Z");

let activeHook: HookState | null = null;
let fetchImpl: ReturnType<typeof vi.fn>;
let requests: string[];

function response(bytes: Uint8Array): Response {
    return new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) }
    });
}

function mount() {
    const state: HookState = {
        value: undefined,
        tick: 0,
        effectRegistered: false,
        cleanup: undefined,
        render: () => undefined
    };
    state.render = () => {
        activeHook = state;
        state.value = useGoatBannerModel();
        activeHook = null;
    };
    state.render();
    return {
        get model() {
            return state.value as { kind: string; photoDataUrl?: string };
        },
        unmount() {
            state.cleanup?.();
            state.cleanup = undefined;
        }
    };
}

async function settle() {
    for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe("GoatCam banner coordinator", () => {
    beforeEach(() => {
        activeHook = null;
        requests = [];
        fakeDataStore.values.clear();
        vi.clearAllMocks();
        fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            requests.push(url);
            if (url.endsWith("/banner/v1.signed")) return response(signed);
            return response(photo);
        });

        fakeReact.useState = (initial: unknown) => {
            const state = activeHook!;
            return [state.tick || initial, (next: unknown) => {
                state.tick = typeof next === "function"
                    ? (next as (value: number) => number)(state.tick)
                    : Number(next);
                state.render();
            }];
        };
        fakeReact.useEffect = (effect: () => (() => void) | undefined) => {
            const state = activeHook!;
            if (!state.effectRegistered) {
                state.effectRegistered = true;
                state.cleanup = effect();
            }
        };

        __resetGoatBannerForTests({
            fetch: fetchImpl,
            setTimer: () => 0,
            clearTimer: () => undefined,
            now: () => vectorNow,
            publicKeyRaw: vectorPublicKeyRaw
        });
    });

    it("two mounts share one runner request and one online model", async () => {
        const first = mount();
        const second = mount();
        await vi.waitFor(() => expect(requests.filter(url => url.endsWith("/banner/v1.signed"))).toHaveLength(1));
        await vi.waitFor(() => expect(first.model.kind).toBe("online"));

        expect(second.model).toEqual(first.model);
        expect(first.model.photoDataUrl).toMatch(/^data:image\/webp;base64,/);
    });

    it("remount churn does not create more than one request or fetch after the last unmount", async () => {
        for (let index = 0; index < 20; index++) mount().unmount();
        await settle();

        const requestsAtLastUnmount = requests.length;
        await settle();
        expect(requests.filter(url => url.endsWith("/banner/v1.signed")).length).toBeLessThanOrEqual(1);
        expect(requests.length).toBe(requestsAtLastUnmount);
    });

    it("cancels the in-flight attempt before it can write a record", async () => {
        let resolveSigned!: (value: Response) => void;
        fetchImpl.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            requests.push(url);
            if (!url.endsWith("/banner/v1.signed")) return response(photo);
            return new Promise<Response>((resolve, reject) => {
                resolveSigned = resolve;
                init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            });
        });

        const item = mount();
        await vi.waitFor(() => expect(requests).toContain("https://goatcam.dagoat.io/banner/v1.signed"));
        item.unmount();
        await settle();
        resolveSigned(response(signed));
        await settle();

        expect(fakeDataStore.set.mock.calls.filter(([key]) => key === "goatcamBanner.record")).toHaveLength(0);
    });

    it("keeps banner persistence in DataStore keys and never in plugin settings", async () => {
        const item = mount();
        await vi.waitFor(() => expect(item.model.kind).toBe("online"));

        expect([...fakeDataStore.values.keys()].every(key => key.startsWith("goatcamBanner."))).toBe(true);
        expect(fakeDataStore.set.mock.calls.map(([key]) => key)).toEqual(
            expect.arrayContaining(["goatcamBanner.record"])
        );
    });
});
