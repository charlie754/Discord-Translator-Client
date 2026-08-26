/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/styles.ts
import { GOAT_BANNER_CSS } from "./goatBanner";

/**
 * Design vocabulary lifted from F:\google map plugin\extension\content\widget.js
 * so the two products read as one hand. Values are INLINED rather than
 * referenced because a shadow root does not inherit the host page's custom
 * properties — and we would not want Discord's :root anyway.
 */
export const PANEL_CSS = `
:host {
  all: initial;
  font-family: -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
  contain: layout style;
}

* { box-sizing: border-box; }

:host {
  --glass-bg: rgba(28, 26, 38, 0.62);
  --glass-border: rgba(255, 255, 255, 0.13);
  --glass-blur: 16px;
  --glass-radius: 14px;
  --glass-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
  --glass-shadow-hover: 0 18px 44px rgba(0, 0, 0, 0.55);
  --ink-cream: #f0e6d2;
  --ink-muted: #a99f8c;
  --accent: #3ecf8e;
  --accent-ink: #0e2419;
  --switch-off: #4a4557;
  --kofi: #d2413e;
  --warn: #e0a23c;
  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --dur-fast: 200ms;
  --dur-base: 300ms;
  --dur-slow: 420ms;
}

.shell {
  width: 216px;
  max-width: calc(100vw - 24px);
  background: var(--glass-bg);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--glass-radius);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  overflow: hidden;
  color: var(--ink-cream);
  transition:
    width var(--dur-base) var(--ease),
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}

/* Hover expands, per design D6. The Maps widget opens on click; this one does
   not, so the On/Off switch stays a discrete click target inside the body and
   passing the mouse over the panel can never toggle a whole server. */
.shell:hover { width: 272px; box-shadow: var(--glass-shadow-hover); }

.pill {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 13px;
  cursor: default;
}

.globe { flex: 0 0 20px; width: 20px; height: 20px; color: var(--ink-muted);
  transition: color var(--dur-base) var(--ease); }
.shell[data-state="on"] .globe { color: var(--accent); }
.shell[data-state="degraded"] .globe { color: var(--warn); }
.shell[data-state="unavailable"] .globe { color: var(--ink-muted); opacity: 0.5; }

.text { flex: 1; display: flex; flex-direction: column; min-width: 0; white-space: nowrap; }

.pill .track { flex: 0 0 auto; }
.title { font-size: 13px; font-weight: 600; }
.state { font-size: 10.5px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; }

/* 0fr -> 1fr is the only way to transition to an intrinsic height. */
.body { display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-base) var(--ease); }
.shell:hover .body { grid-template-rows: 1fr; }
.body > div { overflow: hidden; }
.pad { padding: 2px 13px 13px; }
.rule { height: 0.5px; background: var(--glass-border); margin: 0 0 10px; }

.row { display: flex; align-items: center; justify-content: space-between;
  padding: 7px 0; opacity: 0; transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease); }
.shell:hover .row { opacity: 1; transform: none; }
.shell:hover .row:nth-child(1) { transition-delay: 60ms; }
.shell:hover .row:nth-child(2) { transition-delay: 110ms; }
.shell:hover .row:nth-child(3) { transition-delay: 160ms; }
.shell:hover .row:nth-child(4) { transition-delay: 210ms; }

.label { font-size: 12px; color: var(--ink-muted); }

.track { all: unset; width: 40px; height: 24px; border-radius: 12px;
  background: var(--switch-off); position: relative; cursor: pointer;
  transition: background var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease); }

.track {
  transition-property: background, box-shadow, color, transform;
  transition-duration: var(--dur-base);
  transition-timing-function: var(--ease);
}

.track:hover { transform: scale(1.136); }

.track:active { transform: scale(0.932); }
.track[aria-checked="true"] { background: var(--accent);
  box-shadow: 0 0 14px rgba(62, 207, 142, 0.35); }
.track:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.thumb { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: left var(--dur-base) var(--ease); }
.track[aria-checked="true"] .thumb { left: 19px; }
.track:active .thumb { width: 22px; }

select { all: unset; box-sizing: border-box; font-size: 12px; color: var(--ink-cream); cursor: pointer;
  background: rgba(0,0,0,0.25); padding: 3px 7px; border-radius: 7px;
  text-align: center; text-align-last: center; min-width: 132px; }

select {
  transition-property: background, box-shadow, color, transform;
  transition-duration: var(--dur-base);
  transition-timing-function: var(--ease);
  transform-origin: right center;
}

select:hover { transform: scale(1.102); }

select:active { transform: scale(0.932); }

select option { background: #1c1a26; color: var(--ink-cream); text-align: center; }

.modeswitch {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 9px;
  padding: 2px;
  min-width: 148px;
}

/* The sliding indicator. Half the track minus the 2px padding on each side. */
.modeswitch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  border-radius: 7px;
  background: var(--accent);
  box-shadow: 0 0 12px rgba(62, 207, 142, 0.35);
  transition: transform var(--dur-base) var(--ease);
}

.modeswitch[data-mode="bilingual"] .modeswitch__thumb {
  transform: translateX(100%);
}

.modeswitch__opt {
  all: unset;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  text-align: center;
  padding: 4px 6px;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  color: var(--ink-muted);
  transition: color var(--dur-base) var(--ease);
}

.modeswitch__opt {
  transition-property: background, box-shadow, color, transform;
  transition-duration: var(--dur-base);
  transition-timing-function: var(--ease);
}

.modeswitch {
  transition: transform var(--dur-base) var(--ease);
  transform-origin: right center;
}
.modeswitch:hover { transform: scale(1.102); }
.modeswitch:active { transform: scale(0.932); }

/* Hover ring: a hollow outline that slides to whichever segment the pointer is
   over. Distinct from the filled thumb, which never leaves the active option —
   so on hover you see both what IS selected and what you are pointing at. */
.modeswitch__ring {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  box-sizing: border-box;
  border: 1.5px solid var(--accent);
  border-radius: 7px;
  background: none;
  opacity: 0;
  pointer-events: none;
  transition: transform var(--dur-base) var(--ease), opacity var(--dur-fast) var(--ease);
}

/* At rest the ring parks over the active option, so when it fades in it reads
   as sliding away from there rather than appearing out of nowhere. */
.modeswitch[data-mode="bilingual"] .modeswitch__ring {
  transform: translateX(100%);
}

.modeswitch:has([data-opt="replace"]:hover) .modeswitch__ring {
  transform: translateX(0);
  opacity: 1;
}

.modeswitch:has([data-opt="bilingual"]:hover) .modeswitch__ring {
  transform: translateX(100%);
  opacity: 1;
}

.modeswitch__opt[aria-checked="true"] {
  color: var(--accent-ink);
  font-weight: 600;
}

.modeswitch__opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 7px;
}

/* ---- Ko-fi and GitHub buttons ---- */

/* Rows fade and rise in, staggered, so the panel assembles rather than appearing. */
.row, .kofi, .gh {
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease), background var(--dur-fast) var(--ease);
}
.shell:hover .row,
.shell:hover .kofi,
.shell:hover .gh { opacity: 1; transform: none; }
.shell:hover .row:nth-child(1) { transition-delay: 60ms; }
.shell:hover .row:nth-child(2) { transition-delay: 110ms; }
.shell:hover .row:nth-child(3) { transition-delay: 160ms; }
.shell:hover .kofi { transition-delay: 210ms; }
.shell:hover .gh   { transition-delay: 250ms; }

/* ---- Ko-fi ---- */

.kofi {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--kofi);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(210, 65, 62, 0.28);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease), background var(--dur-fast) var(--ease);
}
.kofi:hover { background: #e04b48; }
.kofi:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

.shell:hover .kofi:hover,
.shell:hover .gh:hover { transform: scale(1.05); }
.shell:hover .kofi:active,
.shell:hover .gh:active { transform: scale(0.96); }

.shell:hover .kofi:hover, .shell:hover .kofi:active,
.shell:hover .gh:hover,   .shell:hover .gh:active { transition-delay: 0s; }

.kofi:hover { box-shadow: var(--glass-shadow-hover), 0 10px 26px rgba(210, 65, 62, 0.45); }
.gh:hover { box-shadow: var(--glass-shadow-hover); }
.kofi__label { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.25; }
.kofi__handle { color: rgba(255, 255, 255, 0.82); font-weight: 500; font-size: 11px; }

.cup { width: 22px; height: 22px; overflow: visible; }

.steam { opacity: 0; transform-origin: 50% 100%; }
.kofi:hover .steam,
.kofi:focus-visible .steam { animation: steam 2s var(--ease) infinite; }
.kofi:hover .steam--b,
.kofi:focus-visible .steam--b { animation-delay: 0.45s; }
.kofi:hover .steam--c,
.kofi:focus-visible .steam--c { animation-delay: 0.9s; }

@keyframes steam {
  0%   { opacity: 0;    transform: translateY(1px)  translateX(0)     scale(0.6); }
  22%  { opacity: 0.85; }
  55%  { opacity: 0.55; transform: translateY(-5px) translateX(1.2px) scale(1); }
  100% { opacity: 0;    transform: translateY(-10px) translateX(-1px) scale(1.25); }
}

.kofi:hover .cup__body { animation: cup-tilt 2s var(--ease) infinite; transform-origin: 50% 80%; }
@keyframes cup-tilt {
  0%, 100% { transform: rotate(0deg); }
  50%      { transform: rotate(-3.5deg); }
}

/* ---- GitHub button ---- */

.gh {
  all: unset;
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 1px;
  border-radius: 999px;
  background: #262626;
  overflow: hidden;
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease);
}
.gh:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.gh__corner { position: absolute; inset: 0; border-radius: 999px; overflow: hidden; pointer-events: none; }
.gh__blob {
  display: block; width: 96px; height: 96px;
  transform: translate(-50%, -33%); filter: blur(20px);
  background: linear-gradient(135deg, #7a69f9, #f26378, #f5833f);
}
.gh__sweep {
  position: absolute; inset: 0; pointer-events: none;
  animation: gh-border-translate 10s ease-in-out infinite alternate;
}
.gh__bar {
  display: block; height: 100%; width: 48px; border-radius: 999px;
  transform: translateX(-50%); filter: blur(20px);
  background: linear-gradient(135deg, #7a69f9, #f26378, #f5833f);
  animation: gh-border-scale 10s ease-in-out infinite alternate;
}
.gh__inner {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px 16px 8px 12px;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.9);
}
.gh__star { position: relative; display: inline-flex; transition: transform 500ms var(--ease); }
.gh:hover .gh__star { transform: scale(1.05) rotate(360deg); }
.gh__star svg { display: block; animation: gh-star-rotate 14s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite alternate; }
.gh__glow {
  position: absolute; top: 50%; left: 50%; width: 44px; height: 44px;
  border-radius: 999px; transform: translate(-50%, -50%); filter: blur(16px); opacity: 0.3;
  background: linear-gradient(135deg, #3bc4f2, #7a69f9, #f26378, #f5833f);
  animation: gh-star-shine 14s ease-in-out infinite alternate;
}
.gh__label {
  font-size: 12px; font-weight: 600; white-space: nowrap;
  background: linear-gradient(to bottom, #fff, rgba(255, 255, 255, 0.5));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  transition: transform var(--dur-fast) var(--ease);
}
.gh:hover .gh__label { transform: scale(1.05); }

@keyframes gh-border-translate { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes gh-border-scale { from { transform: translateX(-50%) scale(1); } to { transform: translateX(-50%) scale(2); } }
@keyframes gh-star-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes gh-star-shine {
  from { opacity: 0.14; transform: translate(-50%, -50%) scale(0.8); }
  to   { opacity: 0.45; transform: translate(-50%, -50%) scale(1.2); }
}

.gh { margin-bottom: 2px; }

/* ---- Rate-limited escape hatch ----

   Rendered only while the panel is degraded, which is exactly when the user has
   been told what broke and nothing about what to do. It is deliberately the
   quietest interactive element in the body: an outline in the same amber the
   globe already turns at .shell[data-state="degraded"], rather than a third
   filled colour block competing with Ko-fi's red and the GitHub gradient. The
   geometry — 100% width, 11px radius, the same fade-and-rise entrance — is
   borrowed from .kofi so it reads as part of the same set. */
.escape {
  all: unset;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  margin: 2px 0 8px;
  padding: 8px 11px;
  border-radius: 11px;
  border: 1px solid rgba(224, 162, 60, 0.38);
  background: rgba(224, 162, 60, 0.09);
  color: var(--ink-cream);
  cursor: pointer;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}

/* First in the body, so it leads the stagger rather than trailing it. */
.shell:hover .escape { opacity: 1; transform: none; transition-delay: 60ms; }
.escape:hover { background: rgba(224, 162, 60, 0.16); border-color: rgba(224, 162, 60, 0.62); }
.shell:hover .escape:hover { transform: scale(1.03); transition-delay: 0s; }
.shell:hover .escape:active { transform: scale(0.96); transition-delay: 0s; }
.escape:focus-visible { outline: 2px solid var(--warn); outline-offset: 2px; }

.escape__icon { flex: 0 0 16px; width: 16px; height: 16px; color: var(--warn); }
.escape__label { display: flex; flex-direction: column; align-items: flex-start;
  line-height: 1.25; min-width: 0; }
.escape__title { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.escape__sub { font-size: 11px; font-weight: 500; color: var(--ink-muted); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .shell, .body, .row, .kofi, .gh, .escape, .track, .thumb, .modeswitch__thumb, .modeswitch__ring { transition: none !important; }
  .track:hover, .modeswitch:hover, select:hover,
  .track:active, .modeswitch:active { transform: none !important; }
  .shell:hover .escape:hover, .shell:hover .escape:active { transform: none !important; }
  .kofi:hover .steam, .kofi:focus-visible .steam, .kofi:hover .cup__body { animation: none !important; }
  .gh__sweep, .gh__bar, .gh__star svg, .gh__glow { animation: none !important; }
  .gh:hover .gh__star, .gh:hover .gh__label { transform: none !important; }
  .shell:hover .row, .shell:hover .kofi, .shell:hover .gh, .shell:hover .escape { opacity: 1; }
}
` + GOAT_BANNER_CSS;
