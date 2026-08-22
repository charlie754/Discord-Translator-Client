# Turn Report — Discord Translator v0.1.0 published

**Date:** 2026-08-19
**Agent seat:** Claude Opus 5 (chair)
**Status:** Complete for build/publish; **Gate B NOT MET**
**Authority:** Operator: "totally rebrand it to Discord Translator, no more Equicord exist in it" →
"carry on, under my name IRP_HongKong" → goal "finish the rest of the pieces" → "proceed" (twice).

## 1. Objective

Fork Equicord into a standalone, fully rebranded client containing only a channel translator; publish
it and an installer so a user installs into their **real Discord** with no second app.

## 2. What was produced

Three public repositories under `charlie754`:

| Repo | Role |
|---|---|
| `Discord-Translator` | the original Equicord userplugin (still works standalone) |
| `Discord-Translator-Client` | the forked app |
| `Discord-Translator-Installer` | Go installer, derived from Equilotl |

Two releases tagged `v0.1.0`.

## 3. Claims and the ARTIFACT each came from

Every row names the layer the evidence came from, not merely that evidence exists.

| # | Claim | Evidence layer |
|---|---|---|
| C1 | Client release published: `desktop.asar` 2,629,109 B; `equibop.asar` 2,573,916 B | `gh release view v0.1.0 --json assets` — **GitHub API**, not local disk |
| C2 | Installer release published: 7 binaries (3 GUI, 4 CLI); `DiscordTranslatorInstaller.exe` 42,375,899 B | `gh release view v0.1.0 --json assets` — **GitHub API** |
| C3 | All 8 installer release jobs succeeded | `gh run view 32243873371 --json jobs` — **CI job conclusions** |
| C4 | Translator present in the shipped bundle | CI step greps `dist/desktop/renderer.js` + `dist/desktop/patcher.js` — **built output**, produced in a clean CI clone |
| C5 | No `EquicordData` in the build | CI greps 4 built files — **built output**. Locally also confirmed 0 in every non-map `.js` |
| C6 | The rebranded release URL is in the compiled installer | CI greps the built `.exe` for `Discord-Translator-Client` — **machine code**, not source |
| C7 | Client typecheck + build clean | `npx tsc --noEmit` and `pnpm build` — **run in CI on a fresh clone**, not only locally |
| C8 | Installer compiles on Windows, macOS, Linux | `go vet -tags cli` + `go build` — **CI**; Go is not installed locally so this had never been compiled before |
| C9 | 361 plugins removed, 1,108 files | `git status --porcelain` counts before commit |
| C10 | No surviving file lost its copyright notice | `git diff <import> HEAD --diff-filter=M -- src/ \| grep "^-.*Vendicated"` → empty. **Restricted to Modified files**; the raw 1123→217 header count dropped only because deleted files took their headers with them |
| C11 | `desktop.asar` 16.1 MB → 2.5 MB; renderer 3.0 MB → 410 KB | `ls -la` on built artefacts |

## 4. Defects found this turn

1. **23 Go identifiers broken by my own bulk replacement.** `Equicord` → `Discord Translator` *with a
   space* corrupted identifiers as well as display strings: `EquicordFile` → `Discord TranslatorFile`.
   **The spec I wrote for the implementation lane explicitly warned against this** ("do not rename Go
   identifiers unless they are display strings") and I then did it with a blunter tool. Caught only
   because CI compiled the code for the first time.
2. **`fmt.Errorf("Failed to chmod 755", tmp.Name()+":", err)`** — inherited from Equilotl,
   byte-identical to the import. `Errorf` with no directives silently discards both arguments, so a
   chmod failure lost the filename and the cause.
3. **Non-constant format string to `Sprintf`** — also inherited.
4. **My release guard checked `dist/desktop/main.js`, a path that never exists.** The desktop variant
   emits `patcher.js`; `main.js` is Equibop-only. The guard failed on its own wrong path.
5. **Ubuntu GUI job stalled and was killed at GitHub's 6-hour limit**, taking the release with it
   after 6 of 7 binaries had built. Root cause not established — the same apt step had succeeded
   minutes earlier in `build.yml`. Mitigated by bounding rather than by diagnosis:
   `timeout-minutes: 25` on every job plus `DEBIAN_FRONTEND=noninteractive`.

## 5. Gate A / Gate B

- **Gate A — PASS.** Compilation, typecheck, bundle content and artefact publication all verified
  from built output or the GitHub API, in CI rather than only locally.
- **Gate B — NOT MET.** **No human has run any of this.** No installer binary has been executed, no
  patched Discord launched, no channel translated using these artefacts. The predecessor *userplugin*
  was confirmed working in a live client by the operator; that does **not** transfer to the stripped
  fork, which deleted 361 plugins and 1,108 files including `equicordHelper` (which had wildcarded
  `connect-src`) and repaired 4 core imports by hand.

## 6. Residual hazards

- **BLOCKER for any "it works" claim** — §5 above.
- **HIGH — version regex left unchanged.** `github_downloader.go` still matches `// Equicord (\w+)`.
  Deliberately not changed because the string the client build emits could not be confirmed from the
  installer repo. If it does not match, **update detection fails silently**.
- **HIGH — `connect-src` wildcard removed with `equicordHelper`.** Intended as a security
  improvement, but the translator's renderer-side code paths were never re-tested against a
  non-wildcarded CSP in a running client. Translation transport goes through the main process, so it
  should be unaffected — **unverified**.
- **HIGH — maintenance changed permanently:** ~0 as a userplugin → 12–16 hrs/month rebasing.
- **MEDIUM — binaries unsigned** (operator declined). SmartScreen / Gatekeeper on first run.
- **MEDIUM — patch rot.** `.CUSTOM_GIFT?""` needed three upstream repairs in twenty days.
- **MEDIUM — 6-hour stall unexplained.** Bounded, not understood. It may recur as a 25-minute
  failure.

## 7. Go / No-Go

**GO** to tag and self-test. **NO-GO** for recommending installation to anyone else until a human has
run the installer end-to-end on a clean machine and confirmed a patched Discord translates a channel.

## 8. Not done

- Nothing executed by a human (§5).
- Version regex unresolved (§6).
- Sourcemaps still shipped in the asar — most of its weight.
- No final whole-branch review of the fork's 4 hand-repaired core imports.
