# Privacy

Everything below describes the **desktop app** unless it says otherwise. The browser extension runs
the same translator but sits in a different place, and the differences are set out under
[The Browser Extension](#the-browser-extension).

## Data Transmission

When you enable channel translation, the text of messages is sent to the translation service you have selected, via the app's Electron main process. This transmission is necessary for translation to occur.

The default is Google's public translate endpoint, and with the shipped settings it is the only one used. **DeepL is contacted only if you change the provider setting to DeepL and supply an API key of your own** — this app ships no DeepL key, shares none, and refuses to select the provider until you have entered one. Your key is stored locally with the rest of your plugin settings and is sent to DeepL and nowhere else.

**This includes messages from other users who did not consent to translation.** You are responsible for ensuring that translating messages in a server complies with that server's policies and applicable laws.

## Local Storage

The translation cache is stored locally in the app's settings directory. Nothing about your translations is sent to the app's author.

## Every Server This App Contacts

| Host | When | What it receives |
|---|---|---|
| `translate.googleapis.com` | the default provider: you enable translation, or double/triple-click text | the message text being translated, and the language pair |
| `api-free.deepl.com` | **only if** you set the provider to DeepL and configure a free DeepL key (free keys end in `:fx`) | the message text being translated, the language pair, and your own DeepL API key |
| `api.deepl.com` | **only if** you set the provider to DeepL and configure a paid DeepL key | the message text being translated, the language pair, and your own DeepL API key |
| `api.github.com` | at startup, and on any later update check | a request for this project's latest release; no account, no identifiers |
| `clients2.google.com` | only if you turn on **Enable React DevTools** | your IP, to download that extension |

**Message text goes to exactly one of these, and with the shipped settings that one is the
first.** The two DeepL rows are the only alternative, they are mutually exclusive with each
other and with Google, and reaching either requires you to change the provider setting *and*
enter your own key. Nothing else on the list ever receives message content.

**One request is made at startup**, and it is the update check: `src/Vencord.ts` calls
`checkForUpdates()`, which asks `api.github.com` for this project's latest release. It is
an unauthenticated GET — no account, no Discord user ID, no identifier of any kind, and
nothing about your settings or your messages. It carries your IP, as any HTTPS request
does. The same check runs again when you press **Check for Updates**, and on a 30-minute
timer only if you turn auto-update on *and* update notifications off — with the shipped
defaults there is no timer. Nothing else in the table above is contacted unless you do the
thing listed beside it.

The QuickCSS editor no longer fetches anything: Monaco is bundled inside the archive, so opening it
contacts nothing. Earlier versions loaded it from `cdn.jsdelivr.net`. The browser extension bundles
it too, as described in the browser section below.

## What Enforces That

Less than you might assume, so it is worth stating precisely.

The translation transport runs in the Electron **main process**, where the renderer's
Content Security Policy does not apply. It is guarded instead by an explicit hostname
allow-list checked before the request leaves
(`src/plugins/channelTranslator/native.ts`): non-HTTPS URLs, and any host other than the
three translation endpoints in the table above, are refused. The match is on the full
hostname with `===`, not a suffix or a wildcard, so `evil-deepl.com` is refused exactly as
`localhost` is. **That check — not the CSP — is what constrains where your message text can
go.** Adding DeepL added two entries to that set and nothing to the CSP, because the
translation transport never runs in the renderer.

The CSP allow-list is a separate thing, and it covers only requests **originating in the
renderer**. It holds 22 entries, unchanged by the DeepL provider. Two of them are in the table above
(`api.github.com`, `translate.googleapis.com`); four are loopback addresses for local
development; two are
Discord's own CDNs. The remaining fourteen exist so that **themes you choose to install**
can load images and fonts: GitHub Pages and `github.com`, `raw.githubusercontent.com`,
GitLab Pages and `gitlab.com`, Codeberg Pages and `codeberg.org`, githack, jsDelivr,
Imgur, ImgBB, Pinterest, Catbox and Google Fonts.
**None of those is contacted unless a theme you installed references it** — and a
CSP entry is a permission, not a request. The full list is `CspPolicies` in
`src/main/csp/index.ts`.

`scripts/checkHosts.mjs` enumerates every host present in `dist/desktop.asar` and
`dist/equibop.asar` and fails CI on anything not declared in `scripts/allowed-hosts.txt`. **It does
not cover the browser extension packages** — those are checked by
`scripts/checkExtensionPackages.mjs`, which verifies the transport, its allow-list, the manifests and
the archives, but does not yet enumerate every host inside them. Extending the host gate to the
extension is an open item.

Some settings screens link out to third-party sites — BetterDiscord's theme directory,
for instance. Those are ordinary links: nothing is requested until you click one.

Upstream Equicord additionally fetched donor badges from `badges.vencord.dev`
and `badge.equicord.org` on every start, keyed by your Discord user ID, and
loaded images from `equicord.org` inside the settings screens. **All of that has
been removed from this fork.**

## The Browser Extension

The Chrome, Edge and Firefox extension runs the same translator from the same source, but the
surroundings differ from the desktop app in ways worth stating plainly.

**Message text goes to the same three hosts, and the same kind of guard decides that.** There is no
Electron main process in a browser, so the transport runs in the extension's background context —
the only part of an extension that may fetch across origins. It carries the same allow-list, matched
the same way, in `browser/translationHost.js`: full hostname, `Set.has`, no suffix and no wildcard.
It additionally re-checks the host **after** any redirect, so an allowed host answering with a 302
cannot carry your text somewhere else. `test/allowedHosts.test.ts` holds that list identical to the
desktop one and fails the build if they diverge.

**The relay is reachable from the Discord page.** The translator itself runs in the page's own world,
so it asks for a translation by posting a message that a content script forwards to the background.
Any other script running on Discord could post the same message. What that buys an attacker is
bounded entirely by the allow-list above: it can cause a request to one of three translation
endpoints and read the reply. It cannot reach anywhere else, and it cannot read your Discord
credentials through this path.

**The extension removes Discord's Content-Security-Policy header.** This is inherited from the
upstream project and is what allows user themes and custom CSS to load images and fonts at all. It is
a real reduction in one of the page's defences, applied to every Discord tab for as long as the
extension is installed, and it is not specific to translation. It is done by
`browser/modifyResponseHeaders.json` on Chrome and `browser/background.js` on Firefox.

**Your settings live in the page's own storage.** On the desktop they are a file in the app's data
directory. In the browser they are `localStorage` on `discord.com`, under the key
`DiscordTranslatorSettings`. Anything else running on that page can read them — including a DeepL API
key, if you configure one. If that matters to you, use the desktop build for DeepL.

**No update check runs, and no changelog check either.** The web build ships no updater, and the
Changelog tab is compiled out of it for the same reason — that tab asks `api.github.com` for the
commits between the version you had and this one. It was originally left in, and this document
originally claimed the extension contacts nothing at `api.github.com` on the strength of a recorded
session showing only `discord.com` and `translate.googleapis.com`. **That evidence could not have
found it:** the request fires only once a previous version has been seen, so a fresh install is
exactly the case where it stays silent.

What is true now is checked against the built file rather than the source: the compare-URL
construction and the `vnd.github+json` header are both absent from the shipped browser bundle and
both present in the desktop one, so the removal is real and specific to this build. A single unused
string constant remains in the bundle with nothing referencing it.

**The QuickCSS editor no longer contacts a CDN either.** It loads Monaco from inside the extension,
as the desktop build loads it from inside the archive, so opening that editor requests nothing from
anyone. This mattered more here than it would elsewhere: because the extension removes Discord's CSP,
a script fetched from `cdn.jsdelivr.net` would have run in your logged-in Discord tab with nothing
left to constrain it. The editor and both of its language workers now come from the extension's own
files.

**Permissions the extension asks for, and why:** `*://*.discord.com/*` to run at all;
`translate.googleapis.com`, `api-free.deepl.com` and `api.deepl.com` for the translation transport;
`raw.githubusercontent.com` because that is where most people host the themes they install.

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
