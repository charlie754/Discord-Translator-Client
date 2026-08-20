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
| `api.github.com` | at startup, and on any later update check | a request for this project's latest release; no account, no identifiers |
| `clients2.google.com` | only if you turn on **Enable React DevTools** | your IP, to download that extension |

**Message text goes to exactly one of these — the first.** Nothing else on the list ever
receives message content.

**One request is made at startup**, and it is the update check: `src/Vencord.ts` calls
`checkForUpdates()`, which asks `api.github.com` for this project's latest release. It is
an unauthenticated GET — no account, no Discord user ID, no identifier of any kind, and
nothing about your settings or your messages. It carries your IP, as any HTTPS request
does. The same check runs again when you press **Check for Updates**, and on a 30-minute
timer only if you turn auto-update on *and* update notifications off — with the shipped
defaults there is no timer. Nothing else in the table above is contacted unless you do the
thing listed beside it.

The QuickCSS editor no longer fetches anything: Monaco is bundled inside the archive, so
opening it contacts nothing. Earlier versions loaded it from `cdn.jsdelivr.net`.

## What Enforces That

Less than you might assume, so it is worth stating precisely.

The translation transport runs in the Electron **main process**, where the renderer's
Content Security Policy does not apply. It is guarded instead by an explicit hostname
allow-list checked before the request leaves
(`src/plugins/channelTranslator/native.ts`): non-HTTPS URLs, and any host other than the
translation endpoint, are refused. **That check — not the CSP — is what constrains where
your message text can go.**

The CSP allow-list is a separate thing, and it covers only requests **originating in the
renderer**. It holds 22 entries. Two are the hosts above (`api.github.com`,
`translate.googleapis.com`); four are loopback addresses for local development; two are
Discord's own CDNs. The remaining fourteen exist so that **themes you choose to install**
can load images and fonts: GitHub Pages and `github.com`, `raw.githubusercontent.com`,
GitLab Pages and `gitlab.com`, Codeberg Pages and `codeberg.org`, githack, jsDelivr,
Imgur, ImgBB, Pinterest, Catbox and Google Fonts.
**None of those is contacted unless a theme you installed references it** — and a
CSP entry is a permission, not a request. The full list is `CspPolicies` in
`src/main/csp/index.ts`.

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
account information.

Cloud settings sync is off and cannot be turned on. Upstream's Cloud Settings tab is gone
from this build, `cloud.url` defaults to empty rather than to a third party, and
`src/Vencord.ts` clears `cloud.authenticated` and `cloud.settingsSync` at startup — so an
install upgraded from an earlier version, where the tab existed and sync could be enabled,
stops syncing on first launch of this version. Your settings never leave your machine.

## Direct Messages

Direct messages and group DMs are excluded from translation by default. If you enable the `includeDMs` setting, DMs will be included and sent to the translation service.

## Control

Translation only occurs when you enable it for a specific server via the per-server toggle.
