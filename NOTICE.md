# Notices

## Derivative Work

Discord Translator is a derivative of [Equicord](https://github.com/Equicord/Equicord), which is itself a fork of [Vencord](https://github.com/Vendicated/Vencord) by Vendicated and contributors.

Both Equicord and Vencord are licensed under GPL-3.0, as is Discord Translator.

### Provenance

Discord Translator was created by importing Equicord at commit `d48e3d7bfc9731deda7654a82b8898b6e032dd16` (dated August 17, 2026).

### Modifications

The following modifications were made on August 18, 2026:

- Rebranded application identity and data directory from Equicord to Discord Translator
- Removed 361 bundled plugins, leaving only the core API and infrastructure
- Removed Equicord's CI workflows
- Removed the bundled Vencord translate plugin
- Added the ChannelTranslator feature

### Source Attribution

All upstream copyright notices are preserved in the source code. The message-interception technique, patch anchor, and translation regexes used by the ChannelTranslator feature are derived from Equicord's own `MessageTranslate` plugin.

Complete corresponding source is available at https://github.com/charlie754/Discord-Translator-Client, satisfying GPL-3.0 section 6(d).
