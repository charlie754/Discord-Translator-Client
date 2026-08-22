# Turn report — QuickCSS stops loading code from a CDN (v0.2.5)

**Date:** 2026-08-22
**Agent seat:** Claude (architect / chair)
**Status:** Complete — published as v0.2.5 and verified against the released packages
**Authority:** Operator instruction — *"go ahead for QuickCSS"*, then *"proceed"*

## 1. Objective

Close the top residual hazard from the v0.2.4 report: the browser QuickCSS editor fetched Monaco
from `cdn.jsdelivr.net` into a page whose Content-Security-Policy this extension strips.

## 2. Why it mattered more than a normal CDN dependency

The extension removes Discord's CSP from every tab, which is inherited upstream behaviour and is
what allows user themes to load anything. That strip deletes the exact control that would otherwise
constrain a CDN script. Discord's real header is `default-src 'self'` with jsdelivr absent — verified
by fetching it — so with the CSP intact the load would simply be refused.

The loader and stylesheet carried subresource integrity. The modules the loader then fetched did
not. So one bad publish or hijack upstream would have executed in the logged-in `discord.com`
origin, beside the session token and any stored DeepL key.

## 3. What changed

| File | Change |
|---|---|
| `browser/VencordNativeStub.ts` | `openEditor` fetches Monaco, its stylesheet and both language workers from the extension, then injects them into the popup it owns |
| `browser/monacoWin.html` | Branches on `__monacoLocal`: waits for the injection, or falls back to the CDN |
| `browser/monaco.ts` | Publishes the editor it creates, and accepts injected worker URLs |
| `scripts/build/buildWeb.mjs` | Packages `vendor/monaco` again |
| `browser/manifest*.json` | `vendor/*` web-accessible again |
| `scripts/checkExtensionPackages.mjs` | Now **requires** the bundled Monaco and both workers |

Also in this release: the Changelog tab is out of the web build. It reached `api.github.com` and
made the published privacy notice inaccurate — see the v0.2.4 report.

## 4. The two things that were not obvious

Both were found by probing rather than reasoning, after a previous attempt at this change failed
silently and was reverted rather than shipped half-working.

### The fetch must happen in the opener

```
A  opener fetch       : status 200, 4257092 bytes     <- works
B  popup fetch        : Target crashed
C  popup <script src> : Target crashed
```

The editor popup is an `about:blank` window carrying the `discord.com` origin, and loading an
extension URL from inside it does nothing at all — correct URLs on the elements, no error, no
request, no execution. That is precisely how the earlier attempt failed. The opener is a real
`discord.com` document, so `web_accessible_resources` applies to it normally; it reads the files and
injects them into the popup.

### Workers need blob URLs

A worker must be same-origin with the document that starts it, and `chrome-extension://` is not.
Pointing `MonacoEnvironment` at the extension path would have left the CSS language service
**silently dead** — the editor renders and simply never produces diagnostics. `openEditor` mints
same-origin blob URLs from the fetched worker files instead.

## 5. Verification evidence

Driving the real `VencordNative.quickCss.openEditor()`, not a reimplementation, because the wiring
between `openEditor` and the page is the thing under test.

Against the **published** `extension-chrome.zip`:

```
ok   Monaco editor rendered                ok   toolbar buttons wired to the editor
ok   editor loaded the existing QuickCSS   ok   Monaco came from the extension  (4 requests)
ok   nothing was fetched from cdn.jsdelivr.net       zero jsdelivr requests
ok   request recorder is live (control)             6 requests recorded

extension requests: index.css, index.js, vs/language/css/css.worker.js, vs/editor/editor.worker.js
css language worker: {"language":"css","squiggles":3}
8/8 checks passed
```

The three squiggles are the worker liveness proof: the model is set to invalid CSS, and a dead
language worker renders the text while producing nothing. The `.monaco-editor` node rendering is not
sufficient evidence on its own.

Transport regression, also against the published packages:

```
chrome  extension-chrome.zip   14/14 checks passed
firefox extension-firefox.zip  10/10 checks passed
```

Local gates: 139 tests / 12 files, `tsc` clean, `web-ext lint` exit 0,
`checkExtensionPackages.mjs` OK. The new Monaco requirement was negative-controlled by removing
`css.worker.js` from an archive — check fails with the file named.

**Release run went green on all 15 steps.** Published as v0.2.5, release named
`Discord Translator 72ba41a1…` so the installer and updater read the hash correctly.

```
desktop.asar           6357 KB
equibop.asar           6345 KB
extension-chrome.zip   1733 KB
extension-firefox.zip  1733 KB
```

## 6. The cost

**The extension packages went from 248 KB to 1733 KB**, a 7× increase, because the Monaco tree is
back in the download. That is the price of not executing third-party code in the user's Discord tab,
and it is stated in the commit and here rather than buried.

## 7. Residual hazards

| Severity | Hazard |
|---|---|
| **MEDIUM** | The **userscript and plain-web builds still use the CDN path**. They have no extension to read files from, so this is unavoidable there; PRIVACY.md scopes its claim to the extension. That path is unchanged and untested by any automated run. |
| **MEDIUM** | `scripts/checkHosts.mjs` still enumerates hosts only in the two asars, not in the extension archives. PRIVACY.md states this limit explicitly. |
| **MEDIUM** | The Firefox package is unsigned, so it installs only as a temporary add-on. |
| **LOW** | The desktop `native.ts` still does not re-check the host after a redirect; the browser transport does. |

## 8. Not done

- Host enumeration extended to the extension packages.
- AMO signing and store submissions.
- Back-port of the post-redirect host re-check to the desktop transport.

## 9. Go / No-Go

**GO, executed.** v0.2.5 published, and its packages verified by download.

## 10. Artefacts

- This report: `docs/superpowers/specs/2026-08-22-quickcss-bundled-monaco.md`
- Previous: `docs/superpowers/specs/2026-08-22-publish-v0.2.4.md`
- Release: https://github.com/charlie754/Discord-Translator-Client/releases/tag/v0.2.5
- Commits: `7a2aa89` (the change, 9 files), `72ba41a` (version bump)
- Wiki: **WIKI N/A**
