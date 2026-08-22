# Evidence Layer Review — Discord Translator v0.1.0 Release

**Date:** 2026-08-19  
**Reviewer:** Council (Evidence Lens — Gemini 3.7 Flash)  
**Report reviewed:** `docs/superpowers/specs/2026-08-19-release-turn-report.md`

## Claim-by-Claim Verdict

| Claim | Evidence Layer | Result | Reasoning |
|-------|---|---|---|
| C1: Client release published (asset sizes) | GitHub API (`gh release view`) | **SUPPORTED** | GitHub API is canonical source for published artifacts; sizes are real-time query |
| C2: Installer release published (7 binaries) | GitHub API (`gh release view`) | **SUPPORTED** | GitHub API is canonical source for release assets |
| C3: All 8 installer jobs succeeded | GitHub Actions API (`gh run view`) | **SUPPORTED** | GitHub Actions API is canonical source for CI job status |
| C4: Translator in shipped bundle | CI greps built output (`dist/desktop/renderer.js`, `dist/desktop/patcher.js`) | **SUPPORTED** | Built output (not source) is correct layer; checked in fresh CI clone |
| C5: No `EquicordData` in build | CI greps 4 built files; local non-map `.js` files | **SUPPORTED** | Built output (not source) is correct layer; includes secondary local confirmation |
| C6: Rebranded URL in compiled installer | CI greps built `.exe` (machine code, not source) | **SUPPORTED** | Machine code is correct layer to verify binary payload |
| C7: Typecheck + build clean | `npx tsc --noEmit` and `pnpm build` in CI on fresh clone | **SUPPORTED** | CI is correct layer; fresh clone rules out local cache artifacts |
| C8: Installer compiles on Windows, macOS, Linux | `go vet -tags cli` + `go build` in CI | **SUPPORTED** — conditional | Evidence shows CI compilation succeeded; C3 confirms 8 jobs passed (covering platforms); however, evidence line does not explicitly name platform matrix. Supported only if C3's "8 jobs" includes one per OS. |
| C9: 361 plugins removed, 1,108 files | `git status --porcelain` counts before commit | **WEAKER THAN CLAIMED** | Evidence shows file deletions in git state, but "361 plugins" is a semantic count not directly proven by file count; evidence measures deletion artifact count, not semantic plugin inventory |
| C10: No surviving file lost copyright notice | `git diff <import> HEAD --diff-filter=M -- src/ \| grep "^-.*Vendicated"` → empty | **SUPPORTED** | Evidence correctly restricts to Modified (surviving) files; absence of deleted headers in Modified files proves the claim. Report acknowledges 1123→217 drop was due to deletions, not modifications. |
| C11: Size reduction (asar 16.1→2.5 MB; renderer 3.0→410 KB) | `ls -la` on built artifacts | **SUPPORTED** | Built artifacts are correct layer for measuring binary output size |

## Behavioural vs Construction

**Q1: Which claims describe behaviour rather than construction?**

**Answer: None.** All claims C1–C11 describe build-time, compile-time, or artifact inspection properties:
- C1–C3: publication and CI outcomes (not runtime)
- C4–C7: compilation, bundling, and code presence (not runtime)
- C8–C11: build configuration and artifact state (not runtime)

No claim tests that the installer runs, Discord patches, or a channel translates. The report explicitly flags this as Gate B failure (§5).

## C10 Evidence Gap Analysis

**Q2: Is C10's evidence sufficient to prove the 1123→217 header count drop was only due to deleted files?**

**Answer: Partial — evidence supports the claim about surviving files, but does not directly measure the count hypothesis.**

- **Supported:** The command proves no Modified files lost headers (empty grep result)
- **Unsupported:** The explanation "1123→217 dropped only because deleted files took their headers" is not directly measured by this evidence
  - The evidence layer is a diff of Modified files only
  - It does not measure header count in deleted files, or before/after total header counts
  - The explanation is *consistent with* the evidence (deletions explain why the count dropped) but is not *proven by* it
  - To fully support the explanation would require: (a) measuring headers in deleted files, OR (b) showing that (# deleted files) = (1123 – 217), assuming each deleted file had one header

**Gap:** The evidence is sufficient to close the "surviving files" claim but leaves open whether the 1123→217 figure is accurate and correctly attributed.

## Residual Concerns

- **C8 platform matrix unclear:** The evidence says "CI" and "Go is not installed locally" but does not explicitly confirm three separate platform jobs. Relying on C3's "8 jobs" being an exhaustive list; if some jobs are cache or setup steps, the claim would be unsupported.
- **C9 semantic vs file count:** "361 plugins" is not a verifiable count from the cited evidence; only file deletions are. The equation "plugins ≡ files deleted" is assumed, not proven.
- **No runtime testing:** All evidence is compile-time / build-time. Gate B hazard (BLOCKER) stands: nothing has been executed.

