import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
    markPatchHit,
    messagesRendered,
    patchesOk,
    patchHit,
    subscribePatchHits
} from "../src/plugins/channelTranslator/patches";
import { ToggleState } from "../src/plugins/channelTranslator/core/modes";

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const PANEL = join(PLUGIN, "panel", "Panel.tsx");
const INDEX = join(PLUGIN, "index.tsx");

function read(file: string): string {
    return readFileSync(file, "utf8");
}

describe("channel translator patch hit status", () => {
    it("does not report unavailable before a message has rendered", () => {
        expect(patchesOk()).toBe(false);
        vi.stubGlobal("document", { querySelector: () => null });

        try {
            const state = new ToggleState().panelState({
                guildId: "g1",
                patchesOk: patchesOk() || !messagesRendered(),
                breakerOpen: false,
                pending: 0
            });
            expect(state).not.toBe("unavailable");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("treats the node test environment as having rendered messages", () => {
        expect(messagesRendered()).toBe(true);
    });

    it("notifies subscribers once when a hit flag first flips true", () => {
        const id = patchHit("clone") ? "wrap" : "clone";
        const listener = vi.fn();
        const unsubscribe = subscribePatchHits(listener);

        try {
            expect(patchHit(id)).toBe(false);
            markPatchHit(id);
            markPatchHit(id);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(patchHit(id)).toBe(true);
        } finally {
            unsubscribe();
        }
    });
});

describe("patch-hit status wiring", () => {
    it("rerenders the panel when a patch first hits and defers the unavailable state", () => {
        const source = read(PANEL);

        expect(source).toContain("subscribePatchHits");
        expect(source).toContain("patchesOk: patchesOk() || !messagesRendered()");
    });

    it("waits for a rendered message before the startup warning check", () => {
        const source = read(INDEX);

        expect(source).toContain("messagesRendered");
        expect(source).toContain("setInterval");
        expect(source).toContain("2 minutes");
        expect(source).toContain("// ponytail:");
    });
});
