# Privacy

## Data Transmission

When you enable channel translation, the text of messages is sent to a configured translation service (currently Google's public translate endpoint) via the app's Electron main process for processing. This transmission is necessary for translation to occur.

**This includes messages from other users who did not consent to translation.** You are responsible for ensuring that translating messages in a server complies with that server's policies and applicable laws.

## Local Storage

The translation cache is stored locally in the app's settings directory. Nothing about your translations is sent to the app's author.

## Every Server This App Contacts

| Host | When | What it receives |
|---|---|---|
| `translate.googleapis.com` | you enable translation, or double/triple-click text | the message text being translated, and the language pair |
| `api.github.com` | on update checks | a request for this project's latest release; no account, no identifiers |
| `cdn.jsdelivr.net` | you open the QuickCSS editor | your IP — the editor's own code is fetched from this CDN when the window opens |
| `clients2.google.com` | only if you turn on **Enable React DevTools** | your IP, to download that extension |

**Message text goes to exactly one of these — the first.** Nothing else on the list ever
receives message content. Nothing here is contacted at startup, and nothing is contacted
on a schedule.

## What Enforces That

Less than you might assume, so it is worth stating precisely.

The translation transport runs in the Electron **main process**, where the renderer's
Content Security Policy does not apply. It is guarded instead by an explicit hostname
allow-list checked before the request leaves
(`src/plugins/channelTranslator/native.ts`): non-HTTPS URLs, and any host other than the
translation endpoint, are refused. **That check — not the CSP — is what constrains where
your message text can go.**

The CSP allow-list is a separate thing, and it covers only requests **originating in the
renderer**. It holds 23 entries. Beyond the hosts above, most exist so that **themes you
choose to install** can load images and fonts: GitHub Pages, GitLab Pages, Codeberg
Pages, `raw.githubusercontent.com`, jsDelivr, githack, Imgur, ImgBB, Pinterest, Catbox
and Google Fonts. **None of those is contacted unless a theme you installed references
it.** The full list is `CspPolicies` in `src/main/csp/index.ts`.

`scripts/checkHosts.mjs` enumerates every host present in the packed release archives and
fails CI on anything not declared in `scripts/allowed-hosts.txt`, so this document cannot
quietly drift away from what ships.

Some settings screens link out to third-party sites — BetterDiscord's theme directory,
for instance. Those are ordinary links: nothing is requested until you click one.

Upstream Equicord additionally fetched donor badges from `badges.vencord.dev`
and `badge.equicord.org` on every start, keyed by your Discord user ID, and
loaded images from `equicord.org` inside the settings screens. **All of that has
been removed from this fork.**

## What is Not Transmitted

No data is sent to Discord Translator's author. No telemetry, no analytics, no
account information. Settings sync to a remote server has been removed
entirely — your settings never leave your machine.

## Direct Messages

Direct messages and group DMs are excluded from translation by default. If you enable the `includeDMs` setting, DMs will be included and sent to the translation service.

## Control

Translation only occurs when you enable it for a specific server via the per-server toggle.
