# Design — Discord whole-channel translator

**Date:** 2026-08-18
**Status:** Draft for operator review
**Authority:** Operator brainstorming session, 2026-08-18. Decisions recorded inline.
**Grounded by:** [exploration](./2026-08-18-discord-channel-translator-exploration.md) ·
[fork teardown](./2026-08-18-equicord-fork-teardown.md)

---

## 1. Problem

People are stopped at the door of foreign-language Discord servers. Existing tooling translates one
message at a time, which is fine for a single confusing line and useless for following a
conversation.

**Goal:** flip an entire channel — including scrollback — between its original language and the
reader's language, from one control, privately, without posting anything to the channel.

## 2. Decisions locked in this session

| # | Decision | Chosen |
|---|---|---|
| D1 | Client surface | Desktop first, browser later |
| D2 | Build path | Fork Equicord — but **prove before forking** |
| D3 | Stage 1 home | `src/userplugins/` of a plain Equicord clone (gitignored upstream, glob-imported by the build, can never appear in a merge diff) |
| D4 | Toggle scope | **Per-server.** Toggle in any channel, whole server follows. Home servers untouched |
| D5 | Control surface | **Independent floating panel**, top-right of the chat area — not a button in Discord's toolbar |
| D6 | Panel behaviour | Collapsed shows `Translate · On/Off`; **expands on hover** |
| D7 | Visual style | Copy the `google map plugin` widget's design system exactly |
| D8 | Provider v1 | Free Google `gtx` endpoint, pluggable registry from day one |
| D9 | Modes | A = replace **(default)** · B = bilingual · double-click = translate selection |

## 3. Architecture

```
core/                    platform-free TypeScript · zero Discord imports · zero DOM
  detect.ts              source-language policy + short-message aggregation
  protect.ts             tokenize → placeholder → restore
  cache.ts               keyed by (contentHash, targetLang)
  scheduler.ts           batching · concurrency cap · token bucket · Retry-After backoff
  providers/             registry + capability descriptors
  modes.ts               A / B / selection state machine
adapter-equicord/        the only adapter in Stage 1
  patch.ts               two quarantined patches + startup self-test
  render.ts              prototype-preserving clone (mode A) + row append (mode B)
  panel/                 Shadow-DOM widget — zero Discord internals
  selection.ts           dblclick handler + popover
  native.ts              main-process transport
```

**The core never imports Discord, never touches the DOM, and never assumes React fiber.** The
adapter produces `RawMessage`; the core consumes it. That single rule is what makes a later browser
adapter a port instead of a rewrite (resolves the fiber-vs-DOM fork identified in the teardown).

```ts
interface RawMessage {
  id: string;
  authorId: string;
  contentHash: string;
  content: string;           // see the note below on segments vs. flat content
  channelId: string;
  guildId: string | null;
}

interface TranslationProvider {
  id: string;
  needsKey: boolean;
  translate(texts: string[], from: string | "auto", to: string): Promise<TranslateResult>;
}
```

**On `segments` vs. flat `content`** (amended 2026-08-18 after an adversarial review flagged the
divergence). An earlier draft specified `segments: TextSegment[]` so that mentions, emoji and code
survived the round trip structurally. Stage 1 ships flat `content: string` instead, because
`protect()` achieves the same guarantee by a different route: it masks every non-translatable token
to a Private Use Area sentinel before transport and restores it after, and that round trip is now
verified against the live endpoint (§9). A structured segment array would duplicate that protection
without adding a guarantee.

The desktop adapter reads `message.content` directly from Discord's own object, so segments would be
synthesised only to be flattened again. A future DOM-only browser adapter may genuinely need them,
since it extracts from rendered nodes rather than from a message object — at that point `RawMessage`
gains an optional `segments` field and `protect()` keeps working unchanged on the flat form. Recorded
here rather than left as a silent divergence between spec and code.

## 4. The panel

### 4.1 Placement and mounting

One persistent container, `position: fixed`, anchored to the top-right of the **chat content area**,
floating above it. Never a child of Discord's React tree, so no patch anchor is required and no
class-name change can break it.

Mounted inside a **Shadow DOM root** (`:host { all: initial }`). This is the load-bearing choice: it
gives complete style isolation from Discord in both directions, which is why the panel is the only
part of this product with no rot exposure.

Visibility is driven by `SelectedChannelStore`:

| Context | Panel |
|---|---|
| Guild text channel, thread, forum post | Shown |
| Friends page, settings, guild discovery | Hidden |
| DM / group DM | Hidden by default; appears only if the user opts in explicitly |

Repositions on window resize, sidebar collapse, and member-list toggle by observing the chat
container's bounding box. Collapses to icon-only below a width threshold.

### 4.2 Visual system — copied from `F:\google map plugin\extension\content\widget.js`

```css
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
--ease: cubic-bezier(0.25, 0.1, 0.25, 1);
--dur-fast: 200ms; --dur-base: 300ms; --dur-slow: 420ms;
```

Carried over verbatim: 158px collapsed shell → 272px open · 46px pill · `scale(1.025)` hover lift ·
`grid-template-rows: 0fr → 1fr` for the expand (the only way to animate to intrinsic height) ·
40×24 switch track with an 18px white thumb that widens to 22px on `:active` · accent glow
`0 0 14px rgba(62,207,142,0.35)` when on · staggered row entry at 60/110/160/210ms.

Values are **inlined, not referenced** — a shadow root does not inherit the host page's custom
properties, and we would not want Discord's `:root` anyway.

**Deviation from the reference, intentional (D6):** the Maps widget opens on click. This one opens on
**hover**. The On/Off switch remains a discrete click target inside the expanded body, so hovering
never toggles translation by accident.

### 4.3 Collapsed and expanded

```
collapsed (158px)                    expanded on hover (272px)
┌──────────────────────┐             ┌────────────────────────────────┐
│ 🌐  Translate        │             │ 🌐  Translate            [ ON ]│
│     On · 日本語→English│             │ ────────────────────────────── │
└──────────────────────┘             │  Mode      Replace  ▾          │
                                     │  From      Detect   ▾          │
                                     │  To        English  ▾          │
                                     │ ────────────────────────────── │
                                     │  Translating 12 / 40…          │
                                     └────────────────────────────────┘
```

Collapsed shows the state **in words**, not just an icon — an icon alone cannot tell you whether the
thing is currently on, which is the one fact the control exists to convey.

### 4.4 Five states

| State | Appearance | Meaning |
|---|---|---|
| **Off** | Outline globe, `--ink-muted` | Default |
| **Translating** | Globe + progress ring, count in body | Toggle just flipped, messages in flight |
| **On** | Filled globe, `--accent`, glow | Everything visible is translated |
| **Degraded** | Amber dot, tooltip names the cause | Provider throttled/failing — originals shown |
| **Unavailable** | Strikethrough globe, "Discord updated — translation disabled" | A patch stopped matching |

**Unavailable exists to fix a specific inherited failure.** Today a rotted patch produces one
`console.warn` and the UI simply is not there, so the user assumes the plugin is off and never
reports it. Our startup self-test asserts each patch matched; when one did not, the panel still
renders and says so.

Verify this in a **production** build — `ErrorBoundary.isNoop` returns `false` when `IS_DEV`, so
developers see an error card exactly where users see nothing.

### 4.5 Accessibility

Ours now, since we no longer inherit Discord's icon component: `role="switch"` with `aria-checked`,
a visible focus ring (`2px solid var(--accent)`, `outline-offset: -3px`), full keyboard operation,
and `prefers-reduced-motion` honoured on every transition above.

## 5. The three modes

### 5.1 Mode A — Replace (default)

Translated text replaces the original in place. This is the default: it reads like a native-language
channel, which is the product's whole point. Uses the memo-boundary patch with a
prototype-preserving clone:

```ts
Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content: translated })
```

The clone is handed **only** to the renderer. The store keeps the original, so copy, reply-quote,
edit-prefill and search are never corrupted, and toggling off needs no restore path.

**Hover-to-reveal-original is mandatory in this mode, not optional.** Because Mode A hides the source
text, a confidently-wrong translation is otherwise invisible — a live call had `了解` detected as
`zh-CN` at confidence `0.98828125` and rendered as "learn". Hovering a translated message swaps it
back to the original, with a subtle persistent marker (a thin `--accent` left rule) showing which
messages were rewritten. That marker is what tells a reader "this sentence is not what they typed",
and it is the difference between a translator and a forgery.

### 5.2 Mode B — Bilingual

Original untouched; the translation renders as a second row beneath it, visually subordinate
(`--ink-muted`, slightly smaller, left rule). Uses the `childrenMessageContent:` wrapper patch.

The mode to switch to when accuracy matters more than reading flow — verifying a quote, following a
technical discussion, or any channel where the reader has noticed the translation misfiring. One
dropdown click from Mode A.

### 5.3 Double-click — translate selection

`dblclick` on message text → `window.getSelection()` → translate the word or sentence → glass
popover in the same shadow root, anchored to the selection.

**Requires no patch at all**, works whether translation is on or off, and works in Discord's own
search results and pinned-message views where the render patches do not reach.

## 6. Pipeline

```
message rendered → adapter extracts RawMessage
  → cache lookup: hash(content) + targetLang        ← hit: render immediately
  → detect: is it already the target language?      ← yes: skip, no request
  → aggregate: fold consecutive short messages from one author into one request
  → protect: tokenize mentions / emoji / code / spoilers / URLs to placeholders
  → scheduler: batch · concurrency cap · token bucket
  → provider (main process via native.ts)
  → restore placeholders
  → cache write
  → render (mode A clone, or mode B appended row)
```

### 6.1 Cache

Keyed by **`hash(content) + targetLang`**, never by message ID. Ten identical messages cost one
request. LRU with a size cap, persisted so a reload does not re-translate the whole scrollback.

*Inherited defect being fixed:* `MessageTranslate` keys by message ID in an unbounded, unpersisted
`Map`, so ten identical messages cost ten calls and `Ctrl+R` re-translates everything.

### 6.2 Failure handling

Failures are **transient by default**: a per-message retry budget, exponential backoff honouring
`Retry-After`, and a circuit breaker that drops the panel to *Degraded* after N consecutive
429/403s. A message that fails is retried later; it is never permanently marked.

*Inherited defect being fixed:* every failure path — 429, 5xx, DNS, malformed JSON — currently writes
`failed.set(messageId, text)` which is never cleared except by a message edit or a client restart. A
single rate-limit burst silently and irreversibly blanks a whole screen.

### 6.3 Markup protection

Tokenize before transport, restore after: `<@id>`, `<#id>`, `<@&id>`, `<:name:id>`, `` ``` `` fences,
`` ` `` inline code, `||spoilers||`, URLs, and custom timestamps.

Not speculative — the same verifier watched a fenced code block come back with its fence widened
from three backticks to four.

### 6.4 Short-text handling

The confidence gate is provably insufficient on short CJK. Mitigations, in order:

1. **Aggregate** consecutive short messages from the same author into one request, giving the engine
   real context.
2. **Minimum-length threshold** below which a lone message is batched with neighbours rather than
   detected in isolation.
3. **Hover-to-reveal-original in Mode A** (§5.1), plus a persistent marker on every rewritten
   message, so a wrong answer is always one hover from being caught. Mode B is the escalation when
   a reader wants both rows on screen permanently.

### 6.5 Scrollback

Translate only what `MessageStore` already holds. The user's own scrolling drives Discord's native
lazy-load; we never initiate a history fetch. This is a behavioural constraint, not a symbol ban —
`RestAPI`, `MessageActions` and `MessageCache` are all reachable from the same module.

Toggling on repaints the loaded list via `MessageUpdater.updateMessage(channelId, id)` per message as
each translation lands, so the channel fills progressively instead of freezing.

## 7. Transport and secrets

Provider calls run in `native.ts` (Electron main). **Not** for CSP reasons — that hazard was refuted;
Equicord wildcards `connect-src` to `*` via a `required: true` plugin. The real reasons: one place to
hold batching, the concurrency cap and the backoff ladder, and keeping any future API key out of the
renderer.

```ts
export async function translateBatch(
  _: IpcMainInvokeEvent,
  providerId: string,
  texts: string[],
  from: string,
  to: string
): Promise<{ status: number; data: Array<{ text: string; sourceLang: string }> | string }>
```

Returns an envelope and never throws — a thrown error crosses `ipcMain.handle` only as a mangled
string.

**Key custody:** any API key goes in `native-settings.json` via `NativeSettings`, **not**
`definePluginSettings`. `settings.json` is uploaded wholesale to cloud sync with no filtering and no
exclusion API, and there is no masked field type. ⚠️ We would be the **first shipping user** of that
path; the only existing consumer is dev-only, and `reviewDB` writes a bearer token into `DataStore`,
which *is* uploaded on v2 (the default). Treat as sound-but-unprecedented and test it.

The v1 Google `gtx` provider needs no key, so this only binds when a keyed provider is added.

## 8. Privacy

Defaults inverted from the inherited plugin, which ships `autoTranslate: true` with an inert DM
filter (DMs have no `guild_id`, so its guild exclusion never fires).

- **Off by default.** Never auto-on.
- **DMs and group DMs excluded** unless explicitly opted in.
- **First-run screen names the provider** and states plainly that message text leaves the machine.
- Translation cache is **not** stored in `DataStore` — IndexedDB rides along in both `exportSettings`
  and cloud sync, which would ship the user's read history to the sync server.

## 9. Testing

- **Core:** Vitest, headless, against a fake adapter. This suite is what proves the core did not
  couple to Electron.
- **Golden markup corpus:** messages containing every protected token type, asserting byte-identical
  restore.
- **Patch self-test:** asserts each patch matched at startup, run in a **production** build.
- **Provider contract tests** against recorded fixtures, plus one live smoke test per provider.

## 10. Explicitly out of scope for v1

Translating outgoing messages · voice · OCR of images · a browser build · any fork, rebrand,
installer or code-signing work (all Stage 3).

## 11. Risks carried into implementation

| Risk | Severity | Mitigation |
|---|---|---|
| Patch rot — three repairs in twenty days on this anchor | HIGH | Both patches quarantined in one module; loud *Unavailable* state; panel and double-click keep working without them |
| Confidently-wrong short-CJK detection, hidden by Mode A being the default | HIGH | Short-message aggregation · mandatory hover-to-reveal-original · persistent marker on every rewritten message · Mode B one click away |
| Free `gtx` endpoint has no contract, SLA or quota | MEDIUM | Pluggable registry from day one; circuit breaker; keyed providers ready |
| First shipping user of `NativeSettings` | MEDIUM | Only binds when a keyed provider lands; test explicitly |
| `showMeYourName` patches the same module | LOW | Known; one Discord rename breaks both |

## 12. Open items

- Build from a clone whose `origin` points at **our** repo, or set `EQUICORD_REMOTE` / build
  `--disable-updater`. A fork built with upstream `origin` ships a binary that replaces itself with
  Equicord.
- Confirm the chat-container anchor for panel positioning against a live client.
- `git init` a dedicated repo before any code (this worktree is a branch of the `F:\` GoatCoin repo).
