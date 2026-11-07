/*
 * Operator ruling 2026-11-06: channel translation starts from the newest message
 * and sends only what is on screen. state.ts cannot be imported here (it pulls in
 * Discord's webpack modules), so this pins the WIRING by source, the same way
 * stateGates.test.ts does. The newest-first comparator is extracted and run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const STATE = readFileSync(join(process.cwd(), "src", "plugins", "channelTranslator", "state.ts"), "utf8");
const RENDER = readFileSync(join(process.cwd(), "src", "plugins", "channelTranslator", "render.tsx"), "utf8");

function body(name: string): string {
    const start = STATE.indexOf(`function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const next = STATE.indexOf("\nfunction ", start + 1);
    const nextExport = STATE.indexOf("\nexport function ", start + 1);
    const ends = [next, nextExport].filter(i => i > -1);
    return STATE.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("channel translation sends on-screen messages, newest first", () => {
    it("requestTranslation records instead of sending (outside the no-DOM path)", () => {
        const req = body("requestTranslation");
        expect(req).not.toContain("scheduler");
        expect(req).toContain("wanted.set(");
        // The only direct send is the branch for environments with no document.
        expect(req.split("sendTranslation(").length - 1).toBe(1);
        expect(req).toMatch(/typeof document === "undefined"\)\s*\{\s*sendTranslation\(/);
    });

    it("only sendTranslation reaches the scheduler", () => {
        expect(STATE.split("scheduler\n        .run(").length - 1 + STATE.split("scheduler.run(").length - 1).toBe(1);
        expect(body("sendTranslation")).toContain(".run(");
    });

    it("a queued request re-checks the screen before any provider call", () => {
        const send = body("sendTranslation");
        const gate = send.indexOf("if (!isOnScreen(raw.channelId, raw.id)) return SKIPPED;");
        const call = send.indexOf("provider.translate(");
        expect(gate).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(call);
    });

    it("flushVisible sorts newest first before sending", () => {
        const flush = body("flushVisible");
        expect(flush.indexOf("ready.sort(newestFirst)")).toBeLessThan(flush.indexOf("sendTranslation("));
    });

    it("Both Language mode requests from its render hook", () => {
        expect(RENDER).toContain("requestTranslationById(channelId, messageId)");
    });

    it("newestFirst orders Discord snowflakes newest first", () => {
        // eslint-disable-next-line no-new-func
        const js = ts.transpileModule(body("newestFirst"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
        const newestFirst = new Function(`${js}; return newestFirst;`)() as (a: any, b: any) => number;
        const ids = ["1568413165375717447", "998", "1568413165375717500", "1000", "1568413165375717447"];
        const sorted = ids.map(id => ({ id })).sort(newestFirst).map(m => m.id);
        expect(sorted).toEqual(["1568413165375717500", "1568413165375717447", "1568413165375717447", "1000", "998"]);
    });
});
