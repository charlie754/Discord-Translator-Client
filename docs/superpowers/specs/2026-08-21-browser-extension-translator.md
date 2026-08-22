# Turn report — Browser extension: working translator on Chrome and Firefox

**Date:** 2026-08-21
**Agent seat:** Claude (architect / chair)
**Status:** Complete for the stated goal, with named open items
**Authority:** Operator request — *"Start building extension version of our translator plugin /goal completely built full functional plugin same as our desktop version, work on Chrome/Firefox"*

## 1. Objective

Make the translator work as a browser extension on Chrome and Firefox, at parity with the desktop
build.

The starting assumption — that this was a build-from-scratch job — turned out to be wrong, and
checking that first changed the whole shape of the work. `browser/` already carried a complete
MV3 + MV2 extension scaffold inherited from upstream, and `pnpm buildWeb` already produced
`dist/extension-chrome.zip` and `dist/extension-firefox.zip`. The extension loaded, injected, and
rendered the translator panel.

It could not translate a single message.

## 2. Plan and routing

`browser/VencordNativeStub.ts:137` was `pluginHelpers: {} as any`. Both `state.ts:26` and
`selection.ts:20` obtain the transport via
`(VencordNative as any)?.pluginHelpers?.ChannelTranslator` and throw
`"ChannelTranslator: native bridge unavailable"` when it is missing. On the desktop that object is
generated from each plugin's `native.ts` and exposed over IPC; in a browser there is no main process,
so it was empty and every translation failed at the first call.

**Routing note, stated plainly:** the standing chair-and-workers doctrine in `~/.claude/CLAUDE.md`
would route implementation to `codex-sol`/`gemini-flash` and review to a three-seat Council. The
session harness carries an explicit instruction not to invoke the Agent tool or Workflow unless the
operator asks, and the operator did not ask this turn. That instruction is more specific and takes
precedence, so this work was done in-session rather than delegated, and **no Council review was
run.** That is a real gap in assurance for a security-relevant change and is recorded as such in §6.

## 3. What changed

### The transport (new)

The MAIN world cannot see `chrome.*`, and the page's CSP applies to it, so the request has to hop to
the extension background — the only context that may fetch across origins:

```
MAIN world bundle  --window.postMessage-->  content.js (ISOLATED)
                   --chrome.runtime------->  translationHost.js (background)
                   --fetch---------------->  translate.googleapis.com
```

| File | Role |
|---|---|
| `browser/translationHost.js` (new) | Background transport. Holds the hostname allow-list. Loaded by MV2 via `background.scripts` and by MV3 via `importScripts` in `service-worker.js`. Listener registered at module top level, which MV3 requires. |
| `browser/content.js` | Added the relay. Registered at top level, not inside `DOMContentLoaded`, because the bundle runs at `document_start`. Answers even when the background is gone, so a torn-down worker fails the request rather than hanging the scheduler. |
| `browser/translationBridge.ts` (new) | Supplies `pluginHelpers.ChannelTranslator`. Uses the relay under `IS_EXTENSION`, a direct fetch otherwise (userscript via `GM_fetch`, plain web). 20s timeout. |
| `browser/VencordNativeStub.ts` | `pluginHelpers` now carries `ChannelTranslator`. |

### The guard

The desktop allow-list (`native.ts`) is now mirrored in both browser transports: exact hostname,
`Set.has`, no suffix or wildcard. `translationHost.js` additionally **re-checks the host after
redirects** — `fetch` follows them by default, so one 302 from an allowed host would otherwise carry
message text to an arbitrary origin. The desktop build does not yet have that check.

Three copies of a guard is three chances to drift, so `test/allowedHosts.test.ts` extracts the
literal from all three files and fails if they differ.

### Manifests

- Added `translate.googleapis.com`, `api-free.deepl.com`, `api.deepl.com` to `host_permissions`
  (MV3) and `permissions` (MV2). **Without these the transport had no permission to reach any
  provider** — the allow-list would have passed a request the browser then refused.
- Replaced the inherited description *"The other cutest Discord mod now in your browser"* — upstream
  Vencord's tagline.
- Replaced the Gecko add-on ID `firefox@equicord.org` with `discord-translator@charlie754.github.io`.
- MV2 `web_accessible_resources` gained `vendor/*`, which MV3 already had.

### The icon

**The extension was still shipping upstream's Vencord/Equicord mark.** `browser/icon.png` had never
been replaced during the rebrand, and nothing checked it, so every browser build carried it — as did
the userscript, whose `@icon` points at that same file on GitHub.

Replaced with this project's own artwork, generated from `icon.png` (1024px) at 16, 32, 48, 96 and
128, and both manifests now declare the full size set instead of pointing a single "128" entry at a
256px file. `release.yml` pins the upstream file's hash and fails if it ever reappears, and requires
every declared size to exist.

The operator's own unpacked copy at `dist/chrome/` (Chrome's `_metadata` directory shows it was
loaded from there) predated the fix and was refreshed in place, so a reload in `chrome://extensions`
picks up the new icon.

### Build and release

- `scripts/build/buildWeb.mjs`: `translationHost.js` added to both `buildExtension` file lists. A
  file absent from those arrays is silently not shipped.
- `.github/workflows/release.yml`: **now runs the unit tests.** `test.yml` is filtered to `main`
  pushes and PRs and never fires on a tag, so until now nothing tested the commit that became a
  release. Also builds, verifies and publishes both extension zips.

### Docs

- `PRIVACY.md`: new *The Browser Extension* section; existing sections scoped to the desktop app.
- `README.md`: install instructions for both targets.
- `NOTICE.md`: dated modification entry (GPL-3.0 §5(a)).

## 4. Verification evidence

### Real Chromium, real unpacked extension, real network — 14/14

```
ok   MV3 service worker registered
       chrome-extension://gppaklbfjfelealgfifdbocmljjlnkcb/service-worker.js
ok   content script injected into discord.com
ok   MAIN-world bundle executed          window.Vencord has 9 keys
ok   ChannelTranslator plugin registered
ok   pluginHelpers.ChannelTranslator.fetchTranslation present   typeof === function
ok   real translation round-trips (ja -> en)   status=200 translated="this is a test"
ok   real translation round-trips (zh -> en)   status=200 translated="good morning world"
ok   allow-list refuses an unrelated host      blocked: https://example.com is not an allowed translation host
ok   allow-list refuses a lookalike suffix     blocked: https://translate.googleapis.com.evil.test is ...
ok   allow-list refuses plain http             blocked: http://translate.googleapis.com is ...
ok   guard checks are not vacuous (an allowed host really did return 200)
ok   no uncaught page errors from the bundle
ok   no update check is made on the web build  zero api.github.com requests
ok   every host contacted is one PRIVACY.md declares
       discord.com, translate.googleapis.com
```

`discord.com` is served from a route handler, so the content scripts genuinely match and inject at
`document_start` without needing an account. The translations and the refusals are real network
results.

### Real Firefox Dev Edition 155, real MV2 package — 10/10

Same checks, same real translations, same refusals. Firefox cannot be driven by Playwright with an
extension loaded, so the page drives itself and reports back to a local server that stands in for
`discord.com` via `network.dns.localDomains`. `discord.com` is HSTS-preloaded, so the profile also
needs `network.stricttransportsecurity.preloadlist=false` — a throwaway profile web-ext creates, not
the operator's browser.

```
ok   content script injected into discord.com
       moz-extension://564d3e14-b3ba-44e0-9055-9465c6319027/
ok   real translation round-trips (ja -> en)   status=200 translated="this is a test"
ok   real translation round-trips (zh -> en)   status=200 translated="good morning world"
ok   allow-list refuses an unrelated host / a lookalike suffix / plain http
```

### Unit tests

`npx vitest run` — **12 test files passed**, including the new `test/allowedHosts.test.ts` (40 tests:
extraction controls, cross-transport identity, and refuse/allow behaviour for all three transports).

**Mutation-proved in both directions**, with the file restored byte-identical afterwards
(sha256 `f42245c3…` before and after):

| Mutation to `translationHost.js` | Result |
|---|---|
| `ALLOWED_HOSTS.has(h)` → `[...ALLOWED_HOSTS].some(h => host.endsWith(h))` | 2 failed / 38 passed |
| added a fourth host `telemetry.example.test` | 2 failed / 38 passed |
| restored | 40 passed |

### Other gates

- `npx tsc --noEmit` — clean.
- `web-ext lint` on the Firefox package — **exit 0**, no errors (warnings are `innerHTML` uses inside
  the vendored Monaco tree).
- The new CI verification block was run locally against the built packages and passes for both, and
  its branding check was negative-controlled: a planted `"author":"Equicord"` **is** caught.
- The icon guard was negative-controlled against the real upstream file recovered from
  `git show HEAD:browser/icon.png` — hash `c57fa99ab3e88f5d`, **CAUGHT**. Both packages carry our
  artwork at all five sizes.

### Probes that were wrong, and were fixed rather than believed

Three of my own checks gave false results this turn. Recording them because the pattern keeps
recurring:

1. *"content script injected"* first reported FAIL — the listener was registered after
   `DOMContentLoaded` had already fired. The relay had demonstrably worked, which is only possible if
   the content script injected. Probe bug.
2. The branding negative control first reported *"check is blind"* — the `sed` pattern had a space
   and the built manifest is minified, so nothing was planted.
3. The retry of that control still failed — Python on Windows resolves `/tmp` to `C:\tmp` while Git
   Bash maps it to `%TEMP%`, so the plant and the grep were reading different files.

## 5. Gate A / Gate B

**Gate A (build and hygiene) — PASS.** tsc clean; 12 test files pass; both packages build and pack;
`web-ext lint` exit 0; new CI steps verified locally with a negative control.

**Gate B (product depth) — PASS for the stated goal.** The end-to-end path is exercised in both real
browsers against the real endpoint: produce → relay → background → network → parse → reply. Not a
unit test standing in for a live path, and not presence-checking. Panel, patches and settings were
observed loading in both browsers (`ChannelTranslator` registered, bundle executed).

**Gate B is NOT claimed for:** translating an actual Discord conversation. Every check ran against a
stand-in page, because that is what can be automated without an account. Nobody has yet loaded this
extension into a browser signed in to Discord.

## 6. Residual hazards

| Severity | Hazard |
|---|---|
| **HIGH** | **No Council / cross-vendor review.** A security-relevant transport was written, reviewed and verified by one model. The harness prohibited proactive delegation this turn, so the usual adversarial check did not happen. |
| **HIGH** | **Never run against real Discord.** All evidence is from stand-in pages. Panel layout, patch anchors and the message pipeline under a real Discord bundle are unverified in-browser. |
| **MEDIUM** | **The relay is reachable from any script on the Discord page.** Bounded to the three translation hosts by the allow-list, which is the whole protection. Disclosed in PRIVACY.md. |
| **MEDIUM** | **`scripts/checkHosts.mjs` does not cover the extension packages.** It reads `dist/*.asar` only. The extension's hosts are held by `test/allowedHosts.test.ts`, but there is no artifact-level enumeration of the shipped zips. |
| **MEDIUM** | **Firefox installs are temporary.** The add-on is unsigned, so on release Firefox it does not survive a restart. Stated in the README rather than glossed. |
| **MEDIUM** | **The extension strips Discord's CSP header** on every tab. Inherited from upstream and needed for themes; a real reduction in the page's defences. Now disclosed. |
| **LOW** | **Settings live in `discord.com` localStorage**, so a configured DeepL key is readable by any script on the page. Disclosed, with a recommendation to use the desktop build for DeepL. |
| **LOW** | The desktop `native.ts` does **not** re-check the host after a redirect; the browser transport does. The stricter one should be back-ported. |

## 7. Not done

- **QuickCSS still loads Monaco from `cdn.jsdelivr.net` in the browser build.** I implemented the
  local path (the packages already ship `vendor/monaco`), and it did not work: `baseUrl` resolved
  correctly and the `<script>`/`<link>` were created with correct `chrome-extension://` URLs, but
  they never loaded and produced no error and no failed request. The likely cause is that
  `web_accessible_resources.matches` is evaluated against the popup document, which is `about:blank`
  and does not match `*://*.discord.com/*`. Rather than ship a half-working change to a feature that
  currently works, **I reverted `browser/monacoWin.html` and `browser/monaco.ts` to their committed
  state** and documented the gap. The real fix is probably to open the editor at a
  `chrome-extension://` page URL instead of a `document.write` popup.
- Extension host enumeration in `scripts/checkHosts.mjs` (needs its own curated allow-list).
- AMO signing, and Chrome Web Store / AMO submission.
- Intel Mac GUI installer (pre-existing, unrelated).

## 8. Go / No-Go

**CONDITIONAL GO** for shipping the extension as an unlisted, manually-installed release.

Conditions:

1. **Someone loads it into a browser signed in to Discord and translates a real channel** before this
   is announced. Everything here says the transport works; nothing here says the product works in
   front of a real Discord bundle.
2. The Firefox temporary-install limitation stays prominent in the release notes, not only the README.

**NO-GO** for describing this as store-ready, or for claiming parity on the QuickCSS editor.

## 9. Suggested next moves

**P0** — Load `dist/extension-chrome.zip` in Chrome against real Discord and translate a channel.
This is the one gap no amount of further automation closes.

**P1** — Commit and tag. The work is **uncommitted**: the client repo is on `main`, and this repo
publishes releases from `main`, so the commit is the operator's call rather than mine.

**P1** — Back-port the post-redirect host re-check from `translationHost.js` into `native.ts`.

**P2** — Extend `scripts/checkHosts.mjs` to the extension packages.
**DO NOT START the Monaco local-load fix until** the `about:blank` / `web_accessible_resources`
hypothesis in §7 is confirmed — the previous attempt failed silently and cost more than it returned.

## 10. Artefacts

- This report: `docs/superpowers/specs/2026-08-21-browser-extension-translator.md`
- New source: `browser/translationHost.js`, `browser/translationBridge.ts`, `test/allowedHosts.test.ts`,
  `browser/icon{16,32,48,96,128}.png`
- Modified: `browser/content.js`, `browser/VencordNativeStub.ts`, `browser/manifest.json`,
  `browser/manifestv2.json`, `browser/service-worker.js`, `scripts/build/buildWeb.mjs`,
  `.github/workflows/release.yml`, `README.md`, `PRIVACY.md`, `NOTICE.md`, `browser/icon.png`
- Test harnesses (scratchpad, not committed): `ext-e2e.cjs` (Chrome), `ff-e2e.cjs` (Firefox),
  `monaco-e2e.cjs`, `popup-probe.cjs`
- Subagent reports: **none** — see the routing note in §2
- Wiki: **WIKI N/A** (no `wiki/` tree in this repo)
