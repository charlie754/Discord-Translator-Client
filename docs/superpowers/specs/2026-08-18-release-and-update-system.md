# Turn report — Publication, update system, crash-recovery gate

**Date:** 2026-08-18
**Agent seat:** Claude (architect / chair)
**Status:** Complete — published and working; one safety path untested
**Authority:** Operator chose "Publish properly", then requested auto-update, a crash-recovery gate,
and repo creation.
**Predecessors:** [Stage 1 implementation](./2026-08-18-stage1-implementation.md) ·
[live debugging](./2026-08-18-live-debugging.md)

## 1. Objective

Take a working personal plugin to a published, self-updating project.

## 2. What shipped

| Area | Detail |
|---|---|
| **Repository** | `github.com/charlie754/Discord-Translator`, public, 32 commits, 50 files |
| **Licence** | GPL-3.0 verbatim. Not a choice — `plugin/patches.ts` derives its find string and both regexes from Equicord's `MessageTranslate`, and the plugin imports Vencord/Equicord APIs throughout |
| **Docs** | README with the MessageTranslate conflict, both update paths, and an honest ToS paragraph. PRIVACY.md stating that other people's messages are sent to a third party without their consent |
| **Update check** | `checkForUpdates` (default on) reads the version from raw.githubusercontent.com at startup |
| **Auto update** | `autoUpdate` (default **off**) runs `git pull --ff-only` then `npm run build` |
| **Crash gate** | Boot sentinel in the main process rolls back an update that fails to load |
| **Conflict notice** | `isPluginEnabled("MessageTranslate")` checked at startup |

## 3. The crash-recovery gate

A plugin that crashes on load cannot roll itself back, and a throw during plugin import takes down
all of Equicord rather than just this plugin — observed earlier in this project. Recovery therefore
lives in the main process, which starts before the renderer and outlives it.

```
update applied  → main writes marker { repoRoot, previousCommit, attempts: 0 }
restart         → verifyLastBoot() sees attempts:0, sets 1        ← this boot is on trial
plugin loads    → renderer calls confirmBoot()                    ← marker deleted, update kept

plugin crashes  → confirmBoot never fires, marker survives
next restart    → verifyLastBoot() sees attempts:1                ← reset --hard + rebuild
                → takeRollbackNotice() reports it once
```

Three properties that make it safe rather than merely clever:

1. **The marker is untrusted input.** It is a file on disk carrying a path that reaches
   `git reset --hard`, so `repoRoot` is re-validated against `package.json` before any git runs.
2. **A failed rollback deletes the marker** instead of looping forever.
3. **The sentinel never throws.** A throw at main-process module scope breaks the whole main bundle.

## 4. Verification evidence

- `npm test` → **95 passed** (11 files)
- `npx tsc --noEmit` → silent
- `npm run build` → succeeds, zero errors
- `grep verifyLastBoot equicord/dist/equibop/main.js` → present, so the sentinel really is in the
  main bundle rather than only in source
- `curl` on both live URLs the plugin depends on → **200** each:
  `raw.githubusercontent.com/.../main/package.json` and the repo page
- Authorship rewrite: 32/32 commits authored by `charlie754`, both co-author trailers on all 32, and
  `git diff backup-before-rewrite main` empty — content byte-identical, only authorship changed

## 5. Gate A / Gate B

- **Gate A:** PASS. Tests, typecheck, build, bundle inclusion, live URLs.
- **Gate B:** PASS for the product — the operator confirmed whole-channel translation, per-server
  toggle, both modes, double- and triple-click all working in a live client.
- **Gate B for the update system:** NOT MET. See §6.

## 6. The untested path

**The rollback gate has never fired.** The logic is correct on inspection and compiled into
`main.js`, but no update has ever crashed, so the recovery path has not run once in reality.

That matters more than usual, because the gate exists specifically to protect users from a bad push.
If it does not work, `autoUpdate` is not a safety feature — it is an unguarded remote code path.

The test is cheap: publish a deliberately broken version, let a client auto-update to it, and watch
whether the next start recovers. Until that has been done, **`autoUpdate` should be treated as
experimental**, which is one reason it defaults to off.

## 7. Residual hazards

- **HIGH** — the untested rollback path above.
- **HIGH** — `autoUpdate` executes git and npm on the user's machine. Whatever is in the repository
  at that moment is built and run. Off by default, disclosed in PRIVACY.md; the residual risk is a
  compromised account, and it is real.
- **MEDIUM** — patch rot. The `.CUSTOM_GIFT?""` anchor needed three upstream repairs in twenty days.
  Both render modes stop when it breaks; double-click keeps working because it needs no patch.
- **MEDIUM** — the free `gtx` endpoint has no contract or quota.
- **MEDIUM** — translation quality on short CJK. `了解 → "learn"` at 0.988 confidence is recorded in
  the live contract test rather than fixed.
- **LOW** — everything is version `0.1.0`, so the update checker will never fire until
  `package.json` is bumped.

## 8. Go / No-Go

**GO** for personal use and for publication — both are done and working.

**CONDITIONAL GO** for other people installing it: the MessageTranslate notice now prevents the
worst first-run experience, but `autoUpdate` should stay off until §6 is discharged.

**DO NOT enable autoUpdate by default** until the rollback has been observed working.

## 9. Next moves

- **P0** — Test the rollback gate for real.
- **P1** — Bump the version on the next change, or the update checker is inert.
- **P1** — Add a keyed provider (Azure F0 is free to 2M chars/month) behind the existing registry.
- **P2** — Translation quality: an LLM provider for slang and cross-message context.
- **P2** — The browser build. `plugin/core/` is Discord-free and enforced by a test, so the
  expensive part is already paid for.

## 10. Artefacts

- This report · [design](./2026-08-18-discord-channel-translator-design.md) ·
  [plan](../plans/2026-08-18-channel-translator-stage1.md)
- Repository: `https://github.com/charlie754/Discord-Translator`
- Local backup branch `backup-before-rewrite` — delete once the rewrite is accepted
- **WIKI N/A**
