/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

const RECORD_KEY = "goatcamBanner.record";
const SET_PREFIX = "goatcamBanner.set.";
const RECORD_CAP = 16_384;
const SIGNED_CAP = 16_384;
const PHOTO_CAP = 300_000;
const CLIENT_KINDS = ["webp"] as const;

export type GoatBannerSet = {
    signed: Uint8Array;
    photos: Partial<Record<(typeof CLIENT_KINDS)[number], Uint8Array>>;
};

export type GoatBannerStorage = {
    readRecord: () => Promise<unknown>;
    readSet: (sha256: string) => Promise<GoatBannerSet | null>;
    writeSet: (sha256: string, value: GoatBannerSet) => Promise<void>;
    writeRecord: (record: unknown) => Promise<void>;
    deleteSetsExcept: (keepSha256: string | null) => Promise<void>;
};

const serializedBytes = (value: unknown): number => {
    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === "string"
            ? new TextEncoder().encode(serialized).byteLength
            : Number.POSITIVE_INFINITY;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
};

const isObject = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === "object" && !Array.isArray(value)
);

const validStoredSet = (value: unknown): GoatBannerSet | null => {
    if (!isObject(value) || Object.keys(value).some(key => key !== "signed" && key !== "photos")) return null;
    if (!(value.signed instanceof Uint8Array) || value.signed.byteLength > SIGNED_CAP) return null;
    if (!isObject(value.photos)) return null;

    const photos: Partial<Record<(typeof CLIENT_KINDS)[number], Uint8Array>> = {};
    for (const key of Object.keys(value.photos)) {
        if (!(CLIENT_KINDS as readonly string[]).includes(key)) return null;
        const photo = value.photos[key];
        if (!(photo instanceof Uint8Array) || photo.byteLength > PHOTO_CAP) return null;
        photos[key as (typeof CLIENT_KINDS)[number]] = photo;
    }

    return { signed: value.signed, photos };
};

const setValue = (value: GoatBannerSet): GoatBannerSet => {
    const checked = validStoredSet(value);
    if (!checked) throw new TypeError("invalid banner set");
    return checked;
};

export const goatBannerStorage: GoatBannerStorage = {
    async readRecord() {
        try {
            const record = await DataStore.get<unknown>(RECORD_KEY);
            return serializedBytes(record) <= RECORD_CAP ? record ?? null : null;
        } catch {
            return null;
        }
    },

    async readSet(sha256) {
        try {
            const stored = await DataStore.get<unknown>(`${SET_PREFIX}${sha256}`);
            return validStoredSet(stored);
        } catch {
            return null;
        }
    },

    async writeSet(sha256, value) {
        const checked = setValue(value);
        // One DataStore.set is the commit point: IndexedDB replaces the whole set value atomically.
        await DataStore.set(`${SET_PREFIX}${sha256}`, checked);
    },

    async writeRecord(record) {
        if (serializedBytes(record) > RECORD_CAP) throw new Error("banner record too large");
        await DataStore.set(RECORD_KEY, record);
    },

    async deleteSetsExcept(keepSha256) {
        const keepKey = keepSha256 === null ? null : `${SET_PREFIX}${keepSha256}`;
        const keys = await DataStore.keys<string>();
        for (const key of keys) {
            if (key.startsWith(SET_PREFIX) && key !== keepKey) await DataStore.del(key);
        }
    }
};
