/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/Panel.tsx
import { React, SelectedChannelStore, SelectedGuildStore, useStateFromStores } from "@webpack/common";

import { PanelState, toggleShowsOn, unavailableFooter } from "../core/modes";
import { patchesOk } from "../patches";
import { settings } from "../settings";
import { breakerOpen, pendingCount, persist,repaintChannel, subscribeProgress, toggle } from "../state";
import { openEndpointModal } from "./EndpointModal";
import { GoatBanner } from "./goatBanner";

const STATE_LABEL: Record<PanelState, string> = {
    off: "Off",
    translating: "Translating…",
    on: "On",
    degraded: "Rate limited",
    unavailable: "Discord updated"
};

/** Value is the BCP-47 tag sent to the provider; label is what the user reads. */
const LANGUAGES: Array<{ value: string; label: string; }> = [
    { value: "en", label: "EN - English" },
    { value: "zh-TW", label: "ZH-TW - 繁體中文" },
    { value: "zh-CN", label: "ZH-CN - 简体中文" },
    { value: "ja", label: "JP - 日本語" },
    { value: "ko", label: "KO - 한국어" },
    { value: "es", label: "ES - Español" },
    { value: "fr", label: "FR - Français" },
    { value: "de", label: "DE - Deutsch" },
    { value: "pt", label: "PT - Português" },
    { value: "ru", label: "RU - Русский" },
    { value: "it", label: "IT - Italiano" },
    { value: "th", label: "TH - ไทย" },
    { value: "vi", label: "VI - Tiếng Việt" },
    { value: "id", label: "ID - Bahasa Indonesia" },
    { value: "ar", label: "AR - العربية" }
];

/*
 * A PLUGIN_NAME CONSTANT USED TO LIVE HERE, and its absence is deliberate.
 *
 * It was "ChannelTranslator" — the key under which the plugin registry stores
 * this plugin's own Plugin object, which is what openPluginModal() needed. The
 * escape button below no longer opens the plugin cog, so nothing here looks a
 * plugin up by name any more, and the whole failure that constant existed to
 * guard — a name that drifts from definePlugin's, a registry lookup that
 * returns undefined, a button that silently does nothing, none of it visible at
 * build time — is designed out rather than merely tested for. Do not
 * reintroduce the constant to "keep the two in step": there is no second copy
 * of the name in this file to keep in step with any more.
 */

const KOFI_URL = "https://ko-fi.com/irp_hongkong";
/** TODO: confirm once the repo is pushed — one line to change. */
const GITHUB_URL = "https://github.com/charlie754/Discord-Translator-Client";

export function Panel() {
    const channelId = useStateFromStores([SelectedChannelStore], () =>
        SelectedChannelStore.getChannelId());
    const guildId = useStateFromStores([SelectedGuildStore], () =>
        SelectedGuildStore.getGuildId());
    /*
     * "serverState" USED TO BE THE THIRD PATH IN THIS LIST, and removing it is
     * not a tidy-up — it is the other half of a behaviour change.
     *
     * The plugin no longer persists which servers are on (state.ts's hydrate()
     * says why: translation is OFF at every start, by operator ruling). So there
     * is no such setting to subscribe to any more. It mattered here because
     * writing it was ALSO what re-rendered this component after a click:
     * flip() called persist(), persist() wrote serverState, and this hook's
     * listener forced the update. flip() now ticks the panel itself.
     */
    const store = settings.use(["targetLanguage", "mode"]);
    const [, forceTick] = React.useState(0);
    React.useEffect(() => subscribeProgress(() => forceTick(n => n + 1)), []);

    if (!channelId || !guildId) return null;

    const state = toggle.panelState({
        guildId,
        patchesOk: patchesOk(),
        breakerOpen: breakerOpen(),
        pending: pendingCount()
    });
    const langLabel =
        LANGUAGES.find(l => l.value === store.targetLanguage)?.label
        ?? store.targetLanguage;
    const isOn = toggle.isOn(guildId);
    /*
     * WHAT THE SWITCH SHOWS, which is not the same question as what the user
     * chose. `isOn` above is this session's actual toggle state and stays the
     * input to flip(); this is only what the track renders. The two differ in exactly
     * one state — see toggleShowsOn() in ../core/modes, which is where the
     * decision lives so test/modes.test.ts can exercise it as behaviour.
     *
     * DO NOT COLLAPSE THESE BACK INTO ONE. The pill says "Discord updated" and
     * the footer says translation is paused, and this used to be the third
     * signal in the same panel saying the opposite.
     */
    const switchShowsOn = toggleShowsOn(toggle, guildId, state);

    const flip = () => {
        toggle.setOn(guildId, !isOn);
        persist();
        /*
         * THE SWITCH REDRAWS BECAUSE OF THIS LINE AND NOTHING ELSE.
         *
         * `toggle` is a plain in-memory object — React cannot see it change, and
         * since the on/off state stopped being persisted there is no settings
         * write left for settings.use() above to notice either. Without this tick
         * the track keeps its old colour and its old aria-checked until something
         * unrelated repaints the panel, which reads as a dead control.
         *
         * repaintChannel() below is about the MESSAGES, not this component.
         */
        forceTick(n => n + 1);
        repaintChannel(channelId);
    };

    const setMode = (mode: "replace" | "bilingual") => {
        settings.store.mode = mode;
        repaintChannel(channelId);
    };

    return (
        <div className="shell" data-state={state}>
            <div className="pill">
                <svg className="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
                <div className="text">
                    <span className="title">Translate</span>
                    <span className="state">
                        {STATE_LABEL[state]}
                        {state === "on" ? ` · ${langLabel}` : ""}
                    </span>
                </div>
                <button
                    className="track"
                    role="switch"
                    aria-checked={switchShowsOn}
                    aria-label="Translate this server"
                    disabled={state === "unavailable"}
                    onClick={flip}
                >
                    <span className="thumb" />
                </button>
            </div>

            <div className="body"><div><div className="pad">
                <div className="rule" />

                {/* Directly under the "Rate limited" status in the pill above, so the
                    remedy is the first thing the body shows when the provider has
                    stopped answering. Rendered ONLY in the degraded state — see
                    test/panelRateLimitEscape.test.ts, which fails if this guard is
                    removed. Note that in this state the .row siblings below shift by
                    one, so their nth-child stagger delays step 50ms later; that is
                    cosmetic and only ever visible while rate limited.

                    WHERE IT GOES, AND WHERE IT USED TO GO. This used to call
                    openPluginModal() on this plugin's own registry entry, i.e. the
                    whole cog — every setting the plugin has, in a screen the user
                    had not asked for, with the two controls that answer a rate
                    limit somewhere inside it. It now opens ./EndpointModal, which
                    holds exactly the provider choice, the endpoint box and the
                    setup guide. The button's markup, class names and aria-label
                    are unchanged: only what it opens moved. */}
                {state === "degraded" && (
                    <button
                        className="escape"
                        aria-label="Use your own free endpoint"
                        onClick={openEndpointModal}
                    >
                        <svg className="escape__icon" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                             strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                            <path d="M10 17l5-5-5-5" />
                            <path d="M15 12H3" />
                        </svg>
                        <span className="escape__label">
                            <span className="escape__title">Use your own free endpoint</span>
                            <span className="escape__sub">Free · no API key</span>
                        </span>
                    </button>
                )}

                <div className="row">
                    <span className="label">Mode</span>
                    <div
                        className="modeswitch"
                        role="radiogroup"
                        aria-label="Translation mode"
                        data-mode={store.mode}
                    >
                        <span className="modeswitch__thumb" aria-hidden="true" />
                        <span className="modeswitch__ring" aria-hidden="true" />
                        <button
                            className="modeswitch__opt"
                            data-opt="replace"
                            role="radio"
                            aria-checked={store.mode === "replace"}
                            onClick={() => setMode("replace")}
                        >
                            Replace
                        </button>
                        <button
                            className="modeswitch__opt"
                            data-opt="bilingual"
                            role="radio"
                            aria-checked={store.mode === "bilingual"}
                            onClick={() => setMode("bilingual")}
                        >
                            Both Language
                        </button>
                    </div>
                </div>

                <div className="row">
                    <span className="label">Target Language</span>
                    <select
                        value={store.targetLanguage}
                        onChange={e => {
                            settings.store.targetLanguage = e.currentTarget.value;
                            repaintChannel(channelId);
                        }}
                    >
                        {LANGUAGES.map(l => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                    </select>
                </div>

                <button
                    className="kofi"
                    aria-label="Support on Ko-fi"
                    onClick={() => window.open(KOFI_URL, "_blank", "noopener,noreferrer")}
                >
                    <svg className="cup" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <g className="steam steam--a"><path d="M9 6.4c0-1 .9-1.2.9-2.2S9 2.6 9 2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" /></g>
                        <g className="steam steam--b"><path d="M12 6.4c0-1 .9-1.2.9-2.2S12 2.6 12 2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" /></g>
                        <g className="steam steam--c"><path d="M15 6.4c0-1 .9-1.2.9-2.2S15 2.6 15 2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" /></g>
                        <g className="cup__body">
                            <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" fill="currentColor" />
                            <path d="M16 10.5h1.6a2.4 2.4 0 0 1 0 4.8H16" stroke="currentColor" strokeWidth="1.7" fill="none" />
                            <path d="M3 21h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </g>
                    </svg>
                    <span className="kofi__label">
                        <span>Support me on Ko-fi</span>
                        <span className="kofi__handle">@IRP_HongKong</span>
                    </span>
                </button>

                <button
                    className="gh"
                    aria-label="Star on GitHub"
                    onClick={() => window.open(GITHUB_URL, "_blank", "noopener,noreferrer")}
                >
                    <span className="gh__corner"><span className="gh__blob" /></span>
                    <span className="gh__sweep"><span className="gh__bar" /></span>
                    <span className="gh__inner">
                        <span className="gh__star">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M11.5268 2.29489C11.5706 2.20635 11.6383 2.13183 11.7223 2.07972C11.8062 2.02761 11.903 2 12.0018 2C12.1006 2 12.1974 2.02761 12.2813 2.07972C12.3653 2.13183 12.433 2.20635 12.4768 2.29489L14.7868 6.97389C14.939 7.28186 15.1636 7.5483 15.4414 7.75035C15.7192 7.95239 16.0419 8.08401 16.3818 8.13389L21.5478 8.88989C21.6457 8.90408 21.7376 8.94537 21.8133 9.00909C21.8889 9.07282 21.9452 9.15644 21.9758 9.2505C22.0064 9.34456 22.0101 9.4453 21.9864 9.54133C21.9627 9.63736 21.9126 9.72485 21.8418 9.79389L18.1058 13.4319C17.8594 13.672 17.6751 13.9684 17.5686 14.2955C17.4622 14.6227 17.4369 14.9708 17.4948 15.3099L18.3768 20.4499C18.3941 20.5477 18.3835 20.6485 18.3463 20.7406C18.3091 20.8327 18.2467 20.9125 18.1663 20.9709C18.086 21.0293 17.9908 21.0639 17.8917 21.0708C17.7926 21.0777 17.6935 21.0566 17.6058 21.0099L12.9878 18.5819C12.6835 18.4221 12.345 18.3386 12.0013 18.3386C11.6576 18.3386 11.3191 18.4221 11.0148 18.5819L6.3978 21.0099C6.31013 21.0563 6.2112 21.0772 6.11225 21.0701C6.0133 21.0631 5.91832 21.0285 5.83809 20.9701C5.75787 20.9118 5.69563 20.8321 5.65846 20.7401C5.62128 20.6482 5.61066 20.5476 5.6278 20.4499L6.5088 15.3109C6.567 14.9716 6.54178 14.6233 6.43534 14.2959C6.32889 13.9686 6.14441 13.672 5.8978 13.4319L2.1618 9.79489C2.09039 9.72593 2.03979 9.63829 2.01576 9.54197C1.99173 9.44565 1.99524 9.34451 2.02588 9.25008C2.05652 9.15566 2.11307 9.07174 2.18908 9.00788C2.26509 8.94402 2.3575 8.90279 2.4558 8.88889L7.6208 8.13389C7.96106 8.08439 8.28419 7.95295 8.56238 7.75088C8.84058 7.54881 9.0655 7.28216 9.2178 6.97389L11.5268 2.29489Z" fill="url(#gmdmStarFill)" stroke="url(#gmdmStarStroke)" strokeLinecap="round" strokeLinejoin="round" />
                                <defs>
                                    <linearGradient id="gmdmStarFill" x1="-0.5" y1="9" x2="15.5" y2="-1.5" gradientUnits="userSpaceOnUse">
                                        <stop stopColor="#7A69F9" /><stop offset="0.575" stopColor="#F26378" /><stop offset="1" stopColor="#F5833F" />
                                    </linearGradient>
                                    <linearGradient id="gmdmStarStroke" x1="-0.5" y1="9" x2="15.5" y2="-1.5" gradientUnits="userSpaceOnUse">
                                        <stop stopColor="#7A69F9" /><stop offset="0.575" stopColor="#F26378" /><stop offset="1" stopColor="#F5833F" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <span className="gh__glow" />
                        </span>
                        <span className="gh__label">Star Project on Github</span>
                    </span>
                </button>

                <GoatBanner variant="panel" />

                {/* THE SENTENCE IS CHOSEN, NOT FIXED, and that is the whole point.
                    It used to read "Discord changed. Translation is paused;
                    double-click still works." unconditionally — a promise about a
                    path that selectionGate() refuses whenever this server's toggle
                    is off, in a state where the switch above is disabled and so the
                    user cannot make it true either. unavailableFooter() asks the
                    gate itself, so the two can no longer disagree; see
                    ../core/modes and test/panelUnavailableToggle.test.ts.

                    settings.store rather than the `store` from settings.use()
                    above: includeDMs is not one of the subscribed paths, and adding
                    it would repaint this panel on a setting it cannot display.
                    guildId is non-null by the early return at the top, so the DM
                    branch of the gate is unreachable from here — it is passed
                    anyway so this reads the same question the double-click path
                    reads, rather than a narrowed copy of it. */}
                {state === "unavailable" && (
                    <div className="row">
                        <span className="label">
                            {unavailableFooter(toggle, guildId, settings.store.includeDMs)}
                        </span>
                    </div>
                )}
            </div></div></div>
        </div>
    );
}
