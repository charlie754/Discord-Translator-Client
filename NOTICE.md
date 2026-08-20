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

The following further modifications were made on August 19, 2026, and are the changes
released as v0.2.0:

- Removed every remaining third-party endpoint and Equicord string, including the donor
  badge and cloud service hosts
- Restricted the main-process translation transport to an explicit hostname allow-list,
  and corrected the translation host actually contacted
- Stopped shipping sourcemaps in the packed archives
- Vendored the Monaco editor into the archive, so the QuickCSS editor no longer fetches
  its code from a CDN
- Rebranded the browser and userscript variants
- Removed upstream's Cloud Settings tab, and disabled settings sync at startup for
  installs upgraded from an earlier version
- Added a Goat Project campaign banner to the translator panel and the settings tab

### Source Attribution

All upstream copyright notices are preserved in the source code. The message-interception technique, patch anchor, and translation regexes used by the ChannelTranslator feature are derived from Equicord's own `MessageTranslate` plugin.

Complete corresponding source is available at https://github.com/charlie754/Discord-Translator-Client, satisfying GPL-3.0 section 6(d).
