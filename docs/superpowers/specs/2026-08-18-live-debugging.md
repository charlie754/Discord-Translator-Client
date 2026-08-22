# Turn report — Stage 1 live debugging: from "nothing loads" to working translator

**Date:** 2026-08-18
**Agent seat:** Claude (architect / chair)
**Status:** Gate B substantially met — translation confirmed working in a live client
**Authority:** Operator ran the build and reported each failure with screenshots and console output.
**Predecessor:** [Stage 1 implementation](./2026-08-18-stage1-implementation.md)

## 1. Objective

Take the Stage 1 plugin from "builds cleanly" to "works in a real Discord client", using the
operator's live-run reports as the only source of truth about runtime behaviour.

## 2. Routing

Nine `codex-sol` fix dispatches, each with a five-part spec and the standing constraints (no git
commands, do not touch the clone, write files before reporting). All verification run by the chair.

## 3. Defects found, in order

Every one was found by the operator running the product. **None was visible to the automated suite.**

| # | Symptom reported | Root cause | Source of truth |
|---|---|---|---|
| 1 | Panel absent; **Equicord gone from settings** | `state.ts` read `settings.store` in module-level `const` initializers. Equicord throws there by design, and because it happened during `~plugins` evaluation it killed **every** plugin, leaving `Vencord.Api` undefined | Operator's console stack trace |
| 2 | (same run) | `ReactDOM.createRoot` does not exist — Equicord binds `ReactDOM` to `findByPropsLazy("createPortal")` and exports `createRoot` separately. Ours was the only file in the tree using the `ReactDOM.` form | Equicord `src/webpack/common/react.ts` |
| 3 | (same run) | `VencordNative.pluginHelpers.X` accessed unguarded at module top level in two files | Equicord's own `gifMaker` uses optional chaining here |
| 4 | Panel reads **"Discord updated"** | Equicord's built-in `MessageTranslate` patches the identical anchor; its replacement inserts code right after `memo(function(e){`, which breaks our `(?=let \i,\i)` lookahead. **The two plugins cannot coexist** | Both plugins' source, side by side |
| 5 | Panel stuck on **"Translating…"** | No in-flight dedup. `transformMessage` calls `requestTranslation` on every render when uncached, so a *failed* translation is re-requested forever and `pending` never returns to zero | Our own render path |
| 6 | (same run) | `pendingCount()`/`breakerOpen()` were not reactive; the panel read them once and never re-rendered | Our own Panel |
| 7 | Toggle "On", **nothing translated** | Discord message objects do not carry `guild_id`. Reading `message.guild_id` gave `undefined` → `toggle.isOn(null)` → DM rule → every message skipped before a request was made | Equicord `messageTranslate/index.tsx:36` resolves via `ChannelStore` |
| 8 | Panel clipped by window edge | Left-anchored using the *collapsed* width while `:hover` expands to 272px | Screenshot |
| 9 | Still clipped | Positioning split between inline styles and a `:host` rule beginning `all: initial` | Screenshot |
| 10 | Only the **switch** clipped | `all: unset` on `.pill` resets `box-sizing` to `content-box`, so `width:100%` + 26px padding = 226px inside a 200px shell; `overflow:hidden` clipped the rightmost element | Arithmetic on the CSS |

## 4. Features added on operator request

- On/Off switch moved into the always-visible collapsed pill (158px → 200px).
- Mode became an animated two-segment switch — both labels visible, accent indicator sliding on the
  shared `--dur-base` / `--ease`, `role="radiogroup"` with per-option `aria-checked`.
- **Triple-click** translates a whole sentence. A triple-click never re-fires `dblclick`; it fires
  `click` with `detail === 3`, which is why only the double-click's single word was translating.

## 5. Verification evidence

- `npm test` → **82 passed** (10 files)
- `npx tsc --noEmit` → silent
- `npm run build` → Equicord build succeeds, zero errors
- All 16 `:host` design tokens verified byte-identical to `F:\google map plugin` after every panel edit
- New guard `test/no-module-scope-settings.test.ts`, **mutation-proven**: appending the verbatim
  crash line to `state.ts` makes it fail and name the file; removing it restores 4/4

**Confirmed working in a live client by the operator:** whole-channel translation, per-server toggle,
double-click translation (`確認` → "confirmation"), triple-click, and the panel rendering with the
intended glass styling.

## 6. The finding that matters most

**Three consecutive runtime defects — #1, #5, #7 — shipped with 73–82 tests passing, a clean
typecheck, and a green build.** In case #7 the plugin translated *nothing at all* while every
automated signal was green.

The test suite verifies that the pure core computes correctly, and it does that well: markup
protection, caching, backoff, and the state machine are all genuinely covered, and the live endpoint
contract test proved the PUA sentinel design against the real service. What none of it could see is
whether the adapter talks to Discord correctly — because every defect lived in the seam between our
code and Equicord's runtime, and that seam has no test double.

Two habits earned their place regardless:

- **Mutation proofs.** Two "passing" guards in this codebase were inert — a template-literal regex
  where `\s` collapsed to a literal `s`, and `/E000(d+)E001/g` which never matched `\uE000`. Both
  passed while proving nothing. Every guard is now broken deliberately and watched failing.
- **Reading the reference implementation.** Defects #2, #4 and #7 were all diagnosed by opening
  Equicord's own source and comparing, not by reasoning from first principles. Guessing produced two
  wrong fixes for the panel edge; measurement produced the right one immediately.

## 7. Residual hazards

- **HIGH** — `MessageTranslate` must stay disabled. Same anchor, mutually destructive. The plugin
  should detect and warn rather than relying on the user remembering.
- **HIGH** — patch rot. Three upstream repairs in twenty days on this anchor.
- **MEDIUM** — the free `gtx` endpoint has no contract or quota. The render loop (defect #5) likely
  hammered it; a keyed provider is the durable answer.
- **MEDIUM** — the panel's chat-container selector is still a guess that happens to work.

## 8. Go / No-Go

**GO for continued personal use.** Translation works end to end in a real client.

**NO-GO for distribution** until: MessageTranslate conflict detection ships, a keyed provider
replaces the unauthenticated endpoint, and the ten-point checklist is walked start to finish.

**DO NOT START Stage 3** (the fork, three repos, code signing) before that.

## 9. Next moves

- **P0** — Detect `MessageTranslate` at start and surface a clear conflict notice.
- **P1** — Add a keyed provider (Azure F0 is free to 2M chars/month) behind the existing registry.
- **P1** — Walk the ten-point checklist and correct the chat-container selector.
- **P2** — Final whole-branch review; triage the deferred minors in the ledger.

## 10. Artefacts

- This report · [implementation report](./2026-08-18-stage1-implementation.md) ·
  [design spec](./2026-08-18-discord-channel-translator-design.md) ·
  [plan](../plans/2026-08-18-channel-translator-stage1.md)
- Ledger: `.superpowers/sdd/2026-08-18-channel-translator-stage1/progress.md`
- Commits `717838f`..`3560622`
- **WIKI N/A**
