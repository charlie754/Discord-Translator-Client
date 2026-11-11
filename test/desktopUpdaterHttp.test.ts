/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * The REAL src/main/updater/http.ts, driven through the IPC handlers it registers - only the network,
 * the filesystem and Electron are stubbed. Same technique as guideTarget.test.ts: compile the module
 * with esbuild and evaluate it with a require() that hands out stubs.
 *
 * What it pins down end to end (Council round 2 asked for the final write path, not just the helpers):
 *  - the compare request names the RELEASE commit, never HEAD;
 *  - bytes that are not a complete asar of the announced size are rejected BEFORE anything is written;
 *  - a download address outside this repository's releases is refused before any download;
 *  - two simultaneous "Update now" presses download and write once.
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import * as release from "../src/main/updater/release";

const REPO = "charlie754/Discord-Translator-Client";
const INSTALLED = "a".repeat(40);
const LATEST = "b".repeat(40);
const TARGET = "C:\\fake\\Discord Translator\\discordtranslator.asar";
const CH = { GET_REPO: "repo", GET_UPDATES: "updates", GET_UPDATE_VERSION: "version", UPDATE: "update", BUILD: "build" };

function asar(): Uint8Array {
    const body = new TextEncoder().encode(JSON.stringify({ files: { "index.js": { size: 1, offset: "0" } } }));
    const out = new Uint8Array(16 + body.length + 8);
    const view = new DataView(out.buffer);
    view.setUint32(0, 4, true);
    view.setUint32(4, body.length + 8, true);
    view.setUint32(8, body.length + 4, true);
    view.setUint32(12, body.length, true);
    out.set(body, 16);
    return out;
}

function load(opts: { downloadUrl?: string; body: Uint8Array; size?: number; }) {
    const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
    const writeFileSync = vi.fn();
    const fetchJson = vi.fn(async (url: string) => {
        if (url.endsWith("/releases/latest")) return {
            name: `Discord Translator ${LATEST}`,
            tag_name: "v9.9.9",
            assets: [{
                name: "desktop.asar",
                browser_download_url: opts.downloadUrl ?? `https://github.com/${REPO}/releases/download/v9.9.9/desktop.asar`,
                size: opts.size ?? opts.body.byteLength
            }]
        };
        if (url.includes("/compare/")) return { commits: [{ sha: LATEST, author: { login: "x" }, commit: { message: "fix" } }] };
        throw new Error("unexpected url " + url);
    });
    let release_: () => void = () => undefined;
    const fetchBuffer = vi.fn(() => new Promise<Uint8Array>(resolve => { release_ = () => resolve(opts.body); }));

    const stubs: Record<string, unknown> = {
        "@main/utils/http": { fetchJson, fetchBuffer },
        "@shared/IpcEvents": { IpcEvents: CH },
        "@shared/vencordUserAgent": { VENCORD_USER_AGENT: "test" },
        "electron": { ipcMain: { handle: (channel: string, fn: any) => { handlers[channel] = fn; } } },
        "original-fs": { writeFileSync },
        "~git-hash": { __esModule: true, default: INSTALLED },
        "~git-remote": { __esModule: true, default: REPO },
        "./common": {
            ASAR_FILE: "desktop.asar",
            serializeErrors: (fn: any) => async (...args: any[]) => {
                try { return { ok: true, value: await fn(...args) }; } catch (e: any) { return { ok: false, error: { message: e.message } }; }
            }
        },
        "./release": release
    };

    const source = readFileSync(join(process.cwd(), "src", "main", "updater", "http.ts"), "utf8");
    const { code } = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" });
    const module = { exports: {} };
    const requireStub = (id: string) => {
        if (!(id in stubs)) throw new Error("unstubbed import " + id);
        return stubs[id];
    };
    new Function("require", "module", "exports", "__dirname", code)(requireStub, module, module.exports, TARGET);

    // fetchBuffer is held open so the single-flight test can overlap two presses; the others release it.
    const build = async () => { const pending = handlers[CH.BUILD](); release_(); return pending; };
    return { handlers, build, fetchJson, fetchBuffer, writeFileSync, release: () => release_() };
}

describe("desktop updater, real http.ts through its IPC handlers", () => {
    it("asks GitHub to compare the installed commit with the RELEASE commit, never HEAD", async () => {
        const t = load({ body: asar() });
        const updates = await t.handlers[CH.GET_UPDATES]();
        expect(updates.ok).toBe(true);
        expect(updates.value).toHaveLength(1);
        const compare = t.fetchJson.mock.calls.map(c => c[0]).find(u => u.includes("/compare/"));
        expect(compare).toBe(`https://api.github.com/repos/${REPO}/compare/${INSTALLED}...${LATEST}`);
        expect((await t.handlers[CH.GET_UPDATE_VERSION]()).value).toBe("v9.9.9");
    });

    it("rejects bytes that are not a complete asar BEFORE writing anything", async () => {
        const html = new TextEncoder().encode("<!DOCTYPE html><html><body>rate limited</body></html>");
        const t = load({ body: html });
        expect((await t.handlers[CH.UPDATE]()).value).toBe(true);
        const result = await t.build();
        expect(result.ok).toBe(false);
        expect(result.error.message).toMatch(/incomplete or not an asar/);
        expect(t.writeFileSync).not.toHaveBeenCalled();
    });

    it("rejects a download shorter than the size GitHub announced", async () => {
        const good = asar();
        const t = load({ body: good.subarray(0, good.byteLength - 1), size: good.byteLength });
        await t.handlers[CH.UPDATE]();
        expect((await t.build()).ok).toBe(false);
        expect(t.writeFileSync).not.toHaveBeenCalled();
    });

    it("refuses a download address outside this repository's releases, before downloading", async () => {
        const t = load({ body: asar(), downloadUrl: "https://evil.example/desktop.asar" });
        const update = await t.handlers[CH.UPDATE]();
        expect(update.ok).toBe(false);
        expect(update.error.message).toMatch(/Refusing to download/);
        await t.build();
        expect(t.fetchBuffer).not.toHaveBeenCalled();
        expect(t.writeFileSync).not.toHaveBeenCalled();
    });

    it("writes a valid archive once, to the installed archive's path", async () => {
        const body = asar();
        const t = load({ body });
        await t.handlers[CH.UPDATE]();
        expect((await t.build()).ok).toBe(true);
        expect(t.writeFileSync).toHaveBeenCalledTimes(1);
        expect(t.writeFileSync.mock.calls[0][0]).toBe(TARGET);
        expect(t.writeFileSync.mock.calls[0][1]).toBe(body);
    });

    it("two simultaneous presses download and write once", async () => {
        const t = load({ body: asar() });
        await t.handlers[CH.UPDATE]();
        const first = t.handlers[CH.BUILD]();
        const second = t.handlers[CH.BUILD]();
        t.release();
        const [a, b] = await Promise.all([first, second]);
        expect(a.ok && b.ok).toBe(true);
        expect(t.fetchBuffer).toHaveBeenCalledTimes(1);
        expect(t.writeFileSync).toHaveBeenCalledTimes(1);
    });
});
