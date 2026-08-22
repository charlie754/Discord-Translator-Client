# Turn report — Discord whole-channel translator: exploration & verdict

**Date:** 2026-08-18
**Agent seat:** Claude (architect / chair)
**Status:** Partial — research complete, design decision pending operator input
**Authority:** Operator request (brainstorming + openspec-explore): "explore shall we use independent
project or rely on 3rd party like Vencord. Seek verdict, path, draft plan and roadmap."

## 1. Objective

Decide the build surface for a Discord plugin that translates an **entire channel** (not
message-by-message) with an **on/off toggle in the top-right panel**, flipping between original and
target language. Operator preference: independent, simple, fully controllable. Operator ruling
mid-turn: **desktop first, browser second.**

## 2. Plan / routing

One `Workflow` run, 14 agents, 2 phases, 0 errors, ~1.79M subagent tokens, 642 tool calls, ~27 min.

- **Phase Research (7 agents, effort high):** desktop-mod-loader-landscape · existing-translator-plugins
  · client-interception-mechanics · translation-backends-and-cost · own-injector-true-cost ·
  risk-and-privacy-register · browser-phase2-and-shared-core.
- **Phase Verify (7 agents, effort high):** one adversarial verifier per dimension, instructed to
  **refute by default** and forbidden from restating a claim as its own proof.

Chair-side verification performed directly in session (not delegated):

- Vencord LICENSE fetched from raw.githubusercontent.com → **GPL-3.0**, "Version 3, 29 June 2007".
- `curl -I https://discord.com/app` → `Permissions-Policy: interest-cohort=()`, with a negative
  control returning 0. **No `translator` directive** — the on-device path is not blocked by Discord.

## 3. What changed

No product code. Exploration only (brainstorming HARD GATE; openspec-explore writes no artifacts).
This report is the sole artifact.

## 4. Verification evidence

**15 researcher claims were REFUTED by adversarial verification.** The corrections that move the
decision:

| # | Refuted claim | Correction |
|---|---|---|
| 1 | "Whole-channel translation is an unimplemented gap" | **False outside upstream Vencord.** Equicord ships `MessageTranslate` (whole-channel, caching, per-channel/guild/user ignore lists). BetterDiscord's store ships `AutoTranslate` v0.3.2 (Snues, added 2026-04-10, updated 2026-06-17, 5,754 downloads, Google Translate, 249 languages, hover-to-reveal-original) — **manually review-approved**. |
| 2 | "BetterDiscord's store is hostile to a network-calling translator" | False — see above; it passed review. Real constraints are narrower: no self-update systems, public GitHub repo required. |
| 3 | "A CSP-patching subsystem is mandatory" | False. Main-process IPC bypasses `connect-src` entirely — Vencord's Translate already does this for DeepL/Kagi. Plus `NativeSettings.store.customCspRules` exists. An entire claimed cost centre evaporates. |
| 4 | "Bots structurally cannot show one reader a private translation" | Mechanism wrong, conclusion survives. Bots **can** via ephemeral interaction responses (PersonalTranslator, $2.99/mo). The real block: ephemeral requires an interaction response, so a bot can never auto-push. Open request `discord-api-docs#7693` (filed 2025-07-18, **no staff reply**). |
| 5 | "LLM backends are cheaper than per-character MT" | Holds only for Latin script and only above free tiers. CJK carries a 1.7–2.4x token tax; Azure F0 is free to 2M chars/mo forever; a Gemini flash free tier exists. **Cost must not carry the architecture decision — quality on slang/attribution should.** |
| 6 | "Desktop fiber/webpack techniques transfer to a browser content script" | **False and load-bearing.** Fiber expandos and webpack modules live in the page heap, unreachable from an isolated world. Main world reintroduces discord.com's CSP → needs a declarativeNetRequest header strip. Desktop and browser extractors are **different architectures**. |
| 7 | "Scrollback backfill via RestAPI is a self-bot BLOCKER" | Downgraded to precautionary posture. The Vencord wiki definition covers automating actions and non-official connections and is silent on reading history; a RestAPI call from inside the official client is not a non-official connection. |
| 8 | "Equicord's HeaderBar is a stable API that de-risks the toggle" | It is `findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '"aria-haspopup":')` — it **centralises** fragility, it does not remove it. |

**Confirmed and load-bearing:**

- Vencord/Equicord userplugins **require a full source build** (git + Node + pnpm, clone,
  `pnpm install`, `pnpm build`, `pnpm inject`). Vencord's own doc opens with
  `:::danger ... for **advanced users**`.
- BetterDiscord: one `.plugin.js` into a folder. 8.1M installer downloads vs Vencord's 12.8M.
- `addChannelToolbarButton(id, render, priority)` exists **only in Equicord** — the exact top-right
  placement. Vencord upstream has no header API but does have `addChatBarButton` (no-patch,
  composer-adjacent).
- shelter installs by pasting a URL, but installing it repoints Discord's update endpoint to
  `https://inject.shelter.uwu.network/shelter`; its docs state "If this server is down, your app
  likely will not open."
- Discord shipped **five web builds in five hours on 2026-08-18** — renderer code rots continuously
  regardless of who owns the loader.
- Discord ToS carries a **second, better-fitting hook** than client modification: a prohibition on
  "scraping our services without our written consent, including by using any robot, spider, crawler,
  scraper, or other automatic device."
- Chrome Translator API: stable since Chrome 138, on-device, free, no key, ~39 language codes,
  Edge 148+. **Dead in Firefox** (Mozilla negative standards position). `availability()` has **four**
  states including `downloading`. "Translations are processed sequentially" — that is the backfill
  latency model. Not available in Web Workers, therefore not in an MV3 service worker.
- Licences: Vencord **GPL-3.0** (chair-verified), Vesktop GPL-3.0-or-later.

**The winning interception technique**, found in Equicord's `MessageTranslate` and endorsed by the
mechanics verifier over both options its own researcher proposed — clone, don't mutate, at the memo
boundary:

```
Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content: translated })
```

The clone goes only to the renderer. The store keeps the original, so copy, reply-quote,
edit-prefill and search are never corrupted, and toggle-off needs no restore path. Discord's own
renderer parses markdown, mentions and emoji. Requires the 3-arg parser
`Parser.parse(text, true, { channelId, messageId })`, or mentions and role pills fail to resolve.

**A `MESSAGE_CREATE` Flux hook cannot deliver the goal** — it fires only on live arrivals, and
reading a foreign-language server is overwhelmingly scrollback. A render-boundary hook covers
history for free.

## 5. Gate A / Gate B status

- **Gate A (research hygiene):** PASS. 14/14 agents returned, 0 errors; an adversarial pass ran on
  every dimension; 15 refutations captured; the chair independently re-verified the licence and the
  Permissions-Policy header, the latter with a negative control.
- **Gate B (product decision):** NOT MET — by design. The surface decision is the operator's and is
  open. No code exists and none should until a design is approved.

## 6. Residual hazards

- **HIGH — data egress.** Whole-channel translation ships every participant's words to a third party
  who never consented. DeepL Free T&C 3.3.2 reserves perpetual storage. Mitigation: DMs and group
  DMs excluded by default, a first-run consent screen naming the provider, opt-in and never auto-on.
- **HIGH — do not inherit the shared key.** Vencord's Google path uses a hardcoded key
  (`AIzaSyDLEeF...`) against the undocumented `translate-pa.googleapis.com`. Channel scale is 2–3
  orders of magnitude more requests and would risk revocation for the entire Vencord userbase.
- **HIGH — silent patch failure.** A stale patch logs to console only; the plugin still shows
  enabled. The build must ship a startup self-test that asserts every patch matched and fails
  *visibly*, or the user reads untranslated text believing the plugin is on.
- **MEDIUM — Azure F0 burst shape.** 2M chars/month free, but throttled to ~33,300 chars/minute on a
  sliding window, 50,000 chars and 1,000 array elements per request. Toggle-on backfill is exactly
  the bursty pattern that trips it.
- **MEDIUM — silent mistranslation.** Short, slang-heavy, emoji- and mention-laden fragments are the
  worst case for MT. The product's core failure mode is quiet, not loud.
- **MEDIUM — ToS.** Zero documented bans for client modding as of 2026, but the evidence is
  self-interested (mod vendors). Vencord's own FAQ advises against client mods on an account whose
  loss would be a disaster. The scraping clause is an independent, unaddressed hook.
- **LOW — repo hygiene.** This worktree is a branch of the `F:\` drive-root repo whose only commit
  is GoatCoin. The project needs its own repository before any code lands.

## 7. Not done / open items

- Surface decision (BetterDiscord plugin vs Equicord fork vs Equicord userplugin) — operator's call.
- Fiber-vs-DOM extraction decision — must be made **before** the shared-core interface is written,
  or the "browser phase 2 is cheap" conclusion inverts.
- `MessageTranslate` (~5.5KB `index.tsx`) and `AutoTranslate` not yet read line-by-line.
- No implementation plan written (correctly gated behind design approval).

## 8. Go / No-Go

**CONDITIONAL GO** to proceed to design, conditioned on:

1. Operator picks the surface — the independent/simple/controllable trilemma is genuinely theirs.
2. Fiber-vs-DOM is resolved before any shared-core interface is authored.
3. No implementation begins until a design is approved (brainstorming HARD GATE).

## 9. Suggested next moves

- **P0** — Operator answers the surface question.
- **P0** — Read `MessageTranslate` and `AutoTranslate` in full; they are the two closest prior art,
  and one of them may be a fork base rather than a reference.
- **P1** — Resolve fiber-vs-DOM, then write the adapter interface.
- **P1** — `git init` a dedicated repository. **DO NOT START** any code in the current worktree
  while it is a branch of the GoatCoin drive-root repo.
- **P2** — Backend selection, after quality testing on real chat slang, not on price.

## 10. Artefacts

- This report: `docs/superpowers/specs/2026-08-18-discord-channel-translator-exploration.md`
- Workflow transcripts: `…/subagents/workflows/wf_7f61b4d9-bf1/journal.jsonl`
- Workflow script: `…/workflows/scripts/discord-translator-verdict-wf_7f61b4d9-bf1.js`
- Raw 313KB workflow result: `…/tasks/w9canc4l1.output`
- **WIKI N/A** — no `wiki/` tree in this project.
