/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { PLUGIN_NAME } from "../src/plugins/channelTranslator/core/types";

describe("workspace", () => {
    it("resolves core modules", () => {
        expect(PLUGIN_NAME).toBe("ChannelTranslator");
    });
});
