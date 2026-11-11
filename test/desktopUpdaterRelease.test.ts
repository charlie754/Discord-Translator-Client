/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";

import { getReleaseInfo } from "../src/main/updater/release";

const GIT_HASH = "a".repeat(40);
const RELEASE_HASH = "b".repeat(40);

describe("desktop updater release metadata", () => {
    it("builds the compare path from the release SHA instead of HEAD", () => {
        expect(getReleaseInfo(GIT_HASH, `Discord Translator ${RELEASE_HASH}`)?.comparePath)
            .toBe(`/compare/${GIT_HASH}...${RELEASE_HASH}`);
    });

    it("rejects a release name without a 40-hex SHA", () => {
        expect(getReleaseInfo(GIT_HASH, "Discord Translator not-a-commit")).toBeNull();
    });

    it("detects when the release SHA equals the installed SHA", () => {
        expect(getReleaseInfo(GIT_HASH, `Discord Translator ${GIT_HASH}`)?.isCurrent).toBe(true);
    });
});
