/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { isNewer, versionFromPackageJson } from "../src/plugins/channelTranslator/core/version";

describe("isNewer", () => {
    it("detects a newer minor", () => expect(isNewer("0.2.0", "0.1.0")).toBe(true));
    it("rejects an older minor", () => expect(isNewer("0.1.0", "0.2.0")).toBe(false));
    it("rejects an equal version", () => expect(isNewer("0.1.0", "0.1.0")).toBe(false));
    it("detects a newer major", () => expect(isNewer("1.0.0", "0.9.9")).toBe(true));
    it("compares numerically, not lexically", () => expect(isNewer("0.10.0", "0.9.0")).toBe(true));
    it("compares patch numerically", () => expect(isNewer("0.1.10", "0.1.9")).toBe(true));
    it("treats missing segments as zero", () => expect(isNewer("1.1", "1.0.5")).toBe(true));
    it("does not throw on malformed input", () => expect(isNewer("abc", "1.0.0")).toBe(false));
    it("does not throw on empty input", () => expect(isNewer("", "")).toBe(false));
});

describe("versionFromPackageJson", () => {
    it("reads a version", () => expect(versionFromPackageJson('{"version":"1.2.3"}')).toBe("1.2.3"));
    it("returns null on malformed json", () => expect(versionFromPackageJson("not json")).toBeNull());
    it("returns null when absent", () => expect(versionFromPackageJson('{"name":"x"}')).toBeNull());
    it("returns null when not a string", () => expect(versionFromPackageJson('{"version":123}')).toBeNull());
});
