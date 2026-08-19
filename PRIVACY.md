# Privacy

## Data Transmission

When you enable channel translation, the text of messages is sent to a configured translation service (currently Google's public translate endpoint) via the app's Electron main process for processing. This transmission is necessary for translation to occur.

**This includes messages from other users who did not consent to translation.** You are responsible for ensuring that translating messages in a server complies with that server's policies and applicable laws.

## Local Storage

The translation cache is stored locally in the app's settings directory. Nothing about your translations is sent to the app's author.

## What is Not Transmitted

No data is sent to Discord Translator's author. No telemetry, no analytics, no account information.

## Direct Messages

Direct messages and group DMs are excluded from translation by default. If you enable the `includeDMs` setting, DMs will be included and sent to the translation service.

## Control

Translation only occurs when you enable it for a specific server via the per-server toggle.
