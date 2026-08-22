# Turn report — Equicord fork: source-level teardown & revised build sequence

**Date:** 2026-08-18
**Agent seat:** Claude (architect / chair)
**Status:** Partial — ground truth complete, build sequence proposed, awaiting operator approval
**Authority:** Operator selected "Fork Equicord — your own client" (this session).
**Predecessor:** [2026-08-18-discord-channel-translator-exploration.md](./2026-08-18-discord-channel-translator-exploration.md)

## 1. Objective

Establish source-level ground truth on what an Equicord fork actually inherits, so the design is
written against measured facts rather than assumptions. Six dimensions: `MessageTranslate` teardown,
upstream rebase burden, distribution/install, HeaderBar toggle, provider transport & secrets,
strip/brand/licence.

## 2. Plan / routing

Workflow `wf_31edf415-24f`: 12 agents, 2 phases, 0 errors, ~1.51M subagent tokens, 558 tool calls,
~29 min. Six source-level researchers → six refute-by-default verifiers. **15 claims REFUTED.**

Repo read at pinned SHA `d48e3d7bfc9731deda7654a82b8898b6e032dd16` (2026-08-17T13:19:03Z).

## 3. What changed

No product code. This report and a ledger update are the artifacts.

## 4. Verification evidence

### 4.1 `MessageTranslate` — verdict: **REWRITE**

Not at `src/plugins/` as assumed — it lives at `src/equicordplugins/messageTranslate/`, **378 lines
across 5 files**, no `native.ts`.

**Worth keeping (~30 lines):** the `find: '.CUSTOM_GIFT?""'` anchor, the two replacement regexes, the
prototype-preserving clone, and the `wrapContent` subtext render. Re-deriving that interception point
from scratch would cost days.

**Disqualifying for our product — every item verified against source:**

| Defect | Evidence |
|---|---|
| **No toggle UI at all.** Its own description string claiming "per-channel toggles" is false — it is a global comma-separated ignore list | `index.tsx:53`; 11 settings, all global |
| **Cache keyed by message ID, not text.** Ten identical messages = ten API calls. Unbounded, no TTL, no LRU, unpersisted — Ctrl+R re-translates the entire scrollback | `translationCache = new Map<string, CachedTranslation>()` |
| **Every failure is permanent.** 429, 5xx, DNS, CSP block, malformed JSON all land in one catch → `failed.set(messageId, text)`, never cleared except by a message edit or restart | `catch (e) { logger.error(…); failed.set(messageId, text); return null; }` |
| **No batching, no backoff, no retry, no concurrency cap.** One GET per message, fired from render | `utils/translate.ts` |
| **Zero markup handling** for mentions, custom emoji, spoilers, code fences, embeds, forwarded snapshots | no tokenizer in the file |
| **Privacy default is wrong.** `autoTranslate` defaults true; DMs have no `guild_id` so the guild filter is inert; no consent flow → enabling it ships every DM you read to Google unannounced | settings.ts |
| **`wrapContent` lost its ErrorBoundary** on 2026-07-28 — the exact function worth keeping is now unguarded, so a throw takes out message rendering | commit `4b1c3eea` deletes `ErrorBoundary.wrap(…, { noop: true })` |

**Patch rot is worse than advertised.** The memo-boundary technique shipped 2026-07-08, crashed,
was repaired the next day, and again on 07-28 — **three repairs in twenty days**. `showMeYourName`
patches the same `.CUSTOM_GIFT?""` module, so one Discord rename breaks two plugins.

**Live endpoint behaviour — a verifier made 8 real GETs** to
`translate.googleapis.com/translate_a/single?client=gtx`:

- All returned HTTP 200 with `confidence` present, so the fail-open worry is theoretical.
- **`了解` was mis-detected as `zh-CN` at confidence 0.98828125 and rendered "learn".** The
  confidence gate passes confidently-wrong detections on short CJK. Directly load-bearing for this
  product.
- A fenced code block came back with the fence widened from three backticks to four.
- Mentions, custom-emoji tags, spoiler bars and query-string URLs all round-tripped intact.

### 4.2 Two traps that silently replace our product with Equicord

1. **Auto-updater self-poisoning.** `gitRemote` is baked at build time from
   `git remote get-url origin` (`scripts/build/common.mjs:233-240`), and the updater hunts an asset
   literally named `desktop.asar`. A fork built from a clone whose origin still points upstream
   produces a binary that polls **Equicord's** releases and installs **Equicord's** asar over our
   client. Mitigation: set `EQUICORD_REMOTE`, or build `--disable-updater`.
2. **Equilotl's `equicord.org` fallbacks.** `constants.go` carries two non-GitHub URLs (both live,
   HTTP 200) used only when GitHub returns 401/403/429 — i.e. exactly when a user is rate-limited.
   Rebrand the `api.github.com` URLs, leave the fallbacks, and it passes every test then silently
   installs upstream Equicord over our translator in the field.

### 4.3 Inherited security liabilities

- **`connect-src` is wildcarded to `*` on every Equicord desktop install.** `EquicordHelper` is
  `required: true` and its whole `native.ts` body is `CspPolicies["*"] = CSPSrc;`, and
  `globNativesPlugin` statically imports every plugin `native.ts` regardless of enablement.
  This **refutes** the earlier "CSP blocks the translator" hazard and replaces it with a worse one.
- **`userpluginInstaller.dev`'s natives register as live `ipcMain` channels in production builds** —
  including `initPluginInstall`, which git-clones an arbitrary repo into the plugins dir.
  `globNativesPlugin` applies no target filter, though `globPlugins` does. Any file dropped into
  `src/userplugins/*/native.ts` gets main-process code with no consent and no review.
- **`settings.json` is uploaded wholesale to cloud sync**, with no filtering and no exclusion API,
  and there is no password/masked field type. `reviewDB` already writes a bearer token into
  `DataStore`, which **is** uploaded on v2 (the default). There is no secret-handling precedent in
  the tree to copy — only a live counter-example.

### 4.4 Distribution

It is **three repos**, not one: Equicord (mod), **Equilotl** (Go installer, **68 days with zero
commits**), Equibop (standalone app).

- **Windows installer is unsigned** — verified from the binary itself (`STATUS: NotSigned`, same
  SHA256 reproduced by the verifier). Every Windows user hits a browser download warning plus
  SmartScreen "Windows protected your PC" and must click More info → Run anyway.
- **macOS is signed and notarized — with Equicord's certificate, not ours.** We need our own Apple
  Developer identity (~$99/yr) or macOS users get a Gatekeeper block.
- **Forking on GitHub fires Equicord's release pipeline.** `build.yml`'s upload step is **not**
  repo-guarded (the very next step is). Two more repos are in the pipeline (Equibored, Equibuilds),
  and `publish.yml` carries Chrome/Firefox/Edge store credentials. Workflows must be deleted or
  rewritten on day one.
- **A zero-fork beta path exists today.** Ship a zipped `dist/`; testers install stock Equibop and
  set Settings → Developer Settings → Equicord Location. Verified: plain `pnpm build` emits
  `dist/equibop/main.js`, which is exactly what `State.store.equicordDir` validates.
  Caveat: `ensureVencordFiles()` early-returns on a custom dir, so there is **no update path** —
  every tester update is a manual redistribution.

### 4.5 Maintenance burden

- **12–16 h/month** if `src/plugins/` is kept pristine; **~25–30 h/month** if we diverge into it.
- Caveat the verifier proved: Equicord itself diverges heavily from Vencord inside `src/plugins`
  (172 files, 9,237 lines) and merges anyway at ~3-day cadence with one maintainer — so the
  "keep it pristine because that is why Equicord's merges are cheap" reasoning is **not** supported
  by the evidence, even if the advice is sound on first principles.
- **Break-window tail is the risk, not the median.** Merged-PR distribution: 3.11-day median but
  **33-day mean, 18.8-day p75, 489-day max**; only 59% land inside five days.
- **Version skew stacks three deep.** Equicord main is `1.15.1.0`, Vencord main is `1.15.2`.
  Our lag = upstream lag + Equicord lag + ours.
- **No build-time plugin-exclusion flag exists.** `common.mjs:150-195` glob-imports every plugin
  folder; the only exclusion branch is platform-target by folder suffix. Deleting directories is the
  only way to subset, and a naive prune **will not build**: `src/api/Badges.ts` →
  `@equicordplugins/globalBadges`, `_api/userArea.ts` → declutter, `_core/concatenatedModules.tsx` →
  iconViewer, `src/debug/runReporter.ts` → devCompanion.dev. `MessageTranslate` itself imports
  `@plugins/translate/TranslateIcon`.
- **Rebranding is non-cosmetic:** rename `DATA_DIR` (`src/main/utils/constants.ts`) and the asar name
  in `build.mjs`, or we silently share and corrupt an installed Equicord's `settings.json`.

### 4.6 The toggle

- Use `location: "channeltoolbar"` — per-channel, unmounts with the channel, and reuses Discord's own
  icon component so `selected` / `role` / `aria-checked` / `disabled` / badge come free.
- `HeaderBarButtonFactory` is `() => JSX.Element | null` with **zero props** — the component must
  resolve everything itself via `useStateFromStores([SelectedChannelStore], …)` and `settings.use([…])`.
  `DataStore` is async with no hook, so it cannot back a render-path read.
- Our button lands **leftmost** (`toolbar.push(...)` immediately after `let t=[];`). Priority must be
  **> 25** to sit right of CollapsibleUI. Only **one** plugin in the entire repo uses
  `channeltoolbar` — one worked example, no diversity of precedent.
- **Open contradiction the verifier flagged:** the *rejected* headerbar path has a reproduced live
  match with measured 9-character slack; the *recommended* channeltoolbar path's find string is
  **absent from the live bundle**, so its rot risk is unquantified rather than lower. Re-measure
  before committing.
- **The click handler must repaint the scrollback itself.** `MessageTranslate` has no mass re-render,
  so flipping state changes nothing already on screen. Drive `MessageUpdater.updateMessage(channelId, id)`
  across the loaded list, or one `MessageStore.emitChange()` after a cache commit.

### 4.7 Licence

- Corresponding Source runs through **GPL §6(d)**, not §6(b)(2) — the source must be reachable
  "in the same way through the same place", i.e. linked from the release page. §6(b) would impose an
  unnecessary three-year written offer.
- Preserve all **1,082** Vendicated copyright headers; add ours alongside, never replacing.
- Add a dated §5(a) "we modified this" notice. **Equicord's About screen has no such notice**, so
  there is no template to copy — it must be written from scratch.
- Relicensing and dual-licensing are forbidden by §5(c). Sub-components carry LGPL-3.0-or-later and
  Apache-2.0 and need their own notices.
- `LICENSE` is byte-identical to gnu.org's GPL-3.0 text (empty diff, both 35,149 bytes).

## 5. Gate A / Gate B status

- **Gate A:** PASS. 12/12 agents, 0 errors, refute-by-default pass on every dimension, 15
  refutations, all reads pinned to one SHA.
- **Gate B:** NOT MET. No design approved, no code. Correctly gated.

## 6. Residual hazards

- **BLOCKER (process)** — building a fork from a clone with upstream `origin` ships a binary that
  replaces itself with Equicord. Must be handled in the very first build script.
- **HIGH** — forking on GitHub with Actions enabled runs Equicord's release-upload step.
- **HIGH** — inherited `connect-src *` and a production-registered arbitrary-git-clone IPC handler.
- **HIGH** — confidently-wrong language detection on short CJK (`了解` → "learn" at 0.988).
- **HIGH** — Windows SmartScreen on every install until a code-signing certificate is bought.
- **MEDIUM** — API key custody has no shipping precedent; `NativeSettings` would be our first
  production use of that path.
- **MEDIUM** — break-window tail (p75 = 18.8 days).

## 7. Not done / open items

- Fiber-vs-DOM extraction decision (ledger 1.7) — still open, still blocks the adapter interface.
- Channeltoolbar rot-slack re-measurement against the live chunk.
- No design doc approved; no implementation plan; no repo.
- Per-OS install click-path never walked by a human — all step counts are inferences from manifests
  and CI recipes, not observations.

## 8. Go / No-Go

**CONDITIONAL GO**, with a revised sequence: prove the product on the **zero-fork Equibop dist path**
before paying any fork tax. The fork remains the destination; it is not the first milestone.

**DO NOT START** the fork rebrand until the translator works end-to-end on a stock Equibop pointed at
our `dist/`.

## 9. Suggested next moves

- **P0** — Operator approves the revised sequence (prove-then-fork).
- **P0** — `git init` a dedicated repo.
- **P1** — Resolve fiber-vs-DOM; write the adapter interface.
- **P1** — Design doc, section-by-section approval, then `writing-plans`.
- **P2** — Price Windows code signing; decide Apple Developer identity.

## 10. Artefacts

- This report: `docs/superpowers/specs/2026-08-18-equicord-fork-teardown.md`
- Ledger: `.workflow/LEDGER.md`
- Workflow journal: `…/subagents/workflows/wf_31edf415-24f/journal.jsonl`
- Raw 290KB result: `…/tasks/wx9v5sjce.output`
- **WIKI N/A**
