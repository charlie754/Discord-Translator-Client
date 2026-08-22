# Channel Translator — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Equicord userplugin that translates an entire Discord channel — including scrollback — between its original language and the reader's language, driven by an independent floating glass panel at the top-right of the chat area.

**Architecture:** A pure, Discord-free `core/` (tokenizing, caching, batching, backoff, language policy) unit-tested headlessly with Vitest, wrapped by an Equicord adapter that owns the two webpack patches, the Shadow-DOM panel, and the Electron main-process transport. The whole plugin directory is junctioned into a plain Equicord clone's `src/userplugins/`, so our repo is the source of truth and the clone is only a build environment. No fork in Stage 1.

**Tech Stack:** TypeScript · Vitest · esbuild (via Equicord's build) · Equicord plugin API · Electron IPC · Shadow DOM

**Source spec:** [`docs/superpowers/specs/2026-08-18-discord-channel-translator-design.md`](../specs/2026-08-18-discord-channel-translator-design.md)

## Global Constraints

- **Plugin name:** `ChannelTranslator`. Directory `channelTranslator`. (Working name — rename is a find/replace across `plugin/index.tsx` and the junction target.)
- **`plugin/core/**` must never import anything Discord-related.** No `@webpack`, `@api`, `@utils`, `@components`, `discord-types`, or React. Enforced by an automated test in Task 2, not by discipline.
- **Cache key is `hash(content) + targetLang`.** Never message ID.
- **No failure is ever permanent.** Every error path is retryable. Never write a terminal "this message failed" marker.
- **No plugin-initiated fetch of message history.** Translate only what `MessageStore` already holds. `RestAPI`, `MessageActions`, and `MessageCache` are off-limits for history retrieval.
- **Clone, never mutate.** Translated text reaches the renderer only through a prototype-preserving clone. The store always keeps the original.
- **`Parser.parse` takes three arguments here:** `Parser.parse(text, true, { channelId, messageId })`. The one-argument form fails to resolve mentions, channel links and role pills.
- **Design tokens are copied verbatim** from `F:\google map plugin\extension\content\widget.js` and **inlined**, not referenced — a shadow root does not inherit the host page's custom properties.
- **Default mode is A (Replace).** Hover-to-reveal-original and the per-message rewritten-marker are mandatory in Mode A, not optional.
- **Privacy defaults:** plugin off by default; DMs and group DMs excluded unless explicitly opted in; first-run screen names the provider.
- **Build with `EQUICORD_REMOTE` set, or `--disable-updater`.** A build whose git `origin` points at Equicord produces a binary that replaces itself with Equicord.
- Node `v24.18.0`, npm `11.17.0` confirmed present. **pnpm is not installed** — Task 1 installs it via corepack.

---

## File Structure

```
F:\Discord Translator\                    ← our repo (git init in Task 1)
  .gitignore
  package.json                            npm workspace root, Vitest
  vitest.config.ts
  plugin/                                 ← junctioned into the Equicord clone
    index.tsx                             definePlugin, patches, start/stop
    settings.ts                           definePluginSettings
    patches.ts                            the two patch declarations + self-test
    render.tsx                            Mode A clone / Mode B row / hover-reveal
    selection.ts                          dblclick → selection → popover
    native.ts                             Electron main transport
    panel/
      index.tsx                           Shadow-DOM mount + React root
      styles.ts                           the inlined CSS string
      Panel.tsx                           the widget component
    core/                                 ← pure. zero Discord imports.
      types.ts                            RawMessage, TextSegment, TranslateResult
      hash.ts                             content hashing
      protect.ts                          tokenize → placeholder → restore
      cache.ts                            LRU keyed by contentHash+lang
      detect.ts                           skip-if-target + short-message aggregation
      scheduler.ts                        batching, concurrency, backoff, breaker
      modes.ts                            mode + toggle state machine
      providers/
        types.ts                          TranslationProvider interface
        google.ts                         free gtx provider (transport injected)
        registry.ts                       provider registry
  test/                                   Vitest suites
  docs/                                   specs + plans (moved here in Task 1)
  .workflow/LEDGER.md
  equicord/                               gitignored clone — build environment only
```

**Responsibility boundaries.** `core/` is a library: it takes strings and returns strings, and knows nothing about Discord, the DOM, React, or Electron. `plugin/` is the only place that knows about any of those. `panel/` is isolated further still — inside a shadow root it cannot see or be seen by Discord's CSS, which is why it is the one component with no rot exposure.

---

## Task 1: Repository, workspace, and a loading plugin

**Files:**
- Create: `F:\Discord Translator\.gitignore`
- Create: `F:\Discord Translator\package.json`
- Create: `F:\Discord Translator\vitest.config.ts`
- Create: `F:\Discord Translator\plugin\index.tsx`
- Create: `F:\Discord Translator\test\smoke.test.ts`
- Move: `docs/`, `.workflow/` out of the worktree into the repo root

**Interfaces:**
- Consumes: nothing
- Produces: a git repo, a working `npm test`, and an Equicord clone at `equicord/` with `plugin/` junctioned into `equicord/src/userplugins/channelTranslator`

- [ ] **Step 1: Initialise the repo and move the docs in**

```bash
cd "F:/Discord Translator" && git init && git config user.name "IRP_HongKong" && git config user.email "tinyiupliskin@gmail.com"
```

Then move the existing docs out of the worktree:

```bash
cp -r "F:/Discord Translator/.claude/worktrees/discord-translator-plugin-493f87/docs" "F:/Discord Translator/docs" && cp -r "F:/Discord Translator/.claude/worktrees/discord-translator-plugin-493f87/.workflow" "F:/Discord Translator/.workflow"
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
equicord/
.claude/
*.log
```

`equicord/` is ignored deliberately — it is a build environment, not our source.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "channel-translator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 4: Write `vitest.config.ts` and `tsconfig.json`**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        environment: "node"
    }
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["plugin/core/**/*", "test/**/*"]
}
```

`include` deliberately covers only `core` and `test` — the adapter references Equicord's path aliases that do not resolve outside the clone, and typechecking it here would fail for the wrong reason.

- [ ] **Step 5: Write the failing smoke test**

```ts
// test/smoke.test.ts
import { describe, expect, it } from "vitest";
import { PLUGIN_NAME } from "../plugin/core/types";

describe("workspace", () => {
    it("resolves core modules", () => {
        expect(PLUGIN_NAME).toBe("ChannelTranslator");
    });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
cd "F:/Discord Translator" && npm install && npm test
```

Expected: FAIL — `Cannot find module '../plugin/core/types'`.

- [ ] **Step 7: Create `plugin/core/types.ts` to make it pass**

```ts
// plugin/core/types.ts
export const PLUGIN_NAME = "ChannelTranslator";

/** A message as the adapter hands it to the core. The core never sees a Discord object. */
export interface RawMessage {
    id: string;
    authorId: string;
    channelId: string;
    guildId: string | null;
    content: string;
    contentHash: string;
}

export interface TranslateResult {
    text: string;
    sourceLang: string;
    confidence: number;
}
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
cd "F:/Discord Translator" && npm test
```

- [ ] **Step 9: Install pnpm and clone Equicord**

```bash
corepack enable pnpm && cd "F:/Discord Translator" && git clone https://github.com/Equicord/Equicord.git equicord && cd equicord && pnpm install --frozen-lockfile
```

- [ ] **Step 10: Sync the plugin into the clone**

Create `tools/sync-plugin.mjs`, which copies `plugin/` to
`equicord/src/userplugins/channelTranslator/`, then wire it into `package.json`:

```json
"sync":  "node tools/sync-plugin.mjs",
"build": "node tools/sync-plugin.mjs && cd equicord && npx --yes pnpm@10 build"
```

**Do not use a directory junction here.** It was the original approach and it fails: esbuild resolves
a junction to its real path, which puts the files outside the clone's `src/` tree, so Equicord's path
aliases — `@webpack/common`, `@utils/types`, `@api/*`, all scoped to `src/` — stop resolving. The
build dies with `Could not resolve "@webpack/common"` and eight siblings, while the identical files
compile cleanly once physically inside `src/`. The sync script must `rm -rf` the destination first,
or a file deleted from the source lingers in the clone and keeps compiling.

- [ ] **Step 11: Write the minimal plugin so the clone builds it**

```tsx
// plugin/index.tsx
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ChannelTranslator",
    description: "Translate a whole channel, including scrollback, with one toggle.",
    authors: [{ name: "IRP", id: 0n }],
    patches: [],

    start() {
        console.log("[ChannelTranslator] started");
    },

    stop() {
        console.log("[ChannelTranslator] stopped");
    }
});
```

- [ ] **Step 12: Build and verify the plugin is discovered**

```bash
cd "F:/Discord Translator/equicord" && pnpm build
```

Expected: build succeeds and `dist/` is emitted. Confirm discovery without launching Discord:

```bash
cd "F:/Discord Translator/equicord" && grep -c "ChannelTranslator" dist/equibop/main.js dist/*.js 2>/dev/null | grep -v ':0'
```

Expected: at least one file reports a non-zero count. A zero count everywhere means the junction is not being globbed — re-check Step 10.

- [ ] **Step 13: Commit**

```bash
cd "F:/Discord Translator" && git add -A && git commit -m "chore: repo, vitest workspace, Equicord clone junction, plugin skeleton"
```

---

## Task 2: Core isolation guard

The constraint "core never imports Discord" is worthless as a convention. This makes it mechanical.

**Files:**
- Create: `test/core-isolation.test.ts`

**Interfaces:**
- Consumes: `plugin/core/**`
- Produces: a test that fails the build if any core file gains a Discord import

- [ ] **Step 1: Write the failing test**

```ts
// test/core-isolation.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE = join(process.cwd(), "plugin", "core");

const FORBIDDEN = [
    "@webpack", "@api", "@components", "@utils", "@shared",
    "discord-types", "react", "@equicordplugins", "@plugins"
];

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
}

describe("core isolation", () => {
    it("finds core files to check", () => {
        expect(walk(CORE).length).toBeGreaterThan(0);
    });

    it("no core file imports anything Discord-related", () => {
        const offenders: string[] = [];
        for (const file of walk(CORE).filter(f => f.endsWith(".ts"))) {
            const src = readFileSync(file, "utf8");
            for (const bad of FORBIDDEN) {
                if (new RegExp(`from\\s+["'][^"']*${bad}`).test(src)) {
                    offenders.push(`${file} imports ${bad}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("detects a violation when one exists (positive control)", () => {
        const fake = `import { Foo } from "@webpack/common";`;
        const hit = FORBIDDEN.some(bad => new RegExp(`from\\s+["'][^"']*${bad}`).test(fake));
        expect(hit).toBe(true);
    });
});
```

The third test is a positive control. Without it, a broken regex would make the guard pass vacuously forever.

- [ ] **Step 2: Run it — expect PASS on a clean core**

```bash
cd "F:/Discord Translator" && npm test -- core-isolation
```

Expected: 3 passed.

- [ ] **Step 3: Prove it can fail**

Temporarily add `import { React } from "@webpack/common";` to the top of `plugin/core/types.ts`, re-run, confirm the second test FAILS, then remove the line and confirm it passes again.

- [ ] **Step 4: Commit**

```bash
cd "F:/Discord Translator" && git add test/core-isolation.test.ts && git commit -m "test: mechanical guard that core stays Discord-free"
```

---

## Task 3: Content hashing

**Files:**
- Create: `plugin/core/hash.ts`
- Test: `test/hash.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `hashContent(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/hash.test.ts
import { describe, expect, it } from "vitest";
import { hashContent } from "../plugin/core/hash";

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
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module`)

```bash
cd "F:/Discord Translator" && npm test -- hash
```

- [ ] **Step 3: Implement**

```ts
// plugin/core/hash.ts

/**
 * FNV-1a over UTF-16 code units. Not cryptographic — this is a cache key.
 * Chosen over crypto.subtle because the core must stay synchronous and
 * environment-free (it runs in a renderer, in Node under Vitest, and later
 * in a browser extension).
 */
export function hashContent(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run — expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/hash.ts test/hash.test.ts && git commit -m "feat(core): content hashing for cache keys"
```

---

## Task 4: Markup protection

The single highest-value core module. A live call to the target endpoint was observed returning a fenced code block with its fence widened from three backticks to four — this is not hypothetical.

**Files:**
- Create: `plugin/core/protect.ts`
- Test: `test/protect.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `protect(text: string): Protected` and `restore(masked: string, tokens: string[]): string`, where `interface Protected { masked: string; tokens: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// test/protect.test.ts
import { describe, expect, it } from "vitest";
import { protect, restore } from "../plugin/core/protect";

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
        const mangled = masked.replace(/\uE000(\d+)\uE001/g, " \uE000$1\uE001 ");
        expect(restore(mangled, tokens)).toContain("<@42>");
    });

    it("leaves text with no protectable tokens untouched", () => {
        const { masked, tokens } = protect("just words");
        expect(masked).toBe("just words");
        expect(tokens).toEqual([]);
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd "F:/Discord Translator" && npm test -- protect
```

- [ ] **Step 3: Implement**

```ts
// plugin/core/protect.ts

export interface Protected {
    masked: string;
    tokens: string[];
}

/**
 * Private Use Area sentinels. Chosen because machine-translation engines pass
 * unknown PUA code points through untouched, whereas bracket-style markers like
 * [[0]] get reflowed, spaced, or translated. Task 12 verifies this against the
 * live endpoint rather than trusting it.
 */
const OPEN = "\uE000";
const CLOSE = "\uE001";

/**
 * Order matters. Fenced code must be consumed before inline code, and spoilers
 * before their inner content, or the inner pattern eats part of the outer one.
 */
const PATTERNS: RegExp[] = [
    /```[\s\S]*?```/g,             // fenced code
    /\|\|[\s\S]*?\|\|/g,           // spoiler
    /`[^`\n]+`/g,                  // inline code
    /<a?:\w+:\d+>/g,               // custom / animated emoji
    /<@[!&]?\d+>/g,                // user or role mention
    /<#\d+>/g,                     // channel mention
    /<t:\d+(?::[tTdDfFR])?>/g,     // timestamp
    /https?:\/\/\S+/g              // url
];

export function protect(text: string): Protected {
    const tokens: string[] = [];
    let masked = text;

    for (const pattern of PATTERNS) {
        masked = masked.replace(pattern, match => {
            tokens.push(match);
            return `${OPEN}${tokens.length - 1}${CLOSE}`;
        });
    }

    return { masked, tokens };
}

export function restore(masked: string, tokens: string[]): string {
    // Match ONLY the sentinel. Never absorb surrounding whitespace: an earlier
    // draft consumed it with \s* and re-emitted a single space, which turned
    // newlines inside multi-line messages into spaces. Whitespace the engine
    // inserts beside a sentinel is harmless and stays where it lands.
    return masked.replace(
        new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"),
        (whole, index: string) => {
            const token = tokens[Number(index)];
            return token === undefined ? whole : token;
        }
    );
}
```

- [ ] **Step 4: Run — expect PASS (12 tests)**

If the "adds spaces" test fails on exact spacing, that is the test doing its job: adjust `restore`, not the test's intent.

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/protect.ts test/protect.test.ts && git commit -m "feat(core): tokenize-protect-restore for Discord markup"
```

---

## Task 5: Translation cache

**Files:**
- Create: `plugin/core/cache.ts`
- Test: `test/cache.test.ts`

**Interfaces:**
- Consumes: `hashContent` from `plugin/core/hash.ts`
- Produces: `class TranslationCache` with `get(hash: string, lang: string): CacheEntry | undefined`, `set(hash: string, lang: string, entry: CacheEntry): void`, `size: number`, `serialise(): string`, `static deserialise(json: string, max?: number): TranslationCache`. `interface CacheEntry { text: string; sourceLang: string; confidence: number }`

- [ ] **Step 1: Write the failing test**

```ts
// test/cache.test.ts
import { describe, expect, it } from "vitest";
import { TranslationCache } from "../plugin/core/cache";

const entry = (text: string) => ({ text, sourceLang: "ja", confidence: 0.9 });

describe("TranslationCache", () => {
    it("returns undefined for a miss", () => {
        expect(new TranslationCache(10).get("abc", "en")).toBeUndefined();
    });

    it("stores and retrieves by hash and language", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        expect(c.get("abc", "en")?.text).toBe("hello");
    });

    it("treats the same hash with a different target language as a miss", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        expect(c.get("abc", "fr")).toBeUndefined();
    });

    it("serves ten identical messages from one entry", () => {
        const c = new TranslationCache(10);
        c.set("samehash", "en", entry("hello"));
        for (let i = 0; i < 10; i++) expect(c.get("samehash", "en")?.text).toBe("hello");
        expect(c.size).toBe(1);
    });

    it("evicts the least recently used entry past the cap", () => {
        const c = new TranslationCache(2);
        c.set("a", "en", entry("A"));
        c.set("b", "en", entry("B"));
        c.get("a", "en");                  // 'a' is now most recent
        c.set("c", "en", entry("C"));      // evicts 'b'
        expect(c.get("a", "en")).toBeDefined();
        expect(c.get("b", "en")).toBeUndefined();
        expect(c.get("c", "en")).toBeDefined();
    });

    it("survives a serialise / deserialise round trip", () => {
        const c = new TranslationCache(10);
        c.set("abc", "en", entry("hello"));
        const revived = TranslationCache.deserialise(c.serialise(), 10);
        expect(revived.get("abc", "en")?.text).toBe("hello");
    });

    it("deserialises garbage into an empty cache rather than throwing", () => {
        expect(TranslationCache.deserialise("not json", 10).size).toBe(0);
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// plugin/core/cache.ts

export interface CacheEntry {
    text: string;
    sourceLang: string;
    confidence: number;
}

/**
 * LRU keyed by contentHash + targetLang — never by message id. Ten messages
 * with identical text cost one translation, and the cache survives a reload
 * so toggling on does not re-translate the whole scrollback from scratch.
 */
export class TranslationCache {
    private map = new Map<string, CacheEntry>();

    constructor(private readonly max: number = 5000) {}

    private static key(hash: string, lang: string): string {
        return `${hash}:${lang}`;
    }

    get(hash: string, lang: string): CacheEntry | undefined {
        const k = TranslationCache.key(hash, lang);
        const hit = this.map.get(k);
        if (hit === undefined) return undefined;
        // Re-insert to mark as most recently used.
        this.map.delete(k);
        this.map.set(k, hit);
        return hit;
    }

    set(hash: string, lang: string, entry: CacheEntry): void {
        const k = TranslationCache.key(hash, lang);
        if (this.map.has(k)) this.map.delete(k);
        this.map.set(k, entry);
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) break;
            this.map.delete(oldest);
        }
    }

    get size(): number {
        return this.map.size;
    }

    serialise(): string {
        return JSON.stringify([...this.map.entries()]);
    }

    static deserialise(json: string, max = 5000): TranslationCache {
        const cache = new TranslationCache(max);
        try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) return cache;
            for (const pair of parsed) {
                if (Array.isArray(pair) && typeof pair[0] === "string") {
                    cache.map.set(pair[0], pair[1] as CacheEntry);
                }
            }
        } catch {
            // A corrupt cache is not an error condition — start empty.
        }
        return cache;
    }
}
```

- [ ] **Step 4: Run — expect PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/cache.ts test/cache.test.ts && git commit -m "feat(core): LRU translation cache keyed by content hash"
```

---

## Task 6: Language policy and short-message aggregation

Directly targets the observed failure where `了解` was detected as `zh-CN` at confidence `0.98828125` and rendered as "learn". A confidence gate alone does not catch this; context does.

**Files:**
- Create: `plugin/core/detect.ts`
- Test: `test/detect.test.ts`

**Interfaces:**
- Consumes: `RawMessage` from `plugin/core/types.ts`
- Produces: `shouldTranslate(msg, targetLang, knownSourceLang?): boolean`, `aggregate(messages: RawMessage[], opts?: AggregateOptions): Batch[]`, `interface Batch { messages: RawMessage[]; joined: string }`, `SHORT_TEXT_THRESHOLD: number`, `splitJoined(translated: string, count: number): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// test/detect.test.ts
import { describe, expect, it } from "vitest";
import { aggregate, shouldTranslate, splitJoined, SHORT_TEXT_THRESHOLD } from "../plugin/core/detect";
import type { RawMessage } from "../plugin/core/types";

const msg = (id: string, content: string, authorId = "u1"): RawMessage => ({
    id, authorId, channelId: "c1", guildId: "g1", content, contentHash: `h${id}`
});

describe("shouldTranslate", () => {
    it("translates when the source language is unknown", () => {
        expect(shouldTranslate(msg("1", "こんにちは"), "en")).toBe(true);
    });

    it("skips when the known source already equals the target", () => {
        expect(shouldTranslate(msg("1", "hello"), "en", "en")).toBe(false);
    });

    it("treats en-GB and en as the same language", () => {
        expect(shouldTranslate(msg("1", "hello"), "en", "en-GB")).toBe(false);
    });

    it("skips empty and whitespace-only messages", () => {
        expect(shouldTranslate(msg("1", "   "), "en")).toBe(false);
    });
});

describe("aggregate", () => {
    it("groups consecutive short messages from one author", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい"), msg("3", "うん")]);
        expect(batches.length).toBe(1);
        expect(batches[0].messages.length).toBe(3);
    });

    it("does not group across different authors", () => {
        const batches = aggregate([msg("1", "了解", "u1"), msg("2", "はい", "u2")]);
        expect(batches.length).toBe(2);
    });

    it("does not group long messages", () => {
        const long = "x".repeat(SHORT_TEXT_THRESHOLD + 1);
        const batches = aggregate([msg("1", long), msg("2", long)]);
        expect(batches.length).toBe(2);
    });

    it("caps a group at the max group size", () => {
        const many = Array.from({ length: 12 }, (_, i) => msg(String(i), "はい"));
        const batches = aggregate(many, { maxGroup: 5 });
        expect(batches.every(b => b.messages.length <= 5)).toBe(true);
    });

    it("joins grouped text with a separator that survives round-trip", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい")]);
        expect(batches[0].joined).toContain("了解");
        expect(batches[0].joined).toContain("はい");
    });

    it("returns one batch per message when nothing groups", () => {
        const long = "x".repeat(SHORT_TEXT_THRESHOLD + 1);
        expect(aggregate([msg("1", long)]).length).toBe(1);
    });
});

describe("splitJoined", () => {
    it("splits a translated group back into its parts", () => {
        const batches = aggregate([msg("1", "了解"), msg("2", "はい")]);
        const fake = batches[0].joined.replace("了解", "Understood").replace("はい", "Yes");
        const parts = splitJoined(fake, 2);
        expect(parts.length).toBe(2);
        expect(parts[0]).toContain("Understood");
        expect(parts[1]).toContain("Yes");
    });

    it("falls back to one blob when the separator was destroyed", () => {
        const parts = splitJoined("all one line no separator", 3);
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe("all one line no separator");
        expect(parts[1]).toBe("");
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// plugin/core/detect.ts
import type { RawMessage } from "./types";

/**
 * Below this length a message carries too little signal for reliable language
 * detection. Observed failure: 了解 detected as zh-CN at 0.988 confidence and
 * rendered "learn". Aggregating neighbours gives the engine real context.
 */
export const SHORT_TEXT_THRESHOLD = 12;

/** Newline-separated numbering survives MT far better than bare newlines. */
const SEPARATOR = "\n\u2029\n";

export interface Batch {
    messages: RawMessage[];
    joined: string;
}

export interface AggregateOptions {
    maxGroup?: number;
    threshold?: number;
}

function baseLang(tag: string): string {
    return tag.toLowerCase().split("-")[0];
}

export function shouldTranslate(
    msg: RawMessage,
    targetLang: string,
    knownSourceLang?: string
): boolean {
    if (msg.content.trim().length === 0) return false;
    if (knownSourceLang && baseLang(knownSourceLang) === baseLang(targetLang)) return false;
    return true;
}

export function aggregate(messages: RawMessage[], opts: AggregateOptions = {}): Batch[] {
    const maxGroup = opts.maxGroup ?? 8;
    const threshold = opts.threshold ?? SHORT_TEXT_THRESHOLD;
    const batches: Batch[] = [];
    let current: RawMessage[] = [];

    const flush = () => {
        if (current.length === 0) return;
        batches.push({
            messages: current,
            joined: current.map(m => m.content).join(SEPARATOR)
        });
        current = [];
    };

    for (const msg of messages) {
        const isShort = msg.content.length <= threshold;
        const sameAuthor = current.length > 0 && current[0].authorId === msg.authorId;

        if (!isShort) {
            flush();
            batches.push({ messages: [msg], joined: msg.content });
            continue;
        }
        if (current.length > 0 && (!sameAuthor || current.length >= maxGroup)) flush();
        current.push(msg);
    }
    flush();

    return batches;
}

export function splitJoined(translated: string, count: number): string[] {
    if (count <= 1) return [translated];
    const parts = translated.split(SEPARATOR).map(p => p.trim());
    if (parts.length === count) return parts;
    // The engine destroyed the separator. Return the whole blob for the first
    // message and blanks for the rest rather than silently misattributing text.
    return [translated, ...Array<string>(count - 1).fill("")];
}
```

- [ ] **Step 4: Run — expect PASS (13 tests)**

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/detect.ts test/detect.test.ts && git commit -m "feat(core): language policy and short-message aggregation"
```

---

## Task 7: Scheduler — batching, concurrency, backoff, circuit breaker

Replaces the inherited plugin's behaviour where any failure writes a permanent marker that is never cleared.

**Files:**
- Create: `plugin/core/scheduler.ts`
- Test: `test/scheduler.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class Scheduler` with `constructor(opts: SchedulerOptions)`, `run<T>(fn: () => Promise<T>): Promise<T>`, `get state(): "closed" | "open"`, `reset(): void`. `interface SchedulerOptions { concurrency: number; maxRetries: number; baseDelayMs: number; breakerThreshold: number; sleep?: (ms: number) => Promise<void> }`. Errors carry `interface RetryableError extends Error { status?: number; retryAfterMs?: number }`

- [ ] **Step 1: Write the failing test**

```ts
// test/scheduler.test.ts
import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "../plugin/core/scheduler";

const noSleep = () => Promise.resolve();

const opts = {
    concurrency: 2, maxRetries: 3, baseDelayMs: 10,
    breakerThreshold: 3, sleep: noSleep
};

describe("Scheduler", () => {
    it("returns a successful result", async () => {
        const s = new Scheduler(opts);
        await expect(s.run(async () => "ok")).resolves.toBe("ok");
    });

    it("never exceeds the concurrency cap", async () => {
        const s = new Scheduler({ ...opts, concurrency: 2 });
        let active = 0, peak = 0;
        await Promise.all(Array.from({ length: 8 }, () => s.run(async () => {
            active++; peak = Math.max(peak, active);
            await new Promise(r => setTimeout(r, 5));
            active--;
        })));
        expect(peak).toBeLessThanOrEqual(2);
    });

    it("retries a failing call and succeeds", async () => {
        const s = new Scheduler(opts);
        let calls = 0;
        const result = await s.run(async () => {
            if (++calls < 3) throw Object.assign(new Error("boom"), { status: 500 });
            return "recovered";
        });
        expect(result).toBe("recovered");
        expect(calls).toBe(3);
    });

    it("gives up after maxRetries and rejects", async () => {
        const s = new Scheduler({ ...opts, breakerThreshold: 99 });
        await expect(
            s.run(async () => { throw Object.assign(new Error("nope"), { status: 500 }); })
        ).rejects.toThrow("nope");
    });

    it("honours retryAfterMs on a 429", async () => {
        // The parameter must be declared, or vi.fn infers a []-args tuple and
        // `sleep.mock.calls.map(c => c[0])` fails to typecheck.
        const sleep = vi.fn((ms: number) => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep });
        let calls = 0;
        await s.run(async () => {
            if (++calls === 1) {
                throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 1234 });
            }
            return "ok";
        });
        expect(sleep).toHaveBeenCalledWith(1234);
    });

    it("backs off exponentially when no Retry-After is given", async () => {
        // The parameter must be declared, or vi.fn infers a []-args tuple and
        // `sleep.mock.calls.map(c => c[0])` fails to typecheck.
        const sleep = vi.fn((ms: number) => Promise.resolve());
        const s = new Scheduler({ ...opts, sleep, breakerThreshold: 99 });
        await s.run(async () => {
            throw Object.assign(new Error("x"), { status: 500 });
        }).catch(() => undefined);
        const delays = sleep.mock.calls.map(c => c[0] as number);
        expect(delays[1]).toBeGreaterThan(delays[0]);
    });

    it("opens the breaker after consecutive failures", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        for (let i = 0; i < 3; i++) {
            await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
                .catch(() => undefined);
        }
        expect(s.state).toBe("open");
    });

    it("rejects immediately while the breaker is open", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 1 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
            .catch(() => undefined);
        const spy = vi.fn(async () => "never");
        await expect(s.run(spy)).rejects.toThrow(/breaker/i);
        expect(spy).not.toHaveBeenCalled();
    });

    it("closes the breaker on reset and works again", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 1 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 429 }); })
            .catch(() => undefined);
        s.reset();
        expect(s.state).toBe("closed");
        await expect(s.run(async () => "back")).resolves.toBe("back");
    });

    it("a success clears the consecutive-failure count", async () => {
        const s = new Scheduler({ ...opts, maxRetries: 0, breakerThreshold: 3 });
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 500 }); })
            .catch(() => undefined);
        await s.run(async () => "ok");
        await s.run(async () => { throw Object.assign(new Error("x"), { status: 500 }); })
            .catch(() => undefined);
        expect(s.state).toBe("closed");
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// plugin/core/scheduler.ts

export interface RetryableError extends Error {
    status?: number;
    retryAfterMs?: number;
}

export interface SchedulerOptions {
    concurrency: number;
    maxRetries: number;
    baseDelayMs: number;
    breakerThreshold: number;
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Every failure here is transient. There is deliberately no terminal
 * "this message failed" state — the inherited plugin had one and a single
 * rate-limit burst permanently blanked a whole screen of messages.
 */
export class Scheduler {
    private active = 0;
    private queue: Array<() => void> = [];
    private consecutiveFailures = 0;
    private open = false;

    constructor(private readonly opts: SchedulerOptions) {}

    get state(): "closed" | "open" {
        return this.open ? "open" : "closed";
    }

    reset(): void {
        this.open = false;
        this.consecutiveFailures = 0;
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.open) throw new Error("Circuit breaker is open");
        await this.acquire();
        try {
            const result = await this.attempt(fn);
            this.consecutiveFailures = 0;
            return result;
        } catch (err) {
            this.consecutiveFailures++;
            if (this.consecutiveFailures >= this.opts.breakerThreshold) this.open = true;
            throw err;
        } finally {
            this.release();
        }
    }

    private async attempt<T>(fn: () => Promise<T>): Promise<T> {
        const sleep = this.opts.sleep ?? defaultSleep;
        let lastError: unknown;

        for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (attempt === this.opts.maxRetries) break;
                const e = err as RetryableError;
                const delay = e.retryAfterMs ?? this.opts.baseDelayMs * 2 ** attempt;
                await sleep(delay);
            }
        }
        throw lastError;
    }

    private acquire(): Promise<void> {
        if (this.active < this.opts.concurrency) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this.queue.push(() => { this.active++; resolve(); });
        });
    }

    private release(): void {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
    }
}
```

- [ ] **Step 4: Run — expect PASS (10 tests)**

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/scheduler.ts test/scheduler.test.ts && git commit -m "feat(core): scheduler with concurrency cap, backoff and circuit breaker"
```

---

## Task 8: Provider interface and the Google gtx provider

The provider is pure: HTTP transport is injected, so it is fully testable without a network.

**Files:**
- Create: `plugin/core/providers/types.ts`
- Create: `plugin/core/providers/google.ts`
- Create: `plugin/core/providers/registry.ts`
- Test: `test/providers.test.ts`

**Interfaces:**
- Consumes: `TranslateResult` from `plugin/core/types.ts`
- Produces: `interface HttpTransport { (url: string): Promise<{ status: number; body: string; retryAfterMs?: number }> }`; `interface TranslationProvider { id: string; label: string; needsKey: boolean; translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> }`; `createGoogleProvider(http: HttpTransport): TranslationProvider`; `registry: Map<string, (http: HttpTransport) => TranslationProvider>`

- [ ] **Step 1: Write the failing test**

```ts
// test/providers.test.ts
import { describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "../plugin/core/providers/google";
import { registry } from "../plugin/core/providers/registry";
import type { HttpTransport } from "../plugin/core/providers/types";

/** Shape observed from the live gtx endpoint with dj=1. */
const okBody = JSON.stringify({
    sentences: [{ trans: "Hello", orig: "こんにちは" }],
    src: "ja",
    confidence: 0.98
});

const okHttp: HttpTransport = async () => ({ status: 200, body: okBody });

describe("google provider", () => {
    it("translates one string", async () => {
        const p = createGoogleProvider(okHttp);
        const [result] = await p.translate(["こんにちは"], "auto", "en");
        expect(result.text).toBe("Hello");
        expect(result.sourceLang).toBe("ja");
        expect(result.confidence).toBeCloseTo(0.98);
    });

    it("declares that it needs no API key", () => {
        expect(createGoogleProvider(okHttp).needsKey).toBe(false);
    });

    it("puts the target language in the request url", async () => {
        const http = vi.fn(okHttp);
        await createGoogleProvider(http).translate(["hi"], "auto", "fr");
        expect(http.mock.calls[0][0]).toContain("tl=fr");
    });

    it("url-encodes the query text", async () => {
        const http = vi.fn(okHttp);
        await createGoogleProvider(http).translate(["a b&c"], "auto", "en");
        expect(http.mock.calls[0][0]).toContain("a%20b%26c");
    });

    it("joins multi-sentence responses", async () => {
        const http: HttpTransport = async () => ({
            status: 200,
            body: JSON.stringify({
                sentences: [{ trans: "One. " }, { trans: "Two." }],
                src: "ja", confidence: 0.9
            })
        });
        const [r] = await createGoogleProvider(http).translate(["x"], "auto", "en");
        expect(r.text).toBe("One. Two.");
    });

    it("throws a RetryableError carrying the status on a 429", async () => {
        const http: HttpTransport = async () => ({ status: 429, body: "", retryAfterMs: 2000 });
        await expect(
            createGoogleProvider(http).translate(["x"], "auto", "en")
        ).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
    });

    it("throws on malformed json rather than returning junk", async () => {
        const http: HttpTransport = async () => ({ status: 200, body: "<html>nope" });
        await expect(
            createGoogleProvider(http).translate(["x"], "auto", "en")
        ).rejects.toThrow();
    });

    it("defaults confidence to 0 when the field is absent", async () => {
        const http: HttpTransport = async () => ({
            status: 200,
            body: JSON.stringify({ sentences: [{ trans: "Hi" }], src: "ja" })
        });
        const [r] = await createGoogleProvider(http).translate(["x"], "auto", "en");
        expect(r.confidence).toBe(0);
    });
});

describe("registry", () => {
    it("contains the google provider", () => {
        expect(registry.has("google")).toBe(true);
    });

    it("constructs a provider from the registry", () => {
        const make = registry.get("google")!;
        expect(make(okHttp).id).toBe("google");
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the three files**

```ts
// plugin/core/providers/types.ts
import type { TranslateResult } from "../types";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/** Injected so the core stays environment-free and fully testable offline. */
export type HttpTransport = (url: string) => Promise<HttpResponse>;

export interface TranslationProvider {
    id: string;
    label: string;
    needsKey: boolean;
    translate(texts: string[], from: string, to: string): Promise<TranslateResult[]>;
}
```

```ts
// plugin/core/providers/google.ts
import type { TranslateResult } from "../types";
import type { HttpTransport, TranslationProvider } from "./types";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

/**
 * The free, unauthenticated gtx endpoint. No key, no contract, no SLA — which
 * is exactly why the provider registry exists. Do NOT adopt Vencord's shared
 * hardcoded key: channel-scale traffic would risk revoking it for everyone.
 */
export function createGoogleProvider(http: HttpTransport): TranslationProvider {
    return {
        id: "google",
        label: "Google (free)",
        needsKey: false,

        async translate(texts: string[], from: string, to: string): Promise<TranslateResult[]> {
            const results: TranslateResult[] = [];
            for (const text of texts) {
                const url =
                    `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(from)}` +
                    `&tl=${encodeURIComponent(to)}&dt=t&dj=1&q=${encodeURIComponent(text)}`;

                const res = await http(url);
                if (res.status !== 200) {
                    throw Object.assign(new Error(`google: HTTP ${res.status}`), {
                        status: res.status,
                        retryAfterMs: res.retryAfterMs
                    });
                }

                const parsed = JSON.parse(res.body) as {
                    sentences?: Array<{ trans?: string }>;
                    src?: string;
                    confidence?: number;
                };
                if (!Array.isArray(parsed.sentences)) {
                    throw new Error("google: response had no sentences array");
                }

                results.push({
                    text: parsed.sentences.map(s => s.trans ?? "").join(""),
                    sourceLang: parsed.src ?? "auto",
                    confidence: parsed.confidence ?? 0
                });
            }
            return results;
        }
    };
}
```

```ts
// plugin/core/providers/registry.ts
import { createGoogleProvider } from "./google";
import type { HttpTransport, TranslationProvider } from "./types";

export const registry = new Map<string, (http: HttpTransport) => TranslationProvider>([
    ["google", createGoogleProvider]
]);
```

- [ ] **Step 4: Run — expect PASS (10 tests)**

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/providers test/providers.test.ts && git commit -m "feat(core): provider interface, registry and Google gtx provider"
```

---

## Task 9: Mode and toggle state machine

**Files:**
- Create: `plugin/core/modes.ts`
- Test: `test/modes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Mode = "replace" | "bilingual"`; `type PanelState = "off" | "translating" | "on" | "degraded" | "unavailable"`; `class ToggleState` with `isOn(guildId): boolean`, `setOn(guildId, on): void`, `panelState(ctx: PanelContext): PanelState`. `interface PanelContext { guildId: string | null; patchesOk: boolean; breakerOpen: boolean; pending: number }`

- [ ] **Step 1: Write the failing test**

```ts
// test/modes.test.ts
import { describe, expect, it } from "vitest";
import { ToggleState } from "../plugin/core/modes";

const ctx = (over: Partial<Parameters<ToggleState["panelState"]>[0]> = {}) => ({
    guildId: "g1", patchesOk: true, breakerOpen: false, pending: 0, ...over
});

describe("ToggleState", () => {
    it("is off for an unknown server", () => {
        expect(new ToggleState().isOn("g1")).toBe(false);
    });

    it("remembers per server, not per channel", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.isOn("g1")).toBe(true);
        expect(t.isOn("g2")).toBe(false);
    });

    it("treats a null guild (DM) as always off", () => {
        const t = new ToggleState();
        t.setOn(null, true);
        expect(t.isOn(null)).toBe(false);
    });

    it("reports unavailable when patches did not match, whatever else is true", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ patchesOk: false }))).toBe("unavailable");
    });

    it("reports off when the server is not toggled on", () => {
        expect(new ToggleState().panelState(ctx())).toBe("off");
    });

    it("reports translating while work is pending", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ pending: 3 }))).toBe("translating");
    });

    it("reports degraded when the breaker is open", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ breakerOpen: true }))).toBe("degraded");
    });

    it("degraded outranks translating", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx({ breakerOpen: true, pending: 5 }))).toBe("degraded");
    });

    it("reports on when toggled on with nothing pending", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(t.panelState(ctx())).toBe("on");
    });

    it("round-trips through serialise and deserialise", () => {
        const t = new ToggleState();
        t.setOn("g1", true);
        expect(ToggleState.deserialise(t.serialise()).isOn("g1")).toBe(true);
    });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```ts
// plugin/core/modes.ts

export type Mode = "replace" | "bilingual";

export type PanelState = "off" | "translating" | "on" | "degraded" | "unavailable";

export interface PanelContext {
    guildId: string | null;
    patchesOk: boolean;
    breakerOpen: boolean;
    pending: number;
}

/**
 * Per-server, not per-channel (design D4): you join a foreign server, toggle
 * once, and every channel in it follows. DMs are never on — translating a DM
 * would ship someone's private message to a third party.
 */
export class ToggleState {
    private servers = new Set<string>();

    isOn(guildId: string | null): boolean {
        if (guildId === null) return false;
        return this.servers.has(guildId);
    }

    setOn(guildId: string | null, on: boolean): void {
        if (guildId === null) return;
        if (on) this.servers.add(guildId);
        else this.servers.delete(guildId);
    }

    panelState(ctx: PanelContext): PanelState {
        if (!ctx.patchesOk) return "unavailable";
        if (!this.isOn(ctx.guildId)) return "off";
        if (ctx.breakerOpen) return "degraded";
        if (ctx.pending > 0) return "translating";
        return "on";
    }

    serialise(): string {
        return JSON.stringify([...this.servers]);
    }

    static deserialise(json: string): ToggleState {
        const state = new ToggleState();
        try {
            const parsed = JSON.parse(json);
            if (Array.isArray(parsed)) {
                for (const id of parsed) if (typeof id === "string") state.servers.add(id);
            }
        } catch {
            // Corrupt state is not an error — start with everything off.
        }
        return state;
    }
}
```

- [ ] **Step 4: Run — expect PASS (10 tests)**

- [ ] **Step 5: Run the whole core suite and typecheck**

```bash
cd "F:/Discord Translator" && npm test && npm run typecheck
```

Expected: all suites pass, no type errors. **The core is now complete and provably Discord-free.**

- [ ] **Step 6: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/core/modes.ts test/modes.test.ts && git commit -m "feat(core): per-server toggle and five-state panel machine"
```

---

## Task 10: Main-process transport

**Files:**
- Create: `plugin/native.ts`

**Interfaces:**
- Consumes: `HttpResponse` shape from `plugin/core/providers/types.ts`
- Produces: `fetchTranslation(_: IpcMainInvokeEvent, url: string): Promise<HttpResponse>`, reachable from the renderer as `Native.fetchTranslation(url)`

- [ ] **Step 1: Write it**

Any file named `native.ts` inside a plugin directory is bundled into the Electron main process and its exports become IPC handlers. The first parameter is always the Electron event.

```ts
// plugin/native.ts
import type { IpcMainInvokeEvent } from "electron";

export interface HttpResponse {
    status: number;
    body: string;
    retryAfterMs?: number;
}

/**
 * All provider traffic runs here, in the main process. Not for CSP reasons —
 * Equicord wildcards connect-src via a required plugin. The reasons are: one
 * place to hold transport concerns, and keeping any future API key out of the
 * renderer where every other plugin could read it.
 *
 * Never throws. A thrown error crosses ipcMain.handle only as a mangled string,
 * so failures come back as a status the renderer can reason about.
 */
export async function fetchTranslation(
    _: IpcMainInvokeEvent,
    url: string
): Promise<HttpResponse> {
    try {
        const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const body = await res.text();

        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;

        return {
            status: res.status,
            body,
            retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined
        };
    } catch (err) {
        return { status: 0, body: String(err) };
    }
}
```

- [ ] **Step 2: Verify it compiles into the build**

```bash
cd "F:/Discord Translator/equicord" && pnpm build && grep -c "fetchTranslation" dist/*.js dist/**/*.js 2>/dev/null | grep -v ':0'
```

Expected: a non-zero count in at least one emitted file.

- [ ] **Step 3: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/native.ts && git commit -m "feat(adapter): main-process translation transport"
```

---

## Task 11: Settings

**Files:**
- Create: `plugin/settings.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `settings` (the `definePluginSettings` result) exporting keys `targetLanguage`, `mode`, `provider`, `includeDMs`, `consentGiven`, `serverState`, `cacheBlob`

- [ ] **Step 1: Write it**

```ts
// plugin/settings.ts
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    targetLanguage: {
        type: OptionType.STRING,
        description: "Language to translate into (BCP-47, e.g. en, zh-TW, ja)",
        default: "en"
    },
    mode: {
        type: OptionType.SELECT,
        description: "How translations are shown",
        options: [
            { label: "Replace the original", value: "replace", default: true },
            { label: "Show both languages", value: "bilingual" }
        ]
    },
    provider: {
        type: OptionType.SELECT,
        description: "Translation provider",
        options: [{ label: "Google (free)", value: "google", default: true }]
    },
    includeDMs: {
        type: OptionType.BOOLEAN,
        description: "Also translate direct messages (sends private messages to the provider)",
        default: false
    },
    consentGiven: {
        type: OptionType.BOOLEAN,
        description: "First-run notice acknowledged",
        default: false,
        hidden: true
    },
    serverState: {
        type: OptionType.STRING,
        description: "Which servers have translation on (managed by the panel)",
        default: "[]",
        hidden: true
    },
    cacheBlob: {
        type: OptionType.STRING,
        description: "Persisted translation cache (managed automatically)",
        default: "[]",
        hidden: true
    }
});
```

`serverState` and `cacheBlob` are single string keys rather than nested records. `SettingsStore.notifyListeners` re-fires the top-level listener for `plugins.*` paths, so `settings.use(["serverState"])` re-renders correctly when the panel writes to it.

- [ ] **Step 2: Verify the build still succeeds**

```bash
cd "F:/Discord Translator/equicord" && pnpm build
```

- [ ] **Step 3: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/settings.ts && git commit -m "feat(adapter): plugin settings with privacy-safe defaults"
```

---

## Task 12: Live endpoint contract test

Proves the two assumptions the whole pipeline rests on: that PUA sentinels survive machine translation, and that the response shape is what Task 8 parses. Run explicitly, never in CI.

**Files:**
- Create: `test/live/endpoint.live.test.ts`
- Modify: `vitest.config.ts` (exclude `test/live` from the default run)

**Interfaces:**
- Consumes: `createGoogleProvider`, `protect`, `restore`
- Produces: nothing consumed by later tasks — this is a contract check

- [ ] **Step 1: Exclude live tests from the default run**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        exclude: ["test/live/**"],
        environment: "node"
    }
});
```

Add to `package.json` scripts: `"test:live": "vitest run --config vitest.live.config.ts"`, and create `vitest.live.config.ts` with `include: ["test/live/**/*.test.ts"]` and no `exclude`.

- [ ] **Step 2: Write the live test**

```ts
// test/live/endpoint.live.test.ts
import { describe, expect, it } from "vitest";
import { createGoogleProvider } from "../../plugin/core/providers/google";
import { protect, restore } from "../../plugin/core/protect";
import type { HttpTransport } from "../../plugin/core/providers/types";

const realHttp: HttpTransport = async url => {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    return { status: res.status, body: await res.text() };
};

const provider = createGoogleProvider(realHttp);

describe("live gtx endpoint contract", () => {
    it("returns the sentences/src/confidence shape we parse", async () => {
        const [r] = await provider.translate(["こんにちは"], "auto", "en");
        expect(r.text.length).toBeGreaterThan(0);
        expect(r.sourceLang).toBe("ja");
    }, 20_000);

    it("passes PUA sentinels through untouched — the load-bearing assumption", async () => {
        const { masked, tokens } = protect("こんにちは <@123456789> さん");
        const [r] = await provider.translate([masked], "auto", "en");
        const restored = restore(r.text, tokens);
        expect(restored).toContain("<@123456789>");
    }, 20_000);

    it("does not corrupt a protected code fence", async () => {
        const input = "これを見て:\n```js\nconst a = 1;\n```";
        const { masked, tokens } = protect(input);
        const [r] = await provider.translate([masked], "auto", "en");
        expect(restore(r.text, tokens)).toContain("```js\nconst a = 1;\n```");
    }, 20_000);

    it("documents the known short-CJK misdetection rather than asserting it away", async () => {
        const [r] = await provider.translate(["了解"], "auto", "en");
        // Observed 2026-08-18: src=zh-CN, confidence 0.988, text "learn".
        // This test records reality; it is not a pass/fail gate on quality.
        console.log(`[contract] 了解 -> "${r.text}" src=${r.sourceLang} conf=${r.confidence}`);
        expect(typeof r.text).toBe("string");
    }, 20_000);
});
```

- [ ] **Step 3: Run it**

```bash
cd "F:/Discord Translator" && npm run test:live
```

Expected: the first three pass. **If test 2 or 3 fails, stop and change the sentinel format in `protect.ts`** — the whole markup-protection design depends on it, and finding out here is far cheaper than finding out from a user.

- [ ] **Step 4: Confirm the default run still excludes live tests**

```bash
cd "F:/Discord Translator" && npm test
```

Expected: live tests do not appear in the output.

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add test/live vitest.config.ts vitest.live.config.ts package.json && git commit -m "test: live endpoint contract for sentinel survival and response shape"
```

---

## Task 13: The two patches and the startup self-test

**Files:**
- Create: `plugin/patches.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CHANNEL_TRANSLATOR_PATCHES` (a `Patch[]`), `patchesOk(): boolean`, `markPatchHit(id: "clone" | "wrap"): void`

- [ ] **Step 1: Write it**

```ts
// plugin/patches.ts
import type { Patch } from "@utils/types";

/**
 * Both patches target the same webpack module. This anchor has been repaired
 * three times in twenty days upstream, and showMeYourName patches the same
 * module — so one Discord rename breaks two plugins at once.
 *
 * Everything about this file is quarantined: if either patch stops matching,
 * the panel and the double-click translator keep working and the UI says so.
 */

const hits = { clone: false, wrap: false };

export function markPatchHit(id: "clone" | "wrap"): void {
    hits[id] = true;
}

export function patchesOk(): boolean {
    return hits.clone && hits.wrap;
}

export const CHANNEL_TRANSLATOR_PATCHES: Patch[] = [
    {
        find: '.CUSTOM_GIFT?""',
        replacement: [
            {
                // Mode A: swap a prototype-preserving clone in at the memo boundary,
                // so Discord's own renderer parses markdown, mentions and emoji.
                match: /\i\.memo\(function\((\i)\)\{(?=let \i,\i)/,
                replace: "$&$1.message=$self.transformMessage($1?.message);"
            },
            {
                // Mode B: wrap the content slot so a translated row can be appended.
                match: /childrenMessageContent:(\i),/g,
                replace:
                    "childrenMessageContent:$self.wrapContent($1,arguments[0]?.message?.id," +
                    "arguments[0]?.message?.channel_id),"
            }
        ]
    }
];
```

The optional chaining on `arguments[0]?.message?.id` is deliberate. The upstream version dereferences `arguments[0].message.id` unguarded under a global `/g` flag, so every rewritten call site in that module throws if its props lack a `message` — the shape of a crash already fixed once upstream.

- [ ] **Step 2: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/patches.ts && git commit -m "feat(adapter): quarantined patches with hit tracking"
```

---

## Task 14: Render — Mode A, hover-to-reveal, and the rewritten marker

**Files:**
- Create: `plugin/render.tsx`

**Interfaces:**
- Consumes: `TranslationCache`, `ToggleState`, `hashContent`, `markPatchHit`, `settings`
- Produces: `transformMessage(message: any): any`, `wrapContent(content: any, messageId: string, channelId: string): any`, `setHoverRevealed(messageId: string | null): void`

- [ ] **Step 1: Write it**

```tsx
// plugin/render.tsx
import { Parser } from "@webpack/common";

import { hashContent } from "./core/hash";
import { markPatchHit } from "./patches";
import { settings } from "./settings";
import { cache, entryForMessage, requestTranslation, toggle } from "./state";

/** The message whose original is currently being revealed by hover, if any. */
let revealed: string | null = null;

export function setHoverRevealed(messageId: string | null): void {
    revealed = messageId;
}

/**
 * Mode A. Returns a prototype-preserving CLONE with translated content.
 * The clone is handed only to the renderer; the store keeps the original, so
 * copy, reply-quote, edit-prefill and search are never corrupted and toggling
 * off needs no restore path.
 */
export function transformMessage(message: any): any {
    markPatchHit("clone");
    if (!message?.content) return message;
    if (settings.store.mode !== "replace") return message;
    if (!toggle.isOn(message.guild_id ?? null)) return message;
    if (revealed === message.id) return message;

    const hash = hashContent(message.content);
    const hit = cache.get(hash, settings.store.targetLanguage);

    if (!hit) {
        requestTranslation(message);
        return message;
    }
    // Already showing the translation — do not feed it back as a new original.
    if (message.content === hit.text) return message;

    return Object.assign(
        Object.create(Object.getPrototypeOf(message)),
        message,
        { content: hit.text }
    );
}

/**
 * Mode B, and the rewritten-marker in Mode A. Discord passes the already
 * rendered content node; we return it wrapped rather than walking its children,
 * which is what keeps mentions, emoji and code blocks intact.
 */
export function wrapContent(content: any, messageId: string, channelId: string): any {
    markPatchHit("wrap");
    if (!messageId) return content;

    const mode = settings.store.mode;
    const target = settings.store.targetLanguage;
    const entry = entryForMessage(messageId);
    if (!entry) return content;

    if (mode === "bilingual") {
        return (
            <>
                {content}
                <div
                    className="ct-translated-row"
                    onMouseEnter={() => setHoverRevealed(messageId)}
                    onMouseLeave={() => setHoverRevealed(null)}
                >
                    {/* Three-argument form is required: without the context object,
                        mentions, channel links and role pills do not resolve. */}
                    {Parser.parse(entry.text, true, { channelId, messageId })}
                </div>
            </>
        );
    }

    // Mode A: mark the message as rewritten and make hover reveal the original.
    return (
        <span
            className="ct-rewritten"
            title={`Translated to ${target} — hover to see the original`}
            onMouseEnter={() => setHoverRevealed(messageId)}
            onMouseLeave={() => setHoverRevealed(null)}
        >
            {content}
        </span>
    );
}
```

`entryForMessage` is imported at module scope, not via `require()`. The bundle is ESM — a dynamic
`require` would be undefined at runtime. `render.tsx` importing `state.ts` is safe because `state.ts`
never imports `render.tsx`.

- [ ] **Step 2: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/render.tsx && git commit -m "feat(adapter): Mode A clone, Mode B row, hover-reveal and rewritten marker"
```

---

## Task 15: Plugin state wiring

**Files:**
- Create: `plugin/state.ts`

**Interfaces:**
- Consumes: every core module, `plugin/native.ts`, `plugin/settings.ts`
- Produces: `cache`, `toggle`, `scheduler`, `requestTranslation(message: any): void`, `entryForMessage(messageId: string)`, `repaintChannel(channelId: string): void`, `pendingCount(): number`, `breakerOpen(): boolean`

- [ ] **Step 1: Write it**

```ts
// plugin/state.ts
import { updateMessage } from "@api/MessageUpdater";
import { MessageStore } from "@webpack/common";

import { TranslationCache } from "./core/cache";
import { aggregate, shouldTranslate, splitJoined } from "./core/detect";
import { hashContent } from "./core/hash";
import { ToggleState } from "./core/modes";
import { protect, restore } from "./core/protect";
import { registry } from "./core/providers/registry";
import type { HttpTransport } from "./core/providers/types";
import { Scheduler } from "./core/scheduler";
import { settings } from "./settings";

const Native = VencordNative.pluginHelpers.ChannelTranslator as {
    fetchTranslation(url: string): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};

const http: HttpTransport = url => Native.fetchTranslation(url);

export const cache = TranslationCache.deserialise(settings.store.cacheBlob, 5000);
export const toggle = ToggleState.deserialise(settings.store.serverState);
export const scheduler = new Scheduler({
    concurrency: 3,
    maxRetries: 3,
    baseDelayMs: 500,
    breakerThreshold: 5
});

/** messageId -> contentHash, so the render layer can find a cache entry cheaply. */
const messageHashes = new Map<string, string>();
let pending = 0;

export function pendingCount(): number {
    return pending;
}

export function breakerOpen(): boolean {
    return scheduler.state === "open";
}

export function entryForMessage(messageId: string) {
    const hash = messageHashes.get(messageId);
    if (!hash) return undefined;
    return cache.get(hash, settings.store.targetLanguage);
}

export function persist(): void {
    settings.store.cacheBlob = cache.serialise();
    settings.store.serverState = toggle.serialise();
}

export function requestTranslation(message: any): void {
    const target = settings.store.targetLanguage;
    const hash = hashContent(message.content);
    messageHashes.set(message.id, hash);

    if (cache.get(hash, target)) return;

    const raw = {
        id: message.id,
        authorId: message.author?.id ?? "",
        channelId: message.channel_id,
        guildId: message.guild_id ?? null,
        content: message.content,
        contentHash: hash
    };
    if (!shouldTranslate(raw, target)) return;

    const provider = registry.get(settings.store.provider)?.(http);
    if (!provider) return;

    pending++;
    void scheduler
        .run(async () => {
            const { masked, tokens } = protect(raw.content);
            const [result] = await provider.translate([masked], "auto", target);
            return { text: restore(result.text, tokens), result };
        })
        .then(({ text, result }) => {
            cache.set(hash, target, {
                text,
                sourceLang: result.sourceLang,
                confidence: result.confidence
            });
            persist();
            repaintMessage(raw.channelId, raw.id);
        })
        .catch(() => {
            // Deliberately no terminal failure marker. The message is simply
            // untranslated for now and will be retried on the next render pass.
        })
        .finally(() => {
            pending--;
        });
}

/**
 * Repaint what is already on screen. Toggling the flag alone changes nothing,
 * because Discord has no reason to re-render messages it already painted.
 * We never fetch history — the user's own scrolling drives Discord's lazy-load.
 */
export function repaintChannel(channelId: string): void {
    const loaded = MessageStore.getMessages(channelId);
    const messages: any[] = loaded?.toArray?.() ?? [];
    const batches = aggregate(
        messages.map(m => ({
            id: m.id,
            authorId: m.author?.id ?? "",
            channelId,
            guildId: m.guild_id ?? null,
            content: m.content ?? "",
            contentHash: hashContent(m.content ?? "")
        }))
    );
    for (const batch of batches) {
        for (const m of batch.messages) {
            const original = messages.find(x => x.id === m.id);
            if (original) requestTranslation(original);
        }
    }
    for (const m of messages) repaintMessage(channelId, m.id);
}

function repaintMessage(channelId: string, messageId: string): void {
    try {
        updateMessage(channelId, messageId);
    } catch {
        // A message not currently mounted cannot be updated. It repaints on the
        // next natural render. Degraded, not broken — and deliberately caught,
        // because upstream's equivalent uses a non-null assertion that throws.
    }
}

export { splitJoined };
```

- [ ] **Step 2: Build and confirm no import errors**

```bash
cd "F:/Discord Translator/equicord" && pnpm build
```

- [ ] **Step 3: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/state.ts && git commit -m "feat(adapter): wire core to Discord state, transport and repaint"
```

---

## Task 16: The panel — Shadow DOM, glass style, hover to expand

**Files:**
- Create: `plugin/panel/styles.ts`
- Create: `plugin/panel/Panel.tsx`
- Create: `plugin/panel/index.tsx`

**Interfaces:**
- Consumes: `ToggleState`, `settings`, `pendingCount`, `breakerOpen`, `patchesOk`, `repaintChannel`
- Produces: `mountPanel(): void`, `unmountPanel(): void`

- [ ] **Step 1: Write `styles.ts` — tokens copied verbatim from the Maps widget**

```ts
// plugin/panel/styles.ts

/**
 * Design vocabulary lifted from F:\google map plugin\extension\content\widget.js
 * so the two products read as one hand. Values are INLINED rather than
 * referenced because a shadow root does not inherit the host page's custom
 * properties — and we would not want Discord's :root anyway.
 */
export const PANEL_CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
  contain: layout style;
}

* { box-sizing: border-box; }

:host {
  --glass-bg: rgba(28, 26, 38, 0.62);
  --glass-border: rgba(255, 255, 255, 0.13);
  --glass-blur: 16px;
  --glass-radius: 14px;
  --glass-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
  --glass-shadow-hover: 0 18px 44px rgba(0, 0, 0, 0.55);
  --ink-cream: #f0e6d2;
  --ink-muted: #a99f8c;
  --accent: #3ecf8e;
  --accent-ink: #0e2419;
  --switch-off: #4a4557;
  --warn: #e0a23c;
  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --dur-fast: 200ms;
  --dur-base: 300ms;
  --dur-slow: 420ms;
}

.shell {
  width: 158px;
  background: var(--glass-bg);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--glass-radius);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  overflow: hidden;
  color: var(--ink-cream);
  transition:
    width var(--dur-base) var(--ease),
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}

/* Hover expands, per design D6. The Maps widget opens on click; this one does
   not, so the On/Off switch stays a discrete click target inside the body and
   passing the mouse over the panel can never toggle a whole server. */
.shell:hover { width: 272px; box-shadow: var(--glass-shadow-hover); }

.pill {
  all: unset;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 13px;
  cursor: default;
}

.globe { flex: 0 0 20px; width: 20px; height: 20px; color: var(--ink-muted);
  transition: color var(--dur-base) var(--ease); }
.shell[data-state="on"] .globe { color: var(--accent); }
.shell[data-state="degraded"] .globe { color: var(--warn); }
.shell[data-state="unavailable"] .globe { color: var(--ink-muted); opacity: 0.5; }

.text { display: flex; flex-direction: column; min-width: 0; white-space: nowrap; }
.title { font-size: 13px; font-weight: 600; }
.state { font-size: 10.5px; color: var(--ink-muted); }

/* 0fr -> 1fr is the only way to transition to an intrinsic height. */
.body { display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-base) var(--ease); }
.shell:hover .body { grid-template-rows: 1fr; }
.body > div { overflow: hidden; }
.pad { padding: 2px 13px 13px; }
.rule { height: 0.5px; background: var(--glass-border); margin: 0 0 10px; }

.row { display: flex; align-items: center; justify-content: space-between;
  padding: 7px 0; opacity: 0; transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease); }
.shell:hover .row { opacity: 1; transform: none; }
.shell:hover .row:nth-child(1) { transition-delay: 60ms; }
.shell:hover .row:nth-child(2) { transition-delay: 110ms; }
.shell:hover .row:nth-child(3) { transition-delay: 160ms; }
.shell:hover .row:nth-child(4) { transition-delay: 210ms; }

.label { font-size: 12px; color: var(--ink-muted); }

.track { all: unset; width: 40px; height: 24px; border-radius: 12px;
  background: var(--switch-off); position: relative; cursor: pointer;
  transition: background var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease); }
.track[aria-checked="true"] { background: var(--accent);
  box-shadow: 0 0 14px rgba(62, 207, 142, 0.35); }
.track:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.thumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: left var(--dur-base) var(--ease); }
.track[aria-checked="true"] .thumb { left: 19px; }
.track:active .thumb { width: 22px; }

select { all: unset; font-size: 12px; color: var(--ink-cream); cursor: pointer;
  background: rgba(0,0,0,0.25); padding: 3px 7px; border-radius: 7px; }
select option { background: #1c1a26; color: var(--ink-cream); }

@media (prefers-reduced-motion: reduce) {
  .shell, .body, .row, .track, .thumb { transition: none !important; }
}
`;
```

- [ ] **Step 2: Write `Panel.tsx`**

```tsx
// plugin/panel/Panel.tsx
import { SelectedChannelStore, SelectedGuildStore, useStateFromStores } from "@webpack/common";

import { PanelState } from "../core/modes";
import { patchesOk } from "../patches";
import { settings } from "../settings";
import { breakerOpen, pendingCount, repaintChannel, toggle, persist } from "../state";

const STATE_LABEL: Record<PanelState, string> = {
    off: "Off",
    translating: "Translating…",
    on: "On",
    degraded: "Rate limited",
    unavailable: "Discord updated"
};

export function Panel() {
    const channelId = useStateFromStores([SelectedChannelStore], () =>
        SelectedChannelStore.getChannelId());
    const guildId = useStateFromStores([SelectedGuildStore], () =>
        SelectedGuildStore.getGuildId());
    const store = settings.use(["targetLanguage", "mode", "serverState"]);

    if (!channelId || !guildId) return null;

    const state = toggle.panelState({
        guildId,
        patchesOk: patchesOk(),
        breakerOpen: breakerOpen(),
        pending: pendingCount()
    });
    const isOn = toggle.isOn(guildId);

    const flip = () => {
        toggle.setOn(guildId, !isOn);
        persist();
        repaintChannel(channelId);
    };

    return (
        <div className="shell" data-state={state}>
            <div className="pill">
                <svg className="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
                <div className="text">
                    <span className="title">Translate</span>
                    <span className="state">
                        {STATE_LABEL[state]}
                        {state === "on" ? ` · ${store.targetLanguage}` : ""}
                    </span>
                </div>
            </div>

            <div className="body"><div><div className="pad">
                <div className="rule" />

                <div className="row">
                    <span className="label">Translate this server</span>
                    <button
                        className="track"
                        role="switch"
                        aria-checked={isOn}
                        aria-label="Translate this server"
                        disabled={state === "unavailable"}
                        onClick={flip}
                    >
                        <span className="thumb" />
                    </button>
                </div>

                <div className="row">
                    <span className="label">Mode</span>
                    <select
                        value={store.mode}
                        onChange={e => { settings.store.mode = e.currentTarget.value; }}
                    >
                        <option value="replace">Replace</option>
                        <option value="bilingual">Both languages</option>
                    </select>
                </div>

                <div className="row">
                    <span className="label">To</span>
                    <select
                        value={store.targetLanguage}
                        onChange={e => {
                            settings.store.targetLanguage = e.currentTarget.value;
                            repaintChannel(channelId);
                        }}
                    >
                        {["en", "zh-TW", "zh-CN", "ja", "ko", "es", "fr", "de"].map(l => (
                            <option key={l} value={l}>{l}</option>
                        ))}
                    </select>
                </div>

                {state === "unavailable" && (
                    <div className="row">
                        <span className="label">
                            Discord changed. Translation is paused; double-click still works.
                        </span>
                    </div>
                )}
            </div></div></div>
        </div>
    );
}
```

- [ ] **Step 3: Write `index.tsx` — the shadow-root mount**

```tsx
// plugin/panel/index.tsx
import { React, ReactDOM } from "@webpack/common";

import { Panel } from "./Panel";
import { PANEL_CSS } from "./styles";

const HOST_ID = "channel-translator-host";
let root: any = null;
let reposition: (() => void) | null = null;

export function mountPanel(): void {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const mountPoint = document.createElement("div");
    shadow.appendChild(mountPoint);

    root = ReactDOM.createRoot(mountPoint);
    root.render(<Panel />);

    // Anchor to the top-right of the chat area rather than the window, so the
    // panel moves correctly when the member list or sidebar is toggled.
    reposition = () => {
        const chat = document.querySelector('[class*="chatContent"], main[class*="chatContent"]')
            ?? document.querySelector("main");
        const box = chat?.getBoundingClientRect();
        host.style.top = `${(box?.top ?? 60) + 12}px`;
        host.style.left = `${(box?.right ?? window.innerWidth) - 158 - 20}px`;
    };
    reposition();
    window.addEventListener("resize", reposition);
}

export function unmountPanel(): void {
    if (reposition) window.removeEventListener("resize", reposition);
    reposition = null;
    root?.unmount();
    root = null;
    document.getElementById(HOST_ID)?.remove();
}
```

- [ ] **Step 4: Build**

```bash
cd "F:/Discord Translator/equicord" && pnpm build
```

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/panel && git commit -m "feat(panel): shadow-DOM glass panel with hover-to-expand"
```

---

## Task 17: Double-click selection translation

Needs no patch, so it keeps working even when the render patches rot.

**Files:**
- Create: `plugin/selection.ts`

**Interfaces:**
- Consumes: `registry`, `protect`, `restore`, `scheduler`, `settings`
- Produces: `installSelectionHandler(): void`, `removeSelectionHandler(): void`

- [ ] **Step 1: Write it**

```ts
// plugin/selection.ts
import { protect, restore } from "./core/protect";
import { registry } from "./core/providers/registry";
import type { HttpTransport } from "./core/providers/types";
import { settings } from "./settings";
import { scheduler } from "./state";

const POPOVER_ID = "channel-translator-popover";

const Native = VencordNative.pluginHelpers.ChannelTranslator as {
    fetchTranslation(url: string): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};
const http: HttpTransport = url => Native.fetchTranslation(url);

async function onDoubleClick(event: MouseEvent): Promise<void> {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    // Only act inside message content, never in the composer or the sidebar.
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[id^="chat-messages-"], [class*="messageContent"]')) return;

    showPopover(event.clientX, event.clientY, "…");

    const provider = registry.get(settings.store.provider)?.(http);
    if (!provider) return;

    try {
        const translated = await scheduler.run(async () => {
            const { masked, tokens } = protect(text);
            const [result] = await provider.translate([masked], "auto", settings.store.targetLanguage);
            return restore(result.text, tokens);
        });
        showPopover(event.clientX, event.clientY, translated);
    } catch {
        showPopover(event.clientX, event.clientY, "Translation unavailable");
    }
}

function showPopover(x: number, y: number, text: string): void {
    document.getElementById(POPOVER_ID)?.remove();

    const host = document.createElement("div");
    host.id = POPOVER_ID;
    host.style.cssText = `position:fixed;left:${x}px;top:${y + 14}px;z-index:2147483001;`;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .pop {
          max-width: 320px;
          padding: 9px 12px;
          font: 13px/1.45 -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
          color: #f0e6d2;
          background: rgba(28, 26, 38, 0.62);
          border: 0.5px solid rgba(255, 255, 255, 0.13);
          border-radius: 14px;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
          backdrop-filter: blur(16px) saturate(1.3);
          -webkit-backdrop-filter: blur(16px) saturate(1.3);
        }
      </style>
      <div class="pop"></div>`;
    // textContent, not innerHTML — never inject message text as markup.
    shadow.querySelector(".pop")!.textContent = text;

    const dismiss = () => { host.remove(); document.removeEventListener("mousedown", dismiss); };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

export function installSelectionHandler(): void {
    document.addEventListener("dblclick", onDoubleClick);
}

export function removeSelectionHandler(): void {
    document.removeEventListener("dblclick", onDoubleClick);
    document.getElementById(POPOVER_ID)?.remove();
}
```

- [ ] **Step 2: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/selection.ts && git commit -m "feat(adapter): double-click selection translation, no patch required"
```

---

## Task 18: Assemble the plugin, add first-run consent, verify end to end

**Files:**
- Modify: `plugin/index.tsx` (replace the Task 1 skeleton entirely)

**Interfaces:**
- Consumes: everything
- Produces: the shipped plugin

- [ ] **Step 1: Replace `plugin/index.tsx`**

```tsx
// plugin/index.tsx
import { showNotice, popNotice } from "@api/Notices";
import definePlugin from "@utils/types";

import { mountPanel, unmountPanel } from "./panel";
import { CHANNEL_TRANSLATOR_PATCHES, patchesOk } from "./patches";
import { transformMessage, wrapContent } from "./render";
import { installSelectionHandler, removeSelectionHandler } from "./selection";
import { settings } from "./settings";

export default definePlugin({
    name: "ChannelTranslator",
    description:
        "Translate a whole channel, including scrollback, with one toggle. " +
        "Message text is sent to your chosen translation provider.",
    authors: [{ name: "IRP", id: 0n }],
    settings,
    patches: CHANNEL_TRANSLATOR_PATCHES,

    transformMessage,
    wrapContent,

    start() {
        if (!settings.store.consentGiven) {
            showNotice(
                "ChannelTranslator sends message text to Google Translate. " +
                "Direct messages are excluded unless you opt in. Enable translation " +
                "per-server from the panel at the top right.",
                "Understood",
                () => {
                    settings.store.consentGiven = true;
                    popNotice();
                }
            );
        }

        mountPanel();
        installSelectionHandler();

        // The patches register lazily on first render, so check after the UI settles.
        // Console-only failure is what makes a rotted patch invisible; this is loud.
        setTimeout(() => {
            if (!patchesOk()) {
                showNotice(
                    "ChannelTranslator: Discord changed and channel translation is paused. " +
                    "Double-click translation still works.",
                    "OK",
                    () => popNotice()
                );
            }
        }, 15_000);
    },

    stop() {
        removeSelectionHandler();
        unmountPanel();
    }
});
```

- [ ] **Step 2: Full build and static verification**

```bash
cd "F:/Discord Translator/equicord" && pnpm build && grep -c "ChannelTranslator" dist/equibop/main.js | grep -v '^0$'
```

Expected: build succeeds, non-zero count.

- [ ] **Step 3: Run the whole test suite and typecheck**

```bash
cd "F:/Discord Translator" && npm test && npm run typecheck
```

Expected: every suite passes, no type errors.

- [ ] **Step 4: Manual verification in a live client**

Install stock **Equibop**, then Settings → Developer Settings → Equicord Location → point at
`F:\Discord Translator\equicord\dist`. Launch and confirm, reporting what you actually see on screen
rather than what you expect:

1. The glass panel appears at the top-right of the chat area, reading `Translate · Off`.
2. Hovering it expands to 272px with the switch, mode and language rows staggering in.
3. The panel is absent on the Friends page and in DMs.
4. Toggling on in a foreign-language server translates the visible scrollback in place.
5. Switching to another channel in the same server keeps translation on.
6. Switching to a different server shows it off.
7. Hovering a translated message reveals the original.
8. Switching mode to "Both languages" shows original and translation on separate rows.
9. Double-clicking a word in any message shows the glass popover with a translation.
10. Toggling off restores every original immediately.

- [ ] **Step 5: Commit**

```bash
cd "F:/Discord Translator" && git add plugin/index.tsx && git commit -m "feat: assemble ChannelTranslator with consent notice and patch self-test"
```

---

## Self-review notes

**Spec coverage.** §3 architecture → Tasks 1–9. §4 panel → Task 16. §4.4 five states → Task 9 + 16.
§4.5 accessibility → Task 16 (`role="switch"`, `aria-checked`, focus ring, reduced-motion). §5.1
Mode A + hover-reveal + marker → Task 14. §5.2 Mode B → Task 14. §5.3 double-click → Task 17.
§6 pipeline → Tasks 4–8, 15. §6.1 cache → Task 5. §6.2 failure handling → Task 7. §6.3 markup →
Task 4 + 12. §6.4 short text → Task 6. §6.5 scrollback → Task 15. §7 transport → Task 10.
§8 privacy → Task 11 + 18. §9 testing → Tasks 2, 12, 18.

**Deferred, deliberately.** §7 `NativeSettings` key custody is not implemented because the v1 Google
provider needs no key. It binds when a keyed provider is added; the `needsKey` flag on
`TranslationProvider` is the hook.

**Known gap to close during execution.** Task 16's chat-container selector
(`[class*="chatContent"]`) is a guess against Discord's live DOM and is the one place in this plan
not backed by a verified source read. Confirm it in step 4 of Task 18 and correct it there.
