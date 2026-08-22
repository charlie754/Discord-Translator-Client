# Council Review — Runtime Hazards (Codex Lane, Read-Only)

**Date:** 2026-08-19  
**Reviewer:** Claude Codex (Council seat: runtime/scenario verification)  
**Lens:** What could be badly broken and still pass compile-time verification?

## Evidence Layer Declaration

- Code reviewed from `F:\Discord Translator Client\src\plugins\channelTranslator\` and four hand-repaired core files
- **Layer: SOURCE CODE ONLY** — no runtime execution, no artifact inspection
- **No execution by human confirmed**

---

## Findings

### Finding 1: CSP wildcard removal — Network access verification

**Status:** IN PROGRESS

#### Claim under review
Chair: "translator is unaffected because its network calls run in the Electron main process via `native.ts`"

#### Code evidence examined
- `state.ts` lines 19-23: `http` variable defined as `VencordNative.pluginHelpers.ChannelTranslator.fetchTranslation(url)`
- `selection.ts` lines 13-17: Identical pattern
- Both throw if `VencordNative.pluginHelpers.ChannelTranslator` is undefined
- `native.ts` lines 14-35: `fetchTranslation` function in main process, calls `fetch(url)` with User-Agent header

#### Path analysis
Renderer → `state.ts:requestTranslation()` → `provider.translate()` (google.ts:24) → `http(url)` → `VencordNative.pluginHelpers.ChannelTranslator.fetchTranslation()` → **main process**

✅ **Translation requests: MAIN PROCESS, not renderer-side fetch**

#### Panel/UI resource check
- `panel/Panel.tsx` — needs to read
- `panel/index.tsx` — needs to read  
- `styles.css` — needs to read

#### Finding summary so far
**PARTIAL:** Main translation path confirmed safe. Panel/CSS still need verification.

---

### Finding 2: Hand-repaired core imports — Load-bearing removals

**Status:** IN PROGRESS

#### Files examined
1. `src/api/Badges.ts` — lines 20, 108, 119 reference `BadgeAPIPlugin.getDonorBadges()` and `BadgeAPIPlugin.getEquicordDonorBadges()` 
   - These are calls to a plugin API, not removed plugin imports
   - Source of `BadgeAPIPlugin` at line 20: `import BadgeAPIPlugin from "@plugins/_api/badges";`
   - ✅ Import chain intact, no removals visible

2. `src/debug/runReporter.ts` — line 30 references "Equicord Reporter" string in comment
   - No deleted plugin imports visible
   - Patch registration and reporter setup intact
   - ✅ No load-bearing removal detected

3. `src/equicordplugins/_api/userArea.ts` — self-contained plugin, no deleted imports visible
   - ✅ No load-bearing removal detected

4. `src/equicordplugins/_core/concatenatedModules.tsx` — line 10 comment: "IconsDef was previously imported from the removed iconViewer plugin"
   - Line 12: `export let iconsModule: unknown;`
   - Line 28-33: Module stored via setter, accessible as `this.iconsModule`
   - **CRITICAL:** Did iconViewer registration get deleted? Was it load-bearing?
   - Search needed for iconViewer deletion evidence

#### Finding summary so far
**PARTIAL:** Three files appear clean. `concatenatedModules.tsx` needs verification that iconViewer was not load-bearing.

---

### Finding 3: `required: true` on translator

**Status:** IN PROGRESS

#### Plugin definition
- `index.tsx` line 18: `required: true`
- `index.tsx` lines 25-68: `start()` function
- Line 26: `hydrate()` called immediately

#### Hydrate function
- `state.ts` lines 52-55: Reads from `settings.store.cacheBlob` and `settings.store.serverState`
- Both read operations could throw if settings not initialized

#### Failure scenario if start() throws
**UNVERIFIED:** What does Equicord do when a `required: true` plugin's `start()` throws?
- Plugin cannot be disabled (required: true)
- Client may not boot at all
- Or falls back to degraded mode
- Need to check Equicord's plugin manager behavior

---

## Next steps required
1. Read `panel/Panel.tsx` and `panel/index.tsx` for remote resource loading
2. Read `styles.css` for `@import` or remote resource URLs
3. Search for iconViewer plugin deletion evidence
4. Trace Equicord's plugin manager to understand `required: true` failure behavior

