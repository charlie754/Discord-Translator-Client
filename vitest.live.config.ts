/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineConfig } from "vitest/config";

/**
 * Opt-in only. These tests make real network calls to the public translate
 * endpoint, so they are never part of the default run and never run in CI.
 * Invoke explicitly: `pnpm test:live`.
 */
export default defineConfig({
    test: {
        include: ["test/live/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/dist/**"],
        environment: "node"
    }
});
