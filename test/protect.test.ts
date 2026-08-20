/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { protect, restore } from "../src/plugins/channelTranslator/core/protect";

function roundTrip(input: string): string {
    const { masked, tokens } = protect(input);
    return restore(masked, tokens);
}

describe("protect / restore", () => {
    it("round-trips plain text unchanged", () => {
        expect(roundTrip("hello world")).toBe("hello world");
    });

    it("protects a user mention", () => {
        const input = "hey <@123456789> look";
        expect(protect(input).masked).not.toContain("123456789");
        expect(roundTrip(input)).toBe(input);
    });

    it("protects role and channel mentions", () => {
        const input = "<@&987> see <#654> now";
        expect(roundTrip(input)).toBe(input);
    });

    it("protects custom and animated emoji", () => {
        const input = "nice <:blob:111> and <a:spin:222>";
        expect(protect(input).masked).not.toContain("blob");
        expect(roundTrip(input)).toBe(input);
    });

    it("protects fenced code blocks including the fence itself", () => {
        const input = "look:\n```js\nconst a = 1;\n```\ndone";
        const { masked } = protect(input);
        expect(masked).not.toContain("```");
        expect(masked).not.toContain("const a");
        expect(roundTrip(input)).toBe(input);
    });

    it("protects inline code", () => {
        const input = "run `npm test` first";
        expect(roundTrip(input)).toBe(input);
    });

    it("protects spoilers", () => {
        const input = "the answer is ||42|| ok";
        expect(roundTrip(input)).toBe(input);
    });

    it("protects urls with query strings", () => {
        const input = "see https://x.com/a?b=1&c=2 for details";
        expect(protect(input).masked).not.toContain("x.com");
        expect(roundTrip(input)).toBe(input);
    });

    it("protects discord timestamps", () => {
        const input = "starts <t:1700000000:R> ok";
        expect(roundTrip(input)).toBe(input);
    });

    it("handles several tokens of mixed kinds in one message", () => {
        const input = "<@1> check `code` at https://a.b then ||spoil|| <:e:2>";
        const { tokens } = protect(input);
        expect(tokens.length).toBe(5);
        expect(roundTrip(input)).toBe(input);
    });

    it("restores correctly when the engine adds spaces around placeholders", () => {
        const { masked, tokens } = protect("hi <@42> there");
        const mangled = masked.replace(/(\d+)/g, " $1 ");
        expect(restore(mangled, tokens)).toContain("<@42>");
    });

    it("leaves text with no protectable tokens untouched", () => {
        const { masked, tokens } = protect("just words");
        expect(masked).toBe("just words");
        expect(tokens).toEqual([]);
    });
});
