# Turn report — Installer self-update fix, and the advertising question

**Date:** 2026-08-22
**Agent seat:** Claude (architect / chair)
**Status:** Complete — both fixes committed and pushed; **neither is released yet**
**Authority:** Operator — *"are we ready to publish?"*, *"GoatProject is an ad. Am I able to show it as an ad?"*, then *"proceed"*

## 1. Objective

Two things, in the order of who they hurt:

1. Stop the installer destroying itself.
2. Answer whether the Goat Project banner may be shown as an advertisement, and make whatever that answer requires true.

## 2. The installer was bricking itself

`GetInstallerDownloadLink()` built every URL from a find-replace artifact. The rebrand had replaced
the display name inside the **GitHub org, the repository name, and every asset filename**:

```
https://github.com/Discord Translator/Discord Translator Installer/releases/latest/download/Discord Translator Installer.exe
```

That org does not exist. Measured:

```
old URL (spaces percent-encoded)  ->  HTTP 404, 9 bytes, body "Not Found"
correct URL                       ->  HTTP 200, 42445259 bytes
```

`UpdateSelf()` never checked the status. Those nine bytes were copied into a temp file, `chmod 0755`,
the running executable removed, the temp renamed over it — and the function returned `nil`. **The
user is left with a nine-byte installer and told the update succeeded.**

Reachable from the GUI, which auto-prompts on launch when a newer release exists (`gui.go:371`,
action at `gui.go:336`), and from two CLI paths (`cli.go:85`, `cli.go:141`). Installer v0.2.0 is
published and v0.1.0 exists, so this is live for anyone still on v0.1.0.

### Fixed

- Corrected the org, repository and all seven asset filenames against the actual published assets.
- **Status check before any write** — the write is destructive and unrecoverable.
- **Size floor of 1 MB**, catching an error page that arrives with a 200. Real assets are 11–40 MB.
- Linux served the *command-line* binary to every install, so a graphical install would silently
  replace itself with a terminal one. Now selects on UI type, as Windows already did.
- macOS Intel correctly returns no URL for the graphical build, because none is published.

### Verified

All seven corrected URLs return HTTP 200 at 11–40 MB. **Go is not installed on this machine**, so
the change could not be compiled locally — it was compiled by CI on push, and `build.yml` passed
both the `cli` and `gui` jobs.

## 3. The advertising question

The operator asked directly whether he may show the banner as an ad. Researched against live policy
pages rather than recollection, then adjudicated.

**Answer: yes, on all three surfaces. No policy examined forbids it.**

| Surface | Answer |
|---|---|
| Self-distribution from GitHub | **Yes, as-is, no conditions.** Store policies govern store items; stock GPL-3.0 adds no terms; Vencord/Equicord add none. |
| Chrome Web Store | **Yes, if named in the listing description.** |
| addons.mozilla.org | **Yes, if named in the listing description.** |

Key verified policy text:

- Chrome Ads policy: *"Ads must also be easily removable by **either** adjusting the settings **or**
  uninstalling the product altogether."* — a disjunction. **Non-dismissible is not a violation**, and
  `required: true` needs no change.
- Chrome program policies: *"We do not allow the mining of cryptocurrency."* — the only crypto
  prohibition in the document. The banner is a hyperlink; Google's enforcement guidance scopes the
  rule to mining "on user machines". Crypto costs **featuring**, not publication.
- Mozilla Add-on Policies §7.3: *"the inclusion of affiliate promotions in user interface elements
  that are clearly identified as belonging to the add-on are acceptable."*

### What that required, and was done

- Chrome: *"Ads must be presented in context or clearly state which product they are bundled with"*,
  and for anything shown alongside a third-party site, *"clear attribution of the ads' source"* and
  no *"mimic or impersonate the native ads or content"*. A banner styled to sit natively in Discord's
  settings tab, unlabelled, is what that clause describes.
- So the banner now carries **"From the makers of Discord Translator"** as a quiet eyebrow line.
- A **Disclosure** section in `README.md` stating plainly that Goat Project is the author's own
  project, and a section in `PRIVACY.md` recording that the banner makes no request of any kind.
  NOTICE.md's single changelog line was the only prior mention, and a changelog is not disclosure.

### Corrections to the earlier readiness review

Its first-contact and legal lenses said the banner *"will very likely fail Chrome Web Store and AMO
review"*. The policy text does not support that, and I had relayed it. Also overstated there:
mandatory US-advertising-law ownership disclosure, the FTC health-products framing (that guidance
targets health products sold to consumers), and treating non-dismissibility as a violation.

The one item that genuinely binds **today, in every channel**: the disease line is an efficacy claim
under ordinary truth-in-content rules, and it must be substantiable. That is the only thing capable
of causing removal *after* approval rather than rejection before it.

## 4. Verification evidence

```
installer  build.yml on push to main -> cli job green, gui job green   (Go unavailable locally)
           all 7 corrected asset URLs -> HTTP 200, 11-40 MB
           old URL                    -> HTTP 404, 9 bytes

client     label present in dist/browser/chromium-unpacked/dist/DiscordTranslator.js : 1
           label present in dist/desktop/renderer.js                                 : 1
           fetch/XHR targets for dagoat.io                                           : 0
           Chrome 14/14 · Firefox 10/10 · QuickCSS 8/8 · 139 tests · checkExtension OK
```

## 5. NOT DONE — and this matters

**Neither fix is in anything a user can download.** The installer's latest release is still v0.2.0,
which contains the self-destroying updater. The client's latest release is still v0.2.5, without the
banner label or the disclosure. Both fixes exist only on `main`.

Cutting an installer release is the one that stops active harm.

## 6. Still open from the readiness review

| Severity | Item |
|---|---|
| **HIGH** | The release builds the extension without `--standalone`, so the shipped bundle says `Standalone: false` / `Platform: linux` and **carries the Patch Helper developer tab**, which runs `Function()` on pasted text in a CSP-stripped page. |
| **HIGH** | A message over ~1800 CJK characters returns HTTP 400 (measured: 1400 ok, 1820 fails). No length guard exists, and the circuit breaker's `reset()` has no production call site — five failures latch translation off for the session. |
| **HIGH** | The CDN fallback is reachable inside the extension via `__monacoLocalFailed` and a 30-second timeout, not only in the userscript build as I previously said. |
| **MEDIUM** | Firefox manifest declares `data_collection_permissions: {"required":["none"]}` while transmitting message text to Google. |
| **MEDIUM** | Extension packages ship with licence notices stripped, including Monaco's MIT notice. |

## 7. Go / No-Go

**GO** on both changes as committed.
**NO-GO** on announcing anything until the installer release is cut — the fix does nothing while
v0.2.0 is what people download.

## 8. Artefacts

- This report: `docs/superpowers/specs/2026-08-22-installer-selfupdate-and-ad-disclosure.md`
- Client commit: `b7e3fe3`
- Installer commit: `7c3fbe9`
- Wiki: **WIKI N/A**
