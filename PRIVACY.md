# Privacy

Everything below describes the **desktop app** unless it says otherwise. The browser extension runs
the same translator but sits in a different place, and the differences are set out under
[The Browser Extension](#the-browser-extension).

## Data Transmission

When you enable channel translation, the text of messages is sent to the translation service you have selected, via the app's Electron main process. This transmission is necessary for translation to occur.

The default is Google's public translate endpoint, and with the shipped settings it is the only one used. There are two alternatives, and **neither is contacted unless you both change the provider setting and supply an API key of your own.** This app ships no key for either, shares none, and refuses to select a provider until you have entered its key.

- **DeepL**, reached at `api-free.deepl.com` or `api.deepl.com` depending on your key.
- **Google Cloud Translation**, reached at **`translation.googleapis.com`**. That is a *different host* from the default provider's `translate.googleapis.com`, three letters apart and not the same service: the default is Google's unofficial free endpoint, this one is the paid Cloud Translation v2 API, billed to a Google Cloud project of your own. Setting it up is described in [GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md).

Whichever you choose, your key is stored locally with the rest of your plugin settings and is sent only to that provider.

**This includes messages from other users who did not consent to translation.** You are responsible for ensuring that translating messages in a server complies with that server's policies and applicable laws.

## Local Storage

Three things are kept locally in the app's settings directory, and nothing about any of them is sent
to the app's author:

- **Your plugin settings**, including any API key you configure.
- **The translation cache** — message text alongside its translation, keyed by a hash of the text
  and the target language. It is what stops the app re-sending something it has already translated.
- **A per-month character count for the paid providers**, stored under `usageBlob`. This is what the
  spend meter on the plugin's settings screen displays. **It carries no message text of any kind**:
  it holds a month string such as `2026-08`, the provider ids `google-cloud` and `deepl`, and one
  integer for each — the number of characters sent to that provider this month. Nothing identifies a
  message, a channel or a person. It is replaced when the month rolls over, and the panel's reset
  button clears it. The default `google` provider is never counted, because it is not billed.
  See [GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md) for what the meter does and does not measure.

## Every Server This App Contacts

| Host | When | What it receives |
|---|---|---|
| `translate.googleapis.com` | the default provider: you enable translation, or double/triple-click text | the message text being translated, and the language pair |
| `api-free.deepl.com` | **only if** you set the provider to DeepL and configure a free DeepL key (free keys end in `:fx`) | the message text being translated, the language pair, and your own DeepL API key |
| `api.deepl.com` | **only if** you set the provider to DeepL and configure a paid DeepL key | the message text being translated, the language pair, and your own DeepL API key |
| `translation.googleapis.com` | **only if** you set the provider to Google Cloud Translation and configure a Google Cloud API key | the message text being translated, the language pair, and your own Google Cloud API key |
| `api.github.com` | at startup, and on any later update check | a request for this project's latest release; no account, no identifiers |
| `clients2.google.com` | only if you turn on **Enable React DevTools** | your IP, to download that extension |
| `discord.com` | continuously — it is Discord, and in the browser build it is the page the extension runs on | whatever you send Discord by using Discord. Nothing this app adds |
| `raw.githubusercontent.com` and the other theme-asset hosts | **only if** a theme or QuickCSS *you* installed references a file there | a request for that file, and your IP. No message text, no key, no identifier |
| `ko-fi.com`, `github.com`, `dagoat.io`, `betterdiscord.app` and other link targets | **only when you click the link**, from the translator panel or a settings screen | what any link click sends: that you arrived from here. Nothing is requested until you click |

**Why `raw.githubusercontent.com` is in that table and in the extension manifests.** It is one of
the fourteen CSP entries that exist so installed themes can load images and fonts, and it is the one
of them the browser extension also asks for as a host permission, because that is where most people
host the themes they install. A permission is what the extension *may* reach, not what it does
reach — nothing there is contacted unless a theme you chose points at it. The other theme hosts are
listed in full under [What Enforces That](#what-enforces-that).

**There are four translation hosts in that table, and the two `googleapis.com` rows are not the
same service.** `translate.googleapis.com` is Google's unofficial free endpoint and is the shipped
default; `translation.googleapis.com` is the paid Cloud Translation v2 API and is reached only if
you configure a key for it. The names differ by three letters and nothing else, which is exactly
why they are listed separately everywhere in this project rather than folded into one entry.

**Message text goes to exactly one of the four, and with the shipped settings that one is
`translate.googleapis.com`.** The other three are mutually exclusive with it and with each other,
and reaching any of them requires you to change the provider setting *and* enter your own key.
Nothing else on the list ever receives message content.

**This app makes one request of its own at startup**, and it is the update check — Discord's own
traffic to `discord.com` is not this app's and is not changed by it. `src/Vencord.ts` calls
`checkForUpdates()`, which asks `api.github.com` for this project's latest release. It is
an unauthenticated GET — no account, no Discord user ID, no identifier of any kind, and
nothing about your settings or your messages. It carries your IP, as any HTTPS request
does. The same check runs again when you press **Check for Updates**, and on a 30-minute
timer only if you turn auto-update on *and* update notifications off — with the shipped
defaults there is no timer. Nothing else in the table above is contacted unless the condition
listed beside it holds.

The QuickCSS editor no longer fetches anything: Monaco is bundled inside the archive, so opening it
contacts nothing. Earlier versions loaded it from `cdn.jsdelivr.net`. The browser extension bundles
it too, and as of v0.2.7 there is no remote fallback left anywhere — see the browser section below.

## What Enforces That

Less than you might assume, so it is worth stating precisely.

The translation transport runs in the Electron **main process**, where the renderer's
Content Security Policy does not apply. It is guarded instead by an explicit hostname
allow-list checked before the request leaves
(`src/plugins/channelTranslator/native.ts`): non-HTTPS URLs, and any host other than the
four translation endpoints in the table above, are refused. The match is on the full
hostname with `===`, not a suffix or a wildcard, so `evil-deepl.com` is refused exactly as
`localhost` is — and so is `translations.googleapis.com`, which is a near-miss on a real
entry rather than an obviously hostile name. **That check — not the CSP — is what constrains
where your message text can go.** Adding DeepL added two entries to that set and nothing to
the CSP; adding Google Cloud Translation added a fourth entry and, again, nothing to the CSP,
because the translation transport never runs in the renderer.

The CSP allow-list is a separate thing, and it covers only requests **originating in the
renderer**. It holds 22 entries, unchanged by the DeepL provider and unchanged by the Google
Cloud Translation provider: `translation.googleapis.com` was deliberately **not** added to it,
because a CSP entry would buy that provider nothing on the desktop and would grant any renderer
code a standing permission to reach that host. The reasoning is recorded beside the omission in
`src/main/csp/index.ts`. Two of the 22 are in the table above
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

**Message text goes to the same four hosts, and the same kind of guard decides that.** There is no
Electron main process in a browser, so the transport runs in the extension's background context —
the only part of an extension that may fetch across origins. It carries the same allow-list, matched
the same way, in `browser/translationHost.js`: full hostname, `Set.has`, no suffix and no wildcard.
`test/allowedHosts.test.ts` holds that list identical to the desktop one and fails the build if they
diverge.

**Redirects are refused, not followed — and that sentence used to be wrong here.** Every request all
three transports make is now issued with `redirect: "manual"`, on the GET as well as the POST, so an
allowed host answering with **any** 3xx is refused at that point and nothing travels onward. The
refusal is unconditional: it does not ask where the redirect pointed, so a redirect back to the same
host is refused too. Until this was fixed, this document
said the host was "re-checked **after** any redirect, so an allowed host answering with a 302 cannot
carry your text somewhere else". The code did re-check, and the claim was still false: the transports
fetched with the default redirect mode, which means the runtime had **already followed** the redirect
and delivered the request before there was anything to inspect. A 307 or 308 replays the POST body —
your message — verbatim at the new origin. The check withheld the *reply*; it never prevented the
*send*. It is still there as a backstop and its refusal is now worded so that it cannot be misread as
having stopped the request.

**One build is not covered by that, and it is worth naming.** The userscript build
(`dist/DiscordTranslator.user.js`) does not use the browser's `fetch`; it uses `GM_xmlhttpRequest`
through `browser/GMPolyfill.js`. Whether `redirect: "manual"` means anything there is the userscript
manager's decision: Tampermonkey documents such an option, while Violentmonkey and Greasemonkey
document none and ignore keys they do not recognise. Under those two the redirect is followed and
your message reaches the other origin, exactly as described above. The option is passed regardless
because it helps wherever it is honoured, but no test in this project drives a real userscript
manager, so for that build treat this as unverified mitigation rather than a guarantee. The
extension and desktop builds do not have this caveat.

**The relay is reachable from the Discord page.** The translator itself runs in the page's own world,
so it asks for a translation by posting a message that a content script forwards to the background.
Any other script running on Discord could post the same message. What that buys an attacker is
bounded entirely by the allow-list above: it can cause a request to one of the **four** translation
endpoints and read the reply. It cannot reach anywhere else, and it cannot read your Discord
credentials through this path.

**Be precise about what that request can carry, because it changed.** The Google Cloud provider is a
POST, and supporting it meant the relay had to accept a request body where before it only ever
issued a GET. So the relay is no longer a pull-only channel: a script on the Discord page can now
push content of its own choosing to one of those four hosts, not merely ask one of them a question.
That is a data-exfiltration path in shape, and the only thing limiting it is the destination list,
not the direction of travel: the content can land at a translation endpoint and nowhere else. What
those four services do with what they receive is their business and this project cannot speak for
it — read their own terms. If you have configured a Google Cloud or paid DeepL key, note that this
path can also spend it.

**Be equally precise about the size of it, because 1,048,576 characters is a per-request figure and
reads like a total.** `MAX_BODY_CHARS` caps **one** request body at 1,048,576 characters. It is not
a budget, a daily allowance, or anything that accumulates. **There is no rate limit anywhere in the
relay** — `browser/translationHost.js` and `browser/content.js` contain no throttle, no cooldown and
no per-page quota — so a script may send that request again immediately, and again after that. The
real bound is therefore *1,048,576 characters per request multiplied by an unlimited number of
requests*, which is to say the cap bounds the size of a single push and does not bound the total at
all. What it actually buys is that bulk data cannot be moved in one shot; it does not stop it being
moved.

**What is checked on the way out.** The body is validated in `browser/translationHost.js`: only
`method` and `body` are accepted, any other key (including `headers`) is refused rather than
ignored, and only GET and POST are allowed. **Any redirect answer is refused rather than followed**
— not merely one pointing away from an allowed host, and not merely the statuses that replay a body:
the check treats every 3xx, and every opaque-redirect response, as a refusal whatever it points at.
That matters for a POST because a cross-origin 307 replays the body, and it matters for a GET too,
because the free provider carries your message in the query string rather than in a body.

**The extension removes Discord's Content-Security-Policy header.** This is inherited from the
upstream project and is what allows user themes and custom CSS to load images and fonts at all. It is
a real reduction in one of the page's defences, applied to every Discord tab for as long as the
extension is installed, and it is not specific to translation. It is done by
`browser/modifyResponseHeaders.json` on Chrome and `browser/background.js` on Firefox.

**Your settings live in the page's own storage.** On the desktop they are a file in the app's data
directory. In the browser they are `localStorage` on `discord.com`, under the key
`DiscordTranslatorSettings`. Anything else running on that page can read them — including any API
key you configure, including the translation cache, which holds message text alongside its
translation, and including the `usageBlob` character count described under
[Local Storage](#local-storage). Of those three the cache and the key are what matter: `usageBlob`
holds only a month string, the two paid provider ids and an integer each, so reading it reveals how
much you translated and nothing about what. If any of this matters to you, use the desktop build.

**This is worse for a Google Cloud Translation key**, because that key is attached to a billing
account and a stolen one can be charged to your card, where a stolen DeepL free key cannot. The
desktop build is the safer place for any paid key. If you use the browser extension anyway, set a
quota cap on the key so the damage is bounded — see
[GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md), which covers key restriction and the cap, and
which is blunt about the size of the bill an uncapped key can reach.

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

**The QuickCSS editor no longer contacts a CDN, and there is no fallback that could.** It loads
Monaco from inside the extension, as the desktop build loads it from inside the archive, so opening
that editor requests nothing from anyone. This mattered more here than it would elsewhere: because
the extension removes Discord's CSP, a script fetched from `cdn.jsdelivr.net` would have run in your
logged-in Discord tab with nothing left to constrain it.

A fallback to that CDN survived until v0.2.7, reachable if the bundled copy failed to load. It is
gone: `scripts/checkExtensionPackages.mjs` now fails the build if any CDN reference or remote import
appears anywhere in either package. The editor and both of its language workers come from the
extension's own files, and nothing else can.

### Permissions the extension asks for, and why

This is the complete list from both shipped manifests — `browser/manifest.json` (Manifest V3, for
Chrome and Edge) and `browser/manifestv2.json` (Manifest V2, for Firefox). It used to name only the
hosts, which made it look complete while leaving out the two API permissions that do the most.

**Host permissions.** Six, identical in both manifests. In MV3 they are the `host_permissions` key;
MV2 has no such key, so they sit in `permissions` alongside the API permissions below.

| Host permission | Why it is asked for |
|---|---|
| `*://*.discord.com/*` | to run on Discord at all — the content scripts, the translator, and the header rule below |
| `https://translate.googleapis.com/*` | the default free provider's endpoint |
| `https://translation.googleapis.com/*` | the paid Cloud Translation v2 API, contacted only if you configure a Google Cloud key |
| `https://api-free.deepl.com/*` | DeepL, free keys |
| `https://api.deepl.com/*` | DeepL, paid keys |
| `https://raw.githubusercontent.com/*` | so a theme *you* installed can load files from there, and so its stylesheets arrive with a usable content type |

That is **four** translation hosts, and both manifests request all four.
`translation.googleapis.com` is requested even though nothing contacts it unless you configure a
Google Cloud key, because a manifest permission is declared once at install time and cannot be
asked for later when you happen to need it. A permission is what the extension *may* reach, not
what it does reach.

**API permissions.** These are not hosts, and they are what let the extension change Discord's
response headers. Each browser needs a different one because the two manifest versions provide
different mechanisms for the same job.

- **`declarativeNetRequest`** — Chrome and Edge (MV3). It lets the extension ship a **static rule
  file**, `browser/modifyResponseHeaders.json`, that the browser applies on its own. Two rules:
  strip the `content-security-policy` and `content-security-policy-report-only` response headers
  from `discord.com` main and sub frames, and force `Content-Type: text/css` on stylesheets from
  `raw.githubusercontent.com`. The important property is what it does **not** grant: rules are
  declarative, so the extension never sees the requests or their contents. It cannot read your
  traffic through this permission — it can only ask the browser to rewrite those named headers.
- **`webRequest`** and **`webRequestBlocking`** — Firefox (MV2), which has no
  `declarativeNetRequest`. These do the same two jobs through code instead: `browser/background.js`
  registers a **blocking** `onHeadersReceived` listener and edits the header array as responses
  arrive. That is a stronger permission than the MV3 one, because a blocking listener genuinely
  does observe response metadata rather than only declaring a rewrite. It is scoped in the listener
  to `https://raw.githubusercontent.com/*` and `*://*.discord.com/*`, and to `main_frame` and
  `stylesheet` requests only; it reads and edits **headers**, and never response bodies. The MV2
  rule is also narrower than the MV3 one — it removes `content-security-policy` on the main frame
  and leaves `content-security-policy-report-only` alone.

**Stripping Discord's CSP is the consequential one**, on both browsers, and it is covered on its own
above — it is inherited from the upstream project, it is what makes user themes and custom CSS work
at all, and it applies to every Discord tab for as long as the extension is installed.

**Firefox also declares what data the add-on collects**, under `data_collection_permissions` in
`browser/manifestv2.json`, and Firefox shows that declaration at install time. Three entries are
declared as required: `personalCommunications` (the Discord messages being translated),
`websiteContent` (the same text, as page content), and `authenticationInfo` (your own provider API
key — DeepL's or Google Cloud's — stored locally and sent only to the provider it belongs to, and
only if you configure one). Declaring none would have been false, which is why they are there.

## Everything Clickable in the Translator Panel

The floating translator panel carries **three outbound destinations** below its controls, all of
them the author's, and this section lists all three rather than only the one that needed the most
explaining. `src/plugins/channelTranslator/panel/Panel.tsx` is the file.

| What you see | Where it goes | What it is made of |
|---|---|---|
| **Support me on Ko-fi** — a coffee-cup button reading `@IRP_HongKong` | `ko-fi.com`, the author's donation page | a button, an inline SVG and text |
| **Star Project on Github** — a star button | `github.com`, this project's own repository | a button, an inline SVG and text |
| **The Goat Project banner** — also shown in the settings tab | `dagoat.io`, the author's own separate project | a hyperlink, an inline SVG lockup and text |

**None of the three makes a request of any kind.** No fetch, no image load, no web font, no
analytics, no tracking parameter on any of the destinations. Every graphic is inline SVG drawn by
the panel itself, and the panel's stylesheet references no remote asset. The Ko-fi and GitHub
buttons are `<button>` elements that call `window.open(..., "noopener,noreferrer")` when clicked;
the banner is a plain `<a href>`. Until you click one, nothing about any of these hosts is
contacted.

`dagoat.io` does not appear in the request log of a full session — the only hosts contacted were
`discord.com` and the translation provider. Clicking any of the three sends only what any link
click sends: that you arrived from this app.

**The Ko-fi button is a donation link and the Goat Project banner is self-promotion.** Neither is
paid advertising, and both go to the same person who wrote this app.

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
