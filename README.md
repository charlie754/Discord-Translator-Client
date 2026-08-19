# Discord Translator

A Discord client mod that translates a whole channel, including scrollback, into your language.

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

## Privacy

Message text is sent to a third-party translation service for processing. This includes other people’s messages. See [PRIVACY.md](./PRIVACY.md) for details.

DMs and group DMs are excluded from translation by default.

## Terms of Service

Client modifications are against Discord’s Terms of Service. There are no known cases of bans for using client mods, but the risk is not zero and it is your account at stake.

## Credits and Licence

Discord Translator is licensed under GPL-3.0. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md) for attribution and derivative information.
