/*
 * Discord Translator, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

function exportedNames(source: string): Set<string> {
    const names = new Set<string>();

    for (const [, name] of source.matchAll(/\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) {
        names.add(name);
    }

    for (const [, list] of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
        for (const specifier of list.split(",")) {
            const [local, alias] = specifier.trim().split(/\s+as\s+/);
            const name = alias ?? local;
            if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
    }

    for (const [, name] of source.matchAll(/\bexport\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
        names.add(name);
    }

    return names;
}

it("keeps the browser entry point's exports aligned with src/Vencord.ts", () => {
    const sourceExports = exportedNames(readFileSync(join(process.cwd(), "src", "Vencord.ts"), "utf8"));
    const browserExports = exportedNames(readFileSync(join(process.cwd(), "browser", "Vencord.ts"), "utf8"));

    expect([...browserExports].sort()).toEqual([...sourceExports].sort());
});
