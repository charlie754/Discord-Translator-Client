import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@api/DataStore", () => fakeDataStore);

import { goatBannerStorage } from "../src/plugins/channelTranslator/banner/storage";

const recordKey = "goatcamBanner.record";
const setKey = (sha256: string) => `goatcamBanner.set.${sha256}`;
const bytes = (length: number) => new Uint8Array(length);

describe("goatBannerStorage", () => {
    beforeEach(() => {
        fakeDataStore.values.clear();
        vi.clearAllMocks();
    });

    it("treats a record over 16 KiB as missing and rejects an oversized write", async () => {
        const record = { hwm: 0, current: null, lastCheckMs: 0, failures: 0, padding: "x".repeat(16_384) };
        fakeDataStore.values.set(recordKey, record);

        await expect(goatBannerStorage.readRecord()).resolves.toBeNull();
        await expect(goatBannerStorage.writeRecord(record)).rejects.toThrow("banner record too large");
    });

    it.each([
        ["signed", { signed: bytes(16_385), photos: {} }],
        ["photo", { signed: bytes(1), photos: { webp: bytes(300_001) } }]
    ])("treats an oversized %s as a missing set", async (_name, stored) => {
        fakeDataStore.values.set(setKey("a".repeat(64)), stored);
        await expect(goatBannerStorage.readSet("a".repeat(64))).resolves.toBeNull();
    });

    it("treats unexpected fields and wrong types as a missing set", async () => {
        fakeDataStore.values.set(setKey("b".repeat(64)), {
            signed: bytes(1),
            photos: { webp: bytes(1), jpg: bytes(1) },
            unexpected: true
        });
        await expect(goatBannerStorage.readSet("b".repeat(64))).resolves.toBeNull();

        fakeDataStore.values.set(setKey("c".repeat(64)), { signed: "not bytes", photos: {} });
        await expect(goatBannerStorage.readSet("c".repeat(64))).resolves.toBeNull();
    });

    it("writes a set with one atomic DataStore.set call", async () => {
        const sha256 = "d".repeat(64);
        const signed = bytes(4);
        const photo = bytes(5);

        await goatBannerStorage.writeSet(sha256, { signed, photos: { webp: photo } });

        expect(fakeDataStore.set).toHaveBeenCalledTimes(1);
        expect(fakeDataStore.set).toHaveBeenCalledWith(setKey(sha256), {
            signed,
            photos: { webp: photo }
        });
    });

    it("deletes every cached set except the named one", async () => {
        const keep = "e".repeat(64);
        const remove = "f".repeat(64);
        fakeDataStore.values.set(setKey(keep), { signed: bytes(1), photos: {} });
        fakeDataStore.values.set(setKey(remove), { signed: bytes(1), photos: {} });
        fakeDataStore.values.set("other", "untouched");

        await goatBannerStorage.deleteSetsExcept(keep);

        expect([...fakeDataStore.values.keys()]).toEqual([setKey(keep), "other"]);
        expect(fakeDataStore.del).toHaveBeenCalledWith(setKey(remove));
    });
});
