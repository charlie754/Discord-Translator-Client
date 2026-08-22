# Turn report — Stage 3 fork complete

**Date:** 2026-08-18
**Agent seat:** Claude (architect / chair)
**Status:** Complete — all seven phases done, CI green on both new repositories
**Authority:** Operator: "totally rebrand it to Discord Translator, no more Equicord exist in it",
then "carry on, under my name IRP_HongKong", then goal: "finish the rest of the pieces".
**Plan:** [Stage 3 fork plan](../plans/2026-08-18-stage3-fork.md)

## 1. What exists now

| Repository | Purpose | State |
|---|---|---|
| `charlie754/Discord-Translator` | the original Equicord userplugin | works standalone, 33 commits |
| `charlie754/Discord-Translator-Client` | the forked app | **CI green** |
| `charlie754/Discord-Translator-Installer` | the Go installer | **CI green on 3 platforms** |

## 2. Phases

| | | Evidence |
|---|---|---|
| **F1** Repository + safety | ✅ | Clean import, not a GitHub fork — a fork inherits Equicord's `build.yml`, whose release-upload step is not repo-guarded. 7 workflows deleted **before** the first push. `origin` repointed, which is what stops the built app updating itself into Equicord. |
| **F2** Identity | ✅ | `discord-translator@0.1.0`, `DiscordTranslatorData`, `DISCORD_TRANSLATOR_*` env vars. Verified `EquicordData` appears in **zero** executable files. |
| **F3** Strip | ✅ | 361 plugins removed, 1,108 files. Only 4 core→plugin imports broke, exactly as predicted. `desktop.asar` 16.1 MB → 2.5 MB. |
| **F4** Translator built-in | ✅ | Moved to `src/plugins/channelTranslator`, `required: true`, author **IRP_HongKong**. Renderer 3.0 MB → 410 KB. |
| **F5** Licence | ✅ | `NOTICE.md` satisfies §5(a) and §6(d). Equicord's docs removed. LICENSE untouched at 674 lines. |
| **F6** Installer | ✅ | All four release URLs repointed, module renamed, env vars matched to the client. |
| **F7** Release | ✅ | Workflows on both repos; **CI green**. |

## 3. What the user sees

No occurrence of "Equicord" anywhere in the running product: app name, data directory, settings,
window title, installer, update endpoint. Source retains all upstream copyright notices, as GPL-3.0
requires and as Equicord itself does.

## 4. Defects CI caught that nothing else could

The installer had **never been compiled** — Go is not installed on the development machine — so its
first build was in CI. It failed three times before passing.

1. **23 Go identifiers broken by my own bulk replacement.** Substituting `Equicord` →
   `Discord Translator` *with a space* corrupted identifiers as well as display strings:
   `EquicordFile` → `Discord TranslatorFile`. **This is the exact failure the spec I wrote for the
   implementation lane warned against** — "do not rename Go identifiers unless they are display
   strings" — and I then introduced it with a blunter tool. The guard was written and not followed
   by its author.
2. **`fmt.Errorf("Failed to chmod 755", tmp.Name()+":", err)`** — inherited from Equilotl,
   byte-identical to the import. `Errorf` with no format directives silently discards both
   arguments, so a chmod failure lost the filename and the underlying error.
3. **Non-constant format string passed to `Sprintf`** — also inherited.

Two of the three are upstream bugs that were shipping in Equilotl.

## 5. Gate A / Gate B

- **Gate A:** PASS. Client: typecheck and build green in clean CI. Installer: `go vet` and
  `go build` green on Windows, macOS and Linux.
- **Gate B:** NOT MET. **Nothing here has been run by a human.** No release has been tagged, no
  installer binary executed, no patched Discord launched. Every claim in this report is about
  compilation, not behaviour.

## 6. Residual hazards

- **BLOCKER for any ship claim** — the fork has never been installed or run. The plugin worked in
  Equicord; that does not prove the stripped fork does.
- **HIGH — the version regex.** `github_downloader.go` still matches `// Equicord (\w+)`. It was
  deliberately left because the string the client emits could not be confirmed from the installer
  repo. If it does not match, update detection fails **silently**. Resolve against a real build.
- **HIGH — maintenance changed permanently.** ~0 as a userplugin → **12–16 hrs/month** rebasing.
- **MEDIUM — unsigned binaries** (operator declined signing). SmartScreen and Gatekeeper on first
  run; parity with upstream, which is also unsigned.
- **MEDIUM — patch rot.** The `.CUSTOM_GIFT?""` anchor needed three upstream repairs in twenty days.

## 7. Go / No-Go

**GO** for tagging a first release and testing it yourself.

**NO-GO** for telling anyone else to install it until a human has run the installer end to end on a
clean machine and confirmed a patched Discord translates a channel.

## 8. Next moves

- **P0** — Tag `v0.1.0` on both repos, run the installer, confirm the app works.
- **P1** — Resolve the version regex against a real client build.
- **P2** — Drop sourcemaps from release builds; they are most of the asar's weight.

## 9. Artefacts

- This report · [fork plan](../plans/2026-08-18-stage3-fork.md) ·
  [release & update system](./2026-08-18-release-and-update-system.md) ·
  [live debugging](./2026-08-18-live-debugging.md)
- **WIKI N/A**
