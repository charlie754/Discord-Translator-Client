# Discord Translator

A Discord client mod that translates a whole channel, including scrollback, into your language.

![Discord Translator translating a Japanese channel](assets/preview.gif)

## Features

- **Whole-channel translation** with a per-server toggle
- **Replace mode** and **Both Language mode** for viewing
- **Selection translation**: double-click a word or triple-click a sentence to translate a selection; shows the original when already translated
- **Floating panel** at the top-right of the chat area
- **15 target languages** supported
- **Free providers only** — no API key, no card, nothing that can bill you

## Install

Two builds, from the same source and with the same translator.

### Desktop app

Use the [Discord Translator Installer](https://github.com/charlie754/Discord-Translator-Installer/releases/latest).
It downloads `desktop.asar` from the latest release here and patches your existing Discord — you do not
install a second app. **Close Discord completely first**, including the tray icon.

### Browser extension (Chrome, Edge, Firefox)

For Discord in a browser tab. Download from the
[latest release](https://github.com/charlie754/Discord-Translator-Client/releases/latest):

**Chrome and Edge** — `extension-chrome.zip`

1. Unzip it somewhere you will not delete
2. Open `chrome://extensions` (Edge: `edge://extensions`)
3. Turn on **Developer mode**
4. **Load unpacked** → select the unzipped folder
5. Reload any Discord tab that was already open, then open a **server channel**

**Firefox** — `extension-firefox.zip`

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select the zip (it takes the archive directly; no need to unpack)
3. Reload any Discord tab that was already open — the add-on cannot alter a page that finished
   loading before it started
4. Open a **server channel**

**On Firefox this lasts until you close the browser.** A permanent install needs the add-on to be
signed by Mozilla, and it is not signed yet — so on release Firefox there is currently no way to keep
it installed across restarts. Firefox Developer Edition and Nightly can keep it by setting
`xpinstall.signatures.required` to `false` in `about:config`, which lowers a real security protection
for every add-on you install, not just this one.

**There is no toolbar button, and the panel is hidden in DMs by design.** Open a server channel and
look at the top-right of the chat area for the translator panel. On the Friends or DM screen there is
nothing to see, which is expected rather than a failure.

Neither extension is in the Chrome Web Store or on addons.mozilla.org.

### Build from source

```shell
pnpm install

pnpm build      # desktop
pnpm inject     # patch Discord; Discord must be fully closed

pnpm buildWeb   # browser; writes dist/extension-chrome.zip and dist/extension-firefox.zip
```

To uninstall the desktop patch:

```shell
pnpm uninject
```

To repair it after a Discord update:

```shell
pnpm repair
```

Discord must be fully closed when injecting or repairing.

## Translation providers

**The default is Google’s `translate.googleapis.com/translate_a/single?client=gtx` endpoint.** It is the default so the app works the moment you install it — nothing to sign up for, no key to paste.

Be clear about what that endpoint is: **it is unofficial.** Google publishes no terms, no quota and no guarantee for it, and it *will* rate-limit you if you translate heavily. When it does, the panel reads **Rate limited** and translation pauses until it recovers.

**The Apps Script proxy is the way out of that**, and it is the only other provider. It is still free: you deploy a small script into **your own** Google account and the plugin posts to that deployment instead of to the gtx endpoint.

1. Follow the guide at `site\free\index.html` in this repository. The extension builds ship it as `guide.html`, reachable from the plugin's settings screen.
2. Paste the script from `site\apps-script-proxy.gs` into a new Apps Script project and deploy it as a Web App.
3. Open **Settings → Plugins → ChannelTranslator**, paste the deployment URL, then set **Provider** to the Apps Script option.

**There is no API key and no billing, because Apps Script has neither.** The ceiling is a daily call quota — roughly 5,000 on a consumer account — and crossing it makes the deployment *refuse*, not charge. The URL is yours: this project ships none and shares none. It is stored locally alongside your other plugin settings and is sent only to Google, to reach the deployment it names.

Select the Apps Script provider without entering a deployment URL and the app says so and translates nothing. It will not fail silently.

### No paid providers, and no way to spend money

**Both paid providers were removed.** Google Cloud Translation v2 and DeepL are gone, along with their API-key settings, the spend meter and the monthly character cap — those existed only to bound a bill that can no longer happen.

The two remaining providers are free by construction, not by tier:

- **Google (free)** takes no credential at all. There is nothing to sign up for and nothing to bill.
- **Apps Script** runs on your own Google account, where the quota refuses rather than charges.

The hosts those two providers used are no longer reachable from any build. They were removed from the allow-list in all three transports, from both browser manifests, and from `scripts\allowed-hosts.txt` — so a build that tried to contact one would fail the host audit rather than ship. What the plugin stores locally is in [PRIVACY.md](./PRIVACY.md).

## Disclosure

The translator panel carries three outbound destinations, and all three are the author's:

- A **banner linking to [Goat Project](https://dagoat.io)**, also shown in the settings tab.
  **Goat Project is the author's own project**, so this is self-promotion rather than paid
  advertising.
- A **Ko-fi donation button** linking to the author's page at `ko-fi.com`.
- A **Star Project on Github** button linking to this repository.

Each is a link, an inline SVG and some text. **None of them makes a network request**, runs code,
mines anything or sends anything — those hosts are contacted only if you click. Nothing about you or
your messages reaches any of them either way. [PRIVACY.md](./PRIVACY.md) lists all three.

## Privacy

Message text is sent to a third-party translation service for processing. This includes other people’s messages. See [PRIVACY.md](./PRIVACY.md) for details, including every host contacted and what each one receives.

DMs and group DMs are excluded from translation by default.

## Terms of Service

Client modifications are against Discord’s Terms of Service. There are no known cases of bans for using client mods, but the risk is not zero and it is your account at stake.

## Credits and Licence

Discord Translator is licensed under GPL-3.0. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md) for attribution and derivative information.
