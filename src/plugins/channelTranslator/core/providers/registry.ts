/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createGoogleProvider } from "./google";
import type { HttpTransport, TranslationProvider } from "./types";

export const registry = new Map<string, (http: HttpTransport) => TranslationProvider>([
    ["google", createGoogleProvider]
]);
