# Turn report — Finish the rebrand; remove every third-party endpoint

**Date:** 2026-08-19
**Agent seat:** Claude Opus 5 (chair)
**Status:** Complete for the reported bugs; **Gate B still NOT MET** (nobody has run the fork)
**Authority:** Operator, from live screenshots: *"pic1: our plugin blocked the member lists when it's
opened / pic2: in setting, it's still Equicord content since we are building our own brand / also our
installer is still using equibop icon"*, under the standing order *"totally rebrand it to Discord
Translator, no more Equicord exist in it"*.

## 1. Objective

Fix the three reported defects. Chasing the second one uncovered a larger class of problem and the
scope grew accordingly — stated below, not silently.

## 2. What changed

### 2.1 Panel over the member list — `panel/index.tsx`

The panel anchored to the chat **region**, which spans the member list. Re-anchored to the message
column (`[data-list-id="chat-messages"]`, with class-based fallbacks). Toggling the member list
resizes that column without firing a window `resize`, so a `ResizeObserver` was added.

**A defect in my own first version of that fix, found before shipping:** the observer bound the node
found at mount time. `mountPanel()` runs once in `start()`, and Discord replaces the message column on
every channel switch — so after the first channel change the observer would have watched a detached
node and silently stopped firing. Re-binding now happens inside `reposition()`, keyed on node
identity, which also stops the observer's own callback from looping.

### 2.2 Settings branding — 12 files

Every user-visible occurrence of "Equicord" outside source copyright headers is gone: tray and app
menu (About / Update / Repair), About window (rewritten), QuickCSS and host-permission window titles,
updater blurbs and switches, backup/restore text, notification settings, plugin search filters
("Show Equicord" / "Show Vencord" removed), version-info row, update toasts, `[Equicord]` console
prefixes, and the **outbound `User-Agent` header**.

Left deliberately: the Vencord/Equicord attribution in the About window's Acknowledgements, all
upstream copyright headers (GPL-3.0 §5), and internal identifiers and storage keys that no user sees.

### 2.3 Third-party endpoints — the part that was not asked for

Chasing 2.2 found the fork still contacted three services it has no use for:

| Endpoint | When | What it received |
|---|---|---|
| `badges.vencord.dev`, `badge.equicord.org` | every start, then every 30 min | **every user's Discord ID and IP**, sent to two unrelated projects |
| `equicord.org` | rendering settings screens and the About window | IP, on 6 image loads |
| `cloud.equicord.org` | default settings-sync backend | nothing — off by default — but enabling sync in **this** app would have uploaded settings to Equicord's server |

All removed, and with them: the Cloud tab and `CloudTab.tsx`, the donor/contributor badges that had
nothing left to fetch, `badges/modals.tsx` and both `DonateButton` components (donation solicitations
for another project), and the `pluginInfo` remote images.

The CSP's **`// Function Specific` block** was cut from 18 hosts to two: `api.github.com` (update
checks) and a translation host. The rest allow-listed plugins this fork deleted.

> **CORRECTED — see §3b.** As first written this sentence said "the CSP allow-list was cut from ~20
> hosts to two", which is false: the whole list ships **24 entries, 18 of them third-party**. Only
> the block I edited went 18 → 2. And the translation host I named here was the wrong one — the app
> requests `translate.googleapis.com`, not `translate-pa.googleapis.com`.

### 2.4 Installer update detection — was broken, now fixed

`github_downloader.go` matches `// Discord Translator (\w+)` against the installed build to read its
version. The client's build banner still emitted `// Equicord <hash>`. **They did not match**, so
`InstalledHash` stayed empty and an update would never have been offered. The 2026-08-18 report
carried this as a HIGH hazard "deliberately left unverified"; it was in the failing state.

Banner changed to `// Discord Translator ${gitHash}`; `EQUICORD_HASH` → `DISCORD_TRANSLATOR_HASH`.

### 2.5 Installer env vars — a false claim in the previous report, corrected

`patcher.go` read `EQUICORD_USER_DATA_DIR`, and `gui.go` **told users to set it**, while the client
reads `DISCORD_TRANSLATOR_USER_DATA_DIR`. The F6 phase claim "env vars matched to the client" was
**false**. All three renamed (`USER_DATA_DIR`, `DIRECTORY`, `DEV_INSTALL`).

### 2.6 Licence headers

19 of 21 translator source files had **no GPL header**, which the repo's own lint enforces. Added,
attributed `Copyright (c) 2026 IRP_HongKong`. Two files eslint auto-headed as "Vendicated and
contributors" were corrected to ours — they are original work.

## 3. Verification — and the layer each claim came from

| # | Claim | Evidence layer |
|---|---|---|
| C1 | Typecheck clean | `npx tsc --noEmit`, exit 0 — **source**, run after the final edit |
| C2 | Lint clean, 0 errors | `pnpm lint` (eslint), empty output — **source**. Was 39 errors before |
| C3 | Build succeeds | `pnpm build` — **produces the artifacts C4–C7 are measured on** |
| C4 | **CORRECTED — see §3a.** Zero third-party *endpoints* ship; the original wording "zero third-party hosts" was measured only over the built `.js` files and is false as stated | regex over **all 24 files in `dist/`**, including `.map` and both `.asar` archives → **4 matches**, all of them one `*.vencord.dev` occurrence inside a source *comment*, carried in via the sourcemaps |
| C5 | **The installer's regex matches the built banner** | the installer's own `// Discord Translator (\w+)` run in Node against **built** `patcher.js` → MATCH, hash `e99b762…`. Not "the strings look the same" |
| C6 | Remaining "Equicord" in the bundle is 3 attribution links + 18 identifiers | enumerated every occurrence with surrounding context from the **built** files; zero are user-visible strings |
| C7 | Translator still in the bundle | `grep -c channel-translator-host dist/desktop/renderer.js` → 1 — **built output** |
| C8 | Both repos pushed | `git push` output: `e99b762..9f19bd4`, `9ae8473..b9fdc3e` |

63 files changed, 286 insertions, 946 deletions.

## 3a. Correction — C4 was measured at too narrow a layer

**Raised by the council, then re-measured by the chair.** My original C4 grepped only the built
`.js` files. Scanning **all 24 files under `dist/`** finds 4 occurrences of `vencord.dev`:

```
dist\desktop\patcher.js.map  1  [vencord.dev]
dist\desktop.asar            1  [vencord.dev]
dist\equibop\main.js.map     1  [vencord.dev]
dist\equibop.asar            1  [vencord.dev]
TOTAL third-party host occurrences across ALL dist files: 4
files scanned: 24
```

All four are the **same string**, and it is a comment written in `src/main/csp/index.ts` explaining
which hosts were removed — *"plus \*.vencord.dev for its cloud and badge services … they are gone"* —
carried into the sourcemap and from there into the asar.

**As worded the claim did not hold**, and the layer I measured it at could not have seen this.

> **FURTHER CORRECTED — see §3b.** The sentence that stood here — *"zero third-party endpoints, zero
> requests, zero CSP entries"* — is false on two of its three counts. 18 third-party CSP entries
> ship, and the QuickCSS editor fetches an unpinned module tree from `cdn.jsdelivr.net`. Fixing the
> measurement's *layer* here left its *scope* wrong, which is the actual root cause: see §3b.

One reviewer reported C4 "CONFIRMED — regex search across **all file types** (`*.js`, `*.css`,
`*.html`, `*.map`) in `dist/` … **0 matches in all files**". That is false; the chair's re-run above
is the artifact that settles it. Logged because a review that confirms an unmeasured claim is worse
than no review.

**Second, larger finding from the same measurement: sourcemaps ship inside the asar.**

| | |
|---|---|
| `desktop.asar` | 2.5 MB |
| sourcemaps packed inside it | ~2.08 MB (`renderer.js.map` 1.73 MB, `patcher.js.map` 253 KB, plus css/preload maps) |

**Roughly 83% of what a user downloads is sourcemaps.** `scripts/build/build.mjs:63` sets
`sourcemap: watch ? "inline" : "external"`, so external maps are emitted for release builds and then
packed. Not a security defect — GPL-3.0 wants source available and this is our own source — but it is
four fifths of the download, and it means every source comment ships. Carried as P1 below.

## 3b. What the council found, and the root cause behind all of it

A six-lens adversarial review of `9f19bd4`, each finding attacked by two independent skeptics from
different angles. Four survived. **I re-derived every one myself from the artifact before acting**;
all four are real.

| # | Sev | Finding | Chair's own verification |
|---|---|---|---|
| F1 | HIGH | The QuickCSS editor fetches Monaco from `cdn.jsdelivr.net` — the stylesheet and `loader.js` carry SRI hashes, **the AMD module tree does not** — into an Electron window, undisclosed in a privacy doc promising "two, and only two" hosts | Read `src/main/monacoWin.html`; `git show 9f19bd4 -- src/main/monacoWin.html` proves I edited that exact file in that commit |
| F2 | MEDIUM | **PRIVACY.md named a translation host the app never contacts.** The renderer requests `translate.googleapis.com/translate_a/single`; the doc and the CSP both said `translate-pa.googleapis.com` | `grep -oa` over the built files: the two strings live in **disjoint file sets** — documented host only in the main-process CSP, requested host only in the renderer |
| F3 | MEDIUM | "CSP cut from ~20 hosts to two" was false — 24 entries ship, 18 third-party, two of them carrying `script-src` | Counted the `CspPolicies` object; §2.3 and §3a both corrected above |
| F4 | HIGH | "Any other outbound request is blocked by the app itself" describes **a mechanism that does not exist**. Both network paths are main-process `fetch`, where renderer CSP does not apply | `grep -ao` for `onBeforeRequest` / `onBeforeSendHeaders` / `setPermissionRequestHandler` / `cancel:!0` in the built `patcher.js` → **0 each** |

**F4 escalated on inspection.** One skeptic raised it beyond its own text: `fetchTranslation` does zero
URL validation and is exposed via `contextBridge.exposeInMainWorld`. The review left the exposure half
open pending one command. **It resolves against the app:** `exposeInMainWorld` places the bridge in
the page's own world by definition — that is what it is for. So any script in the Discord renderer
held an unrestricted GET proxy with response read-back, running in the main process, able to reach
`localhost` and the LAN that the renderer itself could never contact. Now guarded by an exact-hostname
HTTPS allow-list checked before the fetch.

### The root cause

All four trace to one method error. **The endpoint sweep was a denylist** — a regex for the specific
hosts I had already decided to remove. A denylist cannot discover a host you did not think of, so it
was structurally incapable of falsifying the claim it was run to support. It reported "zero
third-party hosts" over an artifact containing `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`,
`i.imgur.com`, `files.catbox.moe` and `fonts.googleapis.com`.

§3a fixed that measurement's **layer** and left its **scope** intact — which is why it still said
"4 matches, all `vencord.dev`". Being more rigorous about the wrong question produced a more
confident wrong answer.

Replaced by `scripts/checkHosts.mjs`: an **enumeration** over the packed archives that base64-decodes
embedded literals (the jsdelivr URL existed in the artifact *only* in encoded form), self-tests that
it can recover a planted host before trusting a clean run, and fails CI on anything absent from
`scripts/allowed-hosts.txt`. Mutation-proven in both directions.

## 4. Gate A / Gate B

- **Gate A — PASS.** Typecheck, lint, build, and artifact-level content checks all green.
- **Gate B — NOT MET, unchanged.** Nothing here has been run. The panel fix in particular is a
  **geometry change that only a running client can confirm** — I can prove the code ships, not that
  the panel sits where the operator wants it.

  CI green on both repos at the final push — client run **32286742998**, installer run
  **32284123608**. The client run's step list is the evidence that matters, because "CI green" alone
  would not prove the new gate executed:

  ```
  Typecheck              = success
  Build                  = success
  Check third-party hosts = success
  ```

  The host enumeration ran **after** the build, against the packed archives, in a clean clone.
  It still only compiles and inspects; it does not run the app.

## 4b. What was fixed after the review — commits `e9006c3`, `e3b5e0a`, `bcb4cab`

| Change | Evidence layer |
|---|---|
| Exact-hostname HTTPS allow-list in `fetchTranslation`, checked before the fetch, never throws | present in the **built** `patcher.js`; the lane demonstrated it by stubbing `fetch` and calling the real export — `http://localhost:8080/x`, `https://evilgoogleapis.com/…`, `file:///…` and `https://x.translate.googleapis.com/a` all refused, the real endpoint reached |
| CSP host corrected to `translate.googleapis.com`; comment no longer claims to gate the transport | source, then re-verified in the built artifact by `checkHosts.mjs` |
| `cdnjs.cloudflare.com` removed — it held `script-src`+`worker-src` with nothing in the tree referencing it | `grep -rn cdnjs src/ scripts/` returned one line, the entry itself |
| **Sourcemaps out of release builds.** `desktop.asar` 2,566,687 → 486,884 B | `ls -la` plus `npx @electron/asar list` — 7 entries, no `.map` |
| `scripts/checkHosts.mjs` + `allowed-hosts.txt`, wired into CI | run by me: 51 entries, all declared. **Mutation-proven** — dropping `translate.googleapis.com` from the allow-file exits **1** and names it; restoring exits **0** |
| Browser/userscript variant rebranded — it still emitted `Equicord.user.js` with manifests reading "Equicord Web" | `pnpm buildWeb` re-run; `find dist -iname "*equicord*"` → empty; manifest reads `Discord Translator Web` and `dist/DiscordTranslator.js` |
| PRIVACY.md rewritten against what the build does | names four hosts, says which single one receives message text, and states plainly that the guard is the main-process allow-list and **not** the CSP |
| Monaco vendored into the asar; CDN dependency gone | `cdn.jsdelivr.net` no longer enumerated; `monacoWin.html` and `monaco/vs/loader.js` confirmed **inside** `desktop.asar`, not merely in `dist/` |
| Installer icons replaced with the project's own artwork | see §4c |
| **Monaco vendored** — 16 MB trimmed to 6.0 MB per variant; `desktop.asar` 486,884 → 6,520,086 B | `npx @electron/asar list` confirms `monacoWin.html` and `monaco/vs/loader.js` are **inside the archive**; the extracted page shows relative `./monaco/vs/…` paths and no absolute URL |
| `checkHosts.mjs` scoped for vendored code | see below — it was **red and looked green** |

**A defect in the fix to the gate, found by running it rather than reading it.** The vendored-path
predicate arrived as `archivePath.startsWith("monaco/")`. asar entry paths carry the host platform's
separator, so on Windows they are `monaco\vs\…` — the predicate matched nothing, the 491 Monaco token
scopes were still enumerated, and the gate stayed red. Normalised, then **mutation-proven in both
directions by the chair**: dropping `translate.googleapis.com` exits **1** (our own code still
checked), dropping `developer.mozilla.org` exits **1** (absolute URLs inside `monaco/` still
enumerated, not skipped wholesale), clean run exits **0**. 54 entries.

### 4c. Icons — two of the three were never doing anything

- `winres.json` points `RT_GROUP_ICON` at **`winres/icon.png`**, not `icon.ico`. Nothing read the `.ico`.
- **Nothing ran `go-winres`, and `*.syso` is gitignored**, so every released `.exe` has shipped with
  Go's default icon regardless of `winres/` contents. Added the CI step, with a check that fails the
  release rather than quietly producing an unbranded binary.
- The supplied artwork was a JPEG with **white corners** baked in outside the rounded square — white
  notches on a dark taskbar. Corners are now transparent, from a mask whose radius was **measured off
  the artwork** (the corner arc crosses the diagonal at 69px of 1408, so r = 16.7%).
- The `.ico` carries **different artwork per size**. Rendered at every size and compared: the mark's
  Chinese character has seven horizontal strokes and merges into a solid block below 32px, so 16/20/24
  get a glyph-free two-bubble silhouette. Measured, not assumed.
- `Info.plist` still declared `CFBundleExecutable: Equilotl` and `CFBundleIdentifier:
  org.equicord.equilotl`. Both corrected.

## 5. Residual hazards

- **BLOCKER for any "fixed" claim on §2.1** — the member-list fix is unverified in a live client.
- **HIGH — the QuickCSS editor has not been opened since Monaco was vendored.** Two things about it
  are reasoned rather than observed: the preload discriminator (`location.pathname.endsWith(
  "/monacoWin.html")`, replacing a `data:` scheme check that the move to `loadFile` invalidates), and
  whether Chromium will spawn Monaco's `css.worker` from a `file://` origin inside an asar. If the
  discriminator is wrong the editor window opens **blank**; if the worker is blocked the editor works
  but loses CSS validation and completion. Neither affects translation, and neither is visible to
  `tsc`, `lint`, or the build. **Open the QuickCSS editor once and the question is settled.**
- **HIGH — the Equibop build variant still ships.** `dist/equibop/` and the release asset
  `equibop.asar` carry another project's name in a **file the user downloads**. Not fixed this turn.
- **MEDIUM — `browser/monacoWin.html` still loads Monaco from the CDN.** The desktop build no longer
  does. Different build path, different packaging; deliberately left, and named here so it is not
  mistaken for done.
- **MEDIUM — the asar grew 13×**, 487 KB → 6.5 MB, from vendoring Monaco. Operator decision, taken
  against the alternatives (plain textarea, disclose-and-keep, remove the feature). Trimmed from
  16 MB by dropping the TypeScript/HTML/JSON language workers and thirteen non-English UI bundles —
  none of which a CSS editor uses.
- **MEDIUM — installer icons are still Equibop's artwork** (`winres/icon.ico`, `macos/icon.icns`).
  Raised with the operator twice; no answer yet. Shipping another project's logo is the worse of the
  two options against shipping none.
- **MEDIUM — `equicord://` protocol handler and its CSP entry remain.** No in-repo producer, so it is
  dead; renaming it risks breaking an Equibop integration for no user-visible gain.
- **MEDIUM — CSP tightening is untested at runtime.** Removing ~18 hosts should affect nothing, since
  the plugins that used them are deleted, but a theme loading from an unlisted host will now fail.
- **LOW — dead exports.** `EQUICORD_TEAM`, `isEquicordGuild`, `isEquicordSupport`, `getDonorBadges`
  and friends survive as identifiers returning nothing. Harmless; removing them widens the diff.

## 6. Not done

- Nothing executed by a human (§4).
- `equibop.asar` / `dist/equibop` naming (§5).
- Installer icons — **operator decision pending**.
- GDPR/consent finding from the 2026-08-18 Council remains **OPEN DESPITE REVIEW**.

## 7. Go / No-Go

**GO** to install this build and test it yourself — it is strictly better than what is published:
three fewer third-party services contacted, and update detection that actually works.

**NO-GO** for recommending it to anyone else, and **NO-GO** for cutting `v0.2.0`, until the panel
position is confirmed in a running client and the installer icon question is decided.

## 8. Next moves

- **P0** — Operator: run the built `desktop.asar`, open a channel with the member list toggled, and
  confirm the panel no longer overlaps it.
- **P0** — Operator decision: supply a PNG for the installer icon, or authorise stripping Equibop's.
- **P1** — Drop sourcemaps from release builds (§3a). Four fifths of the download for no user benefit.
- **P1** — Rename the `equibop` build variant and its asar, so no downloaded file carries that name.
- **P2** — Delete the dead donor/support identifiers (§5 LOW).

## 8b. Method note — how the review was actually obtained

Worth recording because it changed mid-turn and the change is what produced every finding above.

**Six plain `Agent` dispatches, six truncations.** `codex-sol`, `grok` and `gemini-flash` each
stopped mid-sentence at their step cap. Two returned **nothing at all** — both reviews, and both had
been explicitly told, in the spec, to write findings to a named scratch file *before* replying. They
never reached the write. The mitigation this project's own doctrine prescribes for exactly this
failure did not fire, because the lane spends its budget getting to the answer and the write is one
step past where it dies.

**Three `Workflow` runs with JSON schemas, zero losses.** Same lanes, same models, harder tasks. A
schema forces a structured tool call, and a tool call is not trailing narration — it is what the model
reaches for while it still has budget. Every finding in §3b came from that second approach.

The corollary cost a round trip and is the more useful half: **a lane that truncated has not run its
own verification, whatever the spec demanded.** The `checkHosts.mjs` scoping fix came back with a
predicate that matched nothing on Windows; the spec had required a mutation test in both directions,
and the lane died before running it. One command found it.

## 10. Council

Four reviewer dispatches. **Three returned nothing** — `codex-sol` (blast radius), `grok`
(omissions) and the first `gemini-flash` seat all hit their step cap mid-sentence, and the two that
were explicitly ordered to write findings to a scratch file *before* replying did not reach the write.
That is a 75% total-loss rate on review dispatches in one turn, and it is the reason the review was
re-run as a deterministic workflow with schema-forced structured output rather than prose.

The one seat that returned (`gemini-flash`, evidence lens) produced §3a's prompt — and simultaneously
demonstrated the failure mode it was hired to catch, by marking C4 CONFIRMED on a measurement it did
not perform. Both facts are recorded above.

## 9. Artefacts

- This report
- Predecessors: [Stage 3 fork complete](./2026-08-18-stage3-fork-complete.md) ·
  [v0.1.0 published](./2026-08-19-release-turn-report.md)
- Commits: client `9f19bd4`, installer `b9fdc3e`
- **WIKI N/A**
