/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { hashContent } from "../src/plugins/channelTranslator/core/hash";

describe("hashContent", () => {
    it("is stable for the same input", () => {
        expect(hashContent("hello")).toBe(hashContent("hello"));
    });

    it("differs for different input", () => {
        expect(hashContent("hello")).not.toBe(hashContent("hellp"));
    });

    it("handles CJK and emoji without throwing", () => {
        expect(hashContent("了解 👍")).toMatch(/^[0-9a-f]+$/);
    });

    it("distinguishes strings that differ only by trailing space", () => {
        expect(hashContent("hi")).not.toBe(hashContent("hi "));
    });
});
