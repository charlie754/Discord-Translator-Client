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

The following further modifications were made on August 21, 2026:

- Gave the browser extension a working translation transport. Upstream's web build stubs
  `pluginHelpers` as an empty object, so the translator rendered its panel and then failed
  every translation with "native bridge unavailable". Added `browser/translationHost.js`
  (extension background), the relay in `browser/content.js`, and
  `browser/translationBridge.ts` (page world)
- Carried the main-process hostname allow-list across to both browser transports, matched
  the same way, and made it additionally re-check the host after a redirect
- Added `test/allowedHosts.test.ts`, which holds all three copies of that allow-list to the
  same set and exercises each one
- Declared the translation providers in both manifests, which previously granted no
  permission to reach them
- Replaced upstream's extension description and the `firefox@equicord.org` Gecko add-on ID
- Replaced the extension icon, which was still upstream's Vencord/Equicord mark, with this
  project's own artwork at every size both browsers ask for, and pinned its absence in CI
- Made the release workflow run the unit tests, and build, verify and publish the Chrome and
  Firefox extension packages

The following further modifications were made on August 22, 2026:

- Made the browser QuickCSS editor load Monaco from inside the extension instead of from
  `cdn.jsdelivr.net`. The extension removes Discord's Content-Security-Policy, so a CDN
  script would have executed in the logged-in Discord origin unconstrained. The fetch is
  performed by the opening page rather than by the editor popup, because a popup carrying
  the page origin cannot load extension resources; its language workers are started from
  same-origin blob URLs for the same reason
- Removed the Changelog settings tab from the web build, which reached `api.github.com`
  and made this project's privacy notice inaccurate for the browser extension
- Added `scripts/checkExtensionPackages.mjs` and wired it into the release workflow
- Labelled the Goat Project banner with the product it belongs to, and disclosed the
  promotion in README.md and PRIVACY.md rather than only in this changelog

### Source Attribution

All upstream copyright notices are preserved in the source code. The message-interception technique, patch anchor, and translation regexes used by the ChannelTranslator feature are derived from Equicord's own `MessageTranslate` plugin.

Complete corresponding source is available at https://github.com/charlie754/Discord-Translator-Client, satisfying GPL-3.0 section 6(d).
