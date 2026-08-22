# Discord Translator

A Discord client mod that translates a whole channel, including scrollback, into your language.

![Discord Translator translating a Japanese channel](assets/preview.gif)

## Features

- **Whole-channel translation** with a per-server toggle
- **Replace mode** and **Both Language mode** for viewing
- **Selection translation**: double-click a word or triple-click a sentence to translate a selection; shows the original when already translated
- **Floating panel** at the top-right of the chat area
- **15 target languages** supported

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

## Privacy

Message text is sent to a third-party translation service for processing. This includes other people’s messages. See [PRIVACY.md](./PRIVACY.md) for details, including every host contacted and what each one receives.

DMs and group DMs are excluded from translation by default.

## Terms of Service

Client modifications are against Discord’s Terms of Service. There are no known cases of bans for using client mods, but the risk is not zero and it is your account at stake.

## Credits and Licence

Discord Translator is licensed under GPL-3.0. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md) for attribution and derivative information.
