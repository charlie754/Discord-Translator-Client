/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { BOOT_FAILURE_DELAY_MS, UPDATE_DISMISS_MS, UPDATE_INTERVAL_MS, compareVersions, decideBoot, getUpdateButton, getUpdateSource, isCheckDue, isDismissed, isVersionNewer, shouldFail } from "../browser/updateGuardCore";

describe("browser update guard decisions", () => {
    it("enters safe mode only for a matching failed or safe record", () => {
        expect(decideBoot({ state: "failed", version: "0.2.18", at: 1 }, "0.2.18")).toBe("safe");
        expect(decideBoot({ state: "safe", version: "0.2.18", at: 1 }, "0.2.18")).toBe("safe");
        expect(decideBoot({ state: "failed", version: "0.2.17", at: 1 }, "0.2.18")).toBe("normal");
        expect(decideBoot({ state: "healthy", version: "0.2.18", at: 1 }, "0.2.18")).toBe("normal");
    });

    it("fails only after webpack was seen and the full delay elapsed", () => {
        expect(shouldFail(null, BOOT_FAILURE_DELAY_MS, false)).toBe(false);
        expect(shouldFail(0, BOOT_FAILURE_DELAY_MS - 1, false)).toBe(false);
        expect(shouldFail(0, BOOT_FAILURE_DELAY_MS, false)).toBe(true);
        expect(shouldFail(0, BOOT_FAILURE_DELAY_MS, true)).toBe(false);
    });

    it("compares dotted versions numerically", () => {
        expect(compareVersions("0.2.10", "0.2.9")).toBe(1);
        expect(isVersionNewer("0.2.10", "0.2.9")).toBe(true);
        expect(isVersionNewer("0.2.9", "0.2.10")).toBe(false);
        expect(isVersionNewer("bad", "0.2.10")).toBe(false);
    });

    it("selects the browser source and one-click action", () => {
        expect(getUpdateSource(true, null)).toBe("firefox");
        expect(getUpdateSource(false, "normal")).toBe("chrome-store");
        expect(getUpdateSource(false, "development")).toBe("github");
        expect(getUpdateSource(false, null)).toBe("github");
        expect(getUpdateButton("chrome-store", true)).toBe("reload");
        expect(getUpdateButton("chrome-store", false)).toBe("open-store");
        expect(getUpdateButton("github", true)).toBe("open-store");
    });

    it("throttles checks and expires dismissals at their stated boundaries", () => {
        expect(isCheckDue(null, 0)).toBe(true);
        expect(isCheckDue({ checkedAt: 0, latest: null, source: "github" }, UPDATE_INTERVAL_MS - 1)).toBe(false);
        expect(isCheckDue({ checkedAt: 0, latest: null, source: "github" }, UPDATE_INTERVAL_MS)).toBe(true);
        expect(isDismissed({ latest: "0.2.18", dismissedAt: 0 }, "0.2.18", UPDATE_DISMISS_MS - 1)).toBe(true);
        expect(isDismissed({ latest: "0.2.18", dismissedAt: 0 }, "0.2.18", UPDATE_DISMISS_MS)).toBe(false);
        expect(isDismissed({ latest: "0.2.17", dismissedAt: 0 }, "0.2.18", 1)).toBe(false);
    });
});
