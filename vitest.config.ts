/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        // test/live/** hits the real translate endpoint over the network. It is
        // excluded here so neither `pnpm test:unit` nor CI can ever reach it;
        // run it deliberately with `pnpm test:live` (vitest.live.config.ts).
        exclude: ["**/node_modules/**", "**/dist/**", "test/live/**"],
        environment: "node"
    }
});
