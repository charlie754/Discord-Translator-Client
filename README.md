# Discord Translator

A Discord client mod that translates a whole channel, including scrollback, into your language.

![Discord Translator translating a Japanese channel](assets/preview.gif)

*A Japanese server, translated in place. 47 seconds at 33fps and 86 MB, so give it a moment to load — or watch it on the [releases page](https://github.com/charlie754/Discord-Translator-Client/releases/latest) instead.*

## Features

- **Whole-channel translation** with a per-server toggle
- **Replace mode** and **Both Language mode** for viewing
- **Selection translation**: double-click a word or triple-click a sentence to translate a selection; shows the original when already translated
- **Floating panel** at the top-right of the chat area
- **15 target languages** supported

## Install

Prebuilt releases will be available on the [Releases](https://github.com/charlie754/Discord-Translator-Client/releases) page.

To build from source:

```shell
pnpm install
pnpm build
pnpm inject
```

To uninstall:

```shell
pnpm uninject
```

To repair after a Discord update:

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
