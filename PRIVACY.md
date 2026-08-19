# Privacy

## Data Transmission

When you enable channel translation, the text of messages is sent to a configured translation service (currently Google's public translate endpoint) via the app's Electron main process for processing. This transmission is necessary for translation to occur.

**This includes messages from other users who did not consent to translation.** You are responsible for ensuring that translating messages in a server complies with that server's policies and applicable laws.

## Local Storage

The translation cache is stored locally in the app's settings directory. Nothing about your translations is sent to the app's author.

## Every Server This App Contacts

Two, and only two:

| Host | When | What it receives |
|---|---|---|
| `translate-pa.googleapis.com` | you enable translation, or double/triple-click text | the message text being translated, and the language pair |
| `api.github.com` | on update checks | a request for this project's latest release; no account, no identifiers |

The app's Content Security Policy allow-list contains exactly these two hosts
plus Discord's own CDNs and the public code-hosting sites used for loading
user-supplied themes. Any other outbound request is blocked by the app itself.

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
