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

describe("restore tolerates what the endpoint actually returns", () => {
    const OPEN = "\uE000";
    const CLOSE = "\uE001";

    it("restores a token whose closing delimiter came back as the opening one", () => {
        // Measured against the live gtx endpoint: for Chinese source text it returns
        // OPEN 0 OPEN instead of OPEN 0 CLOSE. A strict pattern missed it, and every
        // mention, emoji, code span and URL in a translated Chinese message was left
        // on screen as raw private-use characters.
        const mangled = `Hello ${OPEN}0${OPEN} goodbye`;
        expect(restore(mangled, ["<@123>"])).toBe("Hello <@123> goodbye");
    });

    it("restores the well-formed case unchanged", () => {
        expect(restore(`Hello ${OPEN}0${CLOSE} goodbye`, ["<@123>"])).toBe("Hello <@123> goodbye");
    });

    it("restores a closing-only pair, the mirror of the observed corruption", () => {
        expect(restore(`Hello ${CLOSE}0${CLOSE} goodbye`, ["<@123>"])).toBe("Hello <@123> goodbye");
    });

    it("shows the bare index for an unknown token, never a raw delimiter", () => {
        // The token is unrecoverable, but a private-use character rendered in a
        // Discord message is worse than a digit: it shows as a blank box.
        expect(restore(`Hello ${OPEN}9${OPEN} goodbye`, ["<@123>"])).toBe("Hello 9 goodbye");
    });

    it("sweeps a delimiter left unpaired by the endpoint", () => {
        expect(restore(`Hello ${OPEN} goodbye`, [])).toBe("Hello  goodbye");
    });
});
