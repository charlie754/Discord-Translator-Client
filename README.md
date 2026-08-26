# Discord Translator

A Discord client mod that translates a whole channel, including scrollback, into your language.

![Discord Translator translating a Japanese channel](assets/preview.gif)

## Features

- **Whole-channel translation** with a per-server toggle
- **Replace mode** and **Both Language mode** for viewing
- **Selection translation**: double-click a word or triple-click a sentence to translate a selection; shows the original when already translated
- **Floating panel** at the top-right of the chat area
- **15 target languages** supported
- **Spend meter and optional monthly character cap** for the paid providers — the cap is off by default

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

**DeepL is the way out of that**, using an API key of your own:

1. Get a key from [DeepL’s API page](https://www.deepl.com/pro-api). The free tier is enough for ordinary use; free keys end in `:fx`.
2. Open **Settings → Plugins → ChannelTranslator**.
3. Paste the key into **deeplApiKey**, then set **Provider** to **DeepL (your own key)**.

The key is yours: this project ships none and shares none. It is stored locally alongside your other plugin settings and is sent only to DeepL. Free keys are routed to `api-free.deepl.com` and paid keys to `api.deepl.com` — the app picks the host from the `:fx` suffix, so there is nothing else to configure.

Select DeepL without entering a key and the app says so and translates nothing. It will not fail silently.

**Google Cloud Translation is the third option**, and it is the official, quota-backed Google endpoint rather than the unofficial one above. It needs a Google Cloud account with **billing enabled** — required even to use the allowance, so a card has to be on file either way — and it charges **USD 20 per million characters**. It also sends your messages to `translation.googleapis.com`, which is a different host from the free endpoint above.

**There is no free tier here, and calling it one sets the wrong expectation.** What Google gives is a **monthly credit of up to USD 10**, which covers roughly the first 500,000 characters at that price. It is shared with Cloud Translation - Advanced, it does not roll over, and it is not a stop: cross it and the next character is simply billed to your card.

Setting it up is longer than pasting a DeepL key, so it has its own guide: [GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md), which covers the project, the API, the key, and the restrictions and quota cap that keep a leaked key from running up a bill. **Read its first section before you start.** An alerts-only Cloud Billing budget — the kind you will be offered — does not cap spending, and a new project has no daily character limit at all. The guide gives the real worst-case number, the one control that actually stops a request, and what Google's newer *spend cap* budget does and does not cover.

As with DeepL: **paste the key first, then switch the provider.** Selecting a key-requiring provider before its key is in place makes the plugin refuse to translate and say so — correctly, but on a configuration you were halfway through.

### Watching what a paid provider costs

If you use Google Cloud Translation or DeepL, the plugin’s own settings screen carries two things, directly under the API key field:

- **A spend meter** showing how many characters have gone to each paid provider this month, with a dollar estimate for Google Cloud. It is an **estimate** and cannot match Google’s invoice: it counts only what this plugin sent, so anything else on the same billing account spending the same credit is invisible to it.
- **A monthly character cap**, which is **switched off by default** (`monthlyCharacterCap` ships as `0`). Set a number and the plugin refuses to send a message once that month’s total would cross it. It guards against your own heavy month; it **cannot** stop a leaked key, because a leaked key is spent from somebody else’s machine. Only the Google-side quota can do that.

The free **Google (free)** provider is not metered, because nothing bills it. Both controls are documented in [GOOGLE_CLOUD_SETUP.md](./GOOGLE_CLOUD_SETUP.md), and what the meter stores locally is in [PRIVACY.md](./PRIVACY.md).

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
