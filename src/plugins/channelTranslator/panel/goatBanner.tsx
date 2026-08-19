/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/goatBanner.tsx
import { React } from "@webpack/common";
import type { JSX } from "react";

const GOAT_URL = "https://dagoat.io";

/**
 * The animated lockup ported from F:\flight\Goat Website\brand\lockup-hover,
 * the same well the Ko-fi and Star-Github buttons came from. Everything is
 * inline SVG and CSS: no remote asset, so scripts/checkHosts.mjs stays quiet.
 *
 * Two deliberate divergences from the reference stylesheet, and only two:
 *  1. the panel's design tokens carry fallbacks, because this component also
 *     renders in Discord's light DOM where :host never defined them;
 *  2. .goat's top margin is 22px rather than 16px, at the operator's request.
 *
 * .goat-lockup--paper is kept even though nothing toggles it - the operator
 * wants the dark plate everywhere, and dead rules in an upstream sheet cost
 * less than a sheet that has drifted from its source.
 */
export const GOAT_BANNER_CSS = `
/* ==========================================================================
   GOATPROJECT - animated lockup

   Hover or focus: the stamp warms and blooms - it never moves or changes size.
   Inside it the seal glyph cross-fades to a solid thumbs-up, and a spark fires
   above the tip. Meteors run behind the mark continuously; hovering only fades
   them in. Leaving reverses everything, faster than it arrived.

   No dependencies. No JavaScript required. Scale it with font-size.
   ========================================================================== */

.goat-lockup {
  /* ---- scale knob: everything derives from font-size ---- */
  font-size: 20px;

  /* ---- palette ---- */
  --gl-cream: #ece7db;
  --gl-glyph: #f6efe6;
  --gl-seal: #b3382c;
  --gl-seal-lit: #c8412f;
  --gl-name: #f2f3f5;
  --gl-tag: #9b9da4;
  --gl-spark: #f7ead6;
  --gl-focus: rgba(246, 239, 230, 0.72);
  --gl-meteor-tail: rgba(236, 231, 219, 0);
  --gl-meteor-head: rgba(236, 231, 219, 0.68);
  --gl-meteor-halo: rgba(236, 231, 219, 0.55);

  /* ---- motion ---- */
  --gl-in: cubic-bezier(0.16, 1, 0.3, 1);
  --gl-out: cubic-bezier(0.4, 0, 0.2, 1);
  --gl-t-out: 360ms;          /* leaving is always faster than arriving */
  --gl-t-fade: 450ms;         /* the length of the glyph cross-fade */

  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2em;
  isolation: isolate;
  color: var(--gl-name);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}

.goat-lockup--paper {
  --gl-cream: #1a1917;
  --gl-glyph: #f6efe6;
  --gl-name: #1a1917;
  --gl-tag: #6d675e;
  --gl-spark: #b3382c;
  --gl-focus: rgba(26, 25, 23, 0.72);
  --gl-meteor-tail: rgba(26, 25, 23, 0);
  --gl-meteor-head: rgba(26, 25, 23, 0.42);
  --gl-meteor-halo: rgba(179, 56, 44, 0.4);
}

.goat-lockup:focus-visible {
  outline: 1px solid var(--gl-focus);
  outline-offset: 0.6em;
  border-radius: 2px;
}

.goat-lockup ::selection { background: var(--gl-seal); color: #f6efe6; }

/* --------------------------------------------------------------------------
   Mark
   -------------------------------------------------------------------------- */

.goat-lockup__mark {
  position: relative;
  z-index: 1;
  display: block;
  height: 5.4em;
  flex: none;
}

.goat-lockup__svg {
  display: block;
  height: 100%;
  width: auto;
  overflow: visible;
}

.gl-head > * { fill: var(--gl-cream); }

/* --------------------------------------------------------------------------
   Seal - fixed size. Hover lights it: the face warms and a soft bloom appears
   behind it. Nothing in here moves or scales.
   -------------------------------------------------------------------------- */

.gl-seal-face { fill: var(--gl-seal); transition: fill var(--gl-t-out) var(--gl-out); }

.gl-seal-glow {
  fill: var(--gl-seal);
  opacity: 0;
  filter: blur(5px);
  transition: opacity var(--gl-t-out) var(--gl-out);
}

.gl-glyph { overflow: visible; }

/* --------------------------------------------------------------------------
   The glyph cross-fade: character out, thumbs-up in.
   The thumb is a solid silhouette with no internal detail, which is what keeps
   it readable at stamp size - roughly 20px wide on a hero lockup.
   -------------------------------------------------------------------------- */

.gl-s {
  stroke: var(--gl-glyph);
  stroke-width: 3.2;
  stroke-linecap: round;
}

.gl-strokes {
  opacity: 1;
  transition: opacity var(--gl-t-out) var(--gl-out);
}

.gl-thumb {
  fill: var(--gl-glyph);
  opacity: 0;
  transition: opacity var(--gl-t-out) var(--gl-out);
}

/* --------------------------------------------------------------------------
   Spark above the thumb tip
   -------------------------------------------------------------------------- */

.gl-burst { opacity: 0; }

.gl-ray {
  stroke: var(--gl-spark);
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-dasharray: 9 32;
  stroke-dashoffset: 9;
  opacity: 0;
}

.gl-ring {
  fill: none;
  stroke: var(--gl-spark);
  stroke-width: 3;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.gl-ember {
  fill: var(--gl-spark);
  opacity: 0;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

/* --------------------------------------------------------------------------
   Wordmark
   -------------------------------------------------------------------------- */

.goat-lockup__word {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.62em;
  font-family: "Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif;
  font-weight: 300;
}

.goat-lockup__name {
  font-size: 1em;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  text-indent: 0.24em;         /* recentre against the trailing tracking */
  color: var(--gl-name);
  white-space: nowrap;
}

.goat-lockup__tag {
  font-size: 0.43em;
  line-height: 1;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  text-indent: 0.34em;
  color: var(--gl-tag);
  white-space: nowrap;
  transition: color var(--gl-t-out) var(--gl-out);
}

/* --------------------------------------------------------------------------
   Meteors - always in motion. Hover only fades the layer in, so the streaks
   are already mid-flight when they appear rather than starting from a standstill.
   -------------------------------------------------------------------------- */

.goat-lockup__meteors {
  position: absolute;
  inset: -22% -12%;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--gl-t-out) var(--gl-out);
  -webkit-mask-image: radial-gradient(120% 100% at 62% 40%, #000 34%, transparent 78%);
  mask-image: radial-gradient(120% 100% at 62% 40%, #000 34%, transparent 78%);
}

.goat-lockup__meteors i {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: var(--gl-m-h, 4.4em);
  border-radius: 1px;
  background: linear-gradient(to bottom, var(--gl-meteor-tail), var(--gl-meteor-head));
  rotate: 34deg;               /* long axis aligned to the fall direction */
  translate: 3.2em -4.8em;
  animation: gl-meteor var(--gl-m-d, 3.3s) linear var(--gl-m-delay, 0s) infinite;
}

.goat-lockup__meteors i::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 2.5px;
  height: 2.5px;
  border-radius: 50%;
  background: var(--gl-cream);
  box-shadow: 0 0 7px 1px var(--gl-meteor-halo);
  translate: -50% 40%;
}

.goat-lockup__meteors i:nth-child(1) { left: 74%; top: 6%;  --gl-m-h: 5.2em; --gl-m-d: 2.85s; --gl-m-delay: 0s; }
.goat-lockup__meteors i:nth-child(2) { left: 52%; top: -4%; --gl-m-h: 3.4em; --gl-m-d: 3.9s;  --gl-m-delay: -.48s; }
.goat-lockup__meteors i:nth-child(3) { left: 89%; top: 22%; --gl-m-h: 4.6em; --gl-m-d: 3.15s; --gl-m-delay: -1.11s; }
.goat-lockup__meteors i:nth-child(4) { left: 33%; top: 12%; --gl-m-h: 2.8em; --gl-m-d: 4.65s; --gl-m-delay: -1.65s; }
.goat-lockup__meteors i:nth-child(5) { left: 64%; top: 38%; --gl-m-h: 3.9em; --gl-m-d: 3.6s;  --gl-m-delay: -.27s; }
.goat-lockup__meteors i:nth-child(6) { left: 18%; top: -8%; --gl-m-h: 4.1em; --gl-m-d: 4.2s;  --gl-m-delay: -1.43s; }
.goat-lockup__meteors i:nth-child(7) { left: 97%; top: -2%; --gl-m-h: 3.1em; --gl-m-d: 3.45s; --gl-m-delay: -2.18s; }
.goat-lockup__meteors i:nth-child(8) { left: 44%; top: 30%; --gl-m-h: 5.6em; --gl-m-d: 2.55s; --gl-m-delay: -.87s; }
.goat-lockup__meteors i:nth-child(9) { left: 82%; top: 48%; --gl-m-h: 2.6em; --gl-m-d: 5.1s;  --gl-m-delay: -2.7s; }

@keyframes gl-meteor {
  0%   { translate: 3.2em -4.8em; opacity: 0; }
  9%   { opacity: 1; }
  68%  { opacity: 1; }
  100% { translate: -3.4em 5.1em; opacity: 0; }
}

/* ==========================================================================
   ACTIVE STATE
   ========================================================================== */

.goat-lockup:hover .goat-lockup__meteors,
.goat-lockup:focus-visible .goat-lockup__meteors,
.goat-lockup.is-active .goat-lockup__meteors {
  opacity: 1;
  transition-duration: 630ms;
}

.goat-lockup:hover .goat-lockup__tag,
.goat-lockup:focus-visible .goat-lockup__tag,
.goat-lockup.is-active .goat-lockup__tag {
  color: var(--gl-name);
  transition-duration: 630ms;
}

.goat-lockup:hover .gl-seal-face,
.goat-lockup:focus-visible .gl-seal-face,
.goat-lockup.is-active .gl-seal-face {
  fill: var(--gl-seal-lit);
  transition-duration: 690ms;
}

.goat-lockup:hover .gl-seal-glow,
.goat-lockup:focus-visible .gl-seal-glow,
.goat-lockup.is-active .gl-seal-glow {
  opacity: 0.7;
  transition: opacity 690ms var(--gl-in);
}

/* ---- the cross-fade ---- */

.goat-lockup:hover .gl-strokes,
.goat-lockup:focus-visible .gl-strokes,
.goat-lockup.is-active .gl-strokes {
  opacity: 0;
  transition: opacity var(--gl-t-fade) linear;
}

.goat-lockup:hover .gl-thumb,
.goat-lockup:focus-visible .gl-thumb,
.goat-lockup.is-active .gl-thumb {
  opacity: 1;
  transition: opacity var(--gl-t-fade) linear 180ms;
}

/* ---- the spark ---- */

.goat-lockup:hover .gl-burst,
.goat-lockup:focus-visible .gl-burst,
.goat-lockup.is-active .gl-burst { opacity: 1; }

.goat-lockup:hover .gl-ray,
.goat-lockup:focus-visible .gl-ray,
.goat-lockup.is-active .gl-ray {
  animation: gl-ray 690ms var(--gl-in) var(--gl-ray-lag, 0ms) both;
}

.gl-ray--1 { --gl-ray-lag: 720ms; }
.gl-ray--2 { --gl-ray-lag: 765ms; }
.gl-ray--3 { --gl-ray-lag: 738ms; }
.gl-ray--4 { --gl-ray-lag: 792ms; }
.gl-ray--5 { --gl-ray-lag: 752ms; }
.gl-ray--6 { --gl-ray-lag: 816ms; }

.goat-lockup:hover .gl-ring,
.goat-lockup:focus-visible .gl-ring,
.goat-lockup.is-active .gl-ring {
  animation: gl-ring 930ms var(--gl-in) 705ms both;
}

.goat-lockup:hover .gl-ember,
.goat-lockup:focus-visible .gl-ember,
.goat-lockup.is-active .gl-ember {
  animation: gl-ember 1350ms var(--gl-in) var(--gl-ember-lag, 840ms) both;
}

.gl-ember--a { --gl-ember-lag: 840ms; --gl-ex: -13px; --gl-ey: -28px; }
.gl-ember--b { --gl-ember-lag: 975ms; --gl-ex: 15px;  --gl-ey: -21px; }
.gl-ember--c { --gl-ember-lag: 908ms; --gl-ex: 3px;   --gl-ey: -34px; }

@keyframes gl-ray {
  0%   { stroke-dashoffset: 9; opacity: 0; }
  22%  { opacity: 1; }
  100% { stroke-dashoffset: -32; opacity: 0; }
}

@keyframes gl-ring {
  0%   { transform: scale(0.3); opacity: 0; }
  18%  { opacity: 0.85; }
  100% { transform: scale(1.9); opacity: 0; }
}

@keyframes gl-ember {
  0%   { transform: translate(0, 0) scale(0.4); opacity: 0; }
  25%  { opacity: 0.9; }
  100% { transform: translate(var(--gl-ex, 6px), var(--gl-ey, -16px)) scale(1); opacity: 0; }
}

/* ==========================================================================
   REDUCED MOTION - the cross-fade survives, the travelling parts do not
   ========================================================================== */

@media (prefers-reduced-motion: reduce) {
  .goat-lockup__meteors i {
    animation: none;
    translate: 0 0;
    opacity: 0.5;
  }

  .goat-lockup:hover .gl-ray,
  .goat-lockup:focus-visible .gl-ray,
  .goat-lockup.is-active .gl-ray,
  .goat-lockup:hover .gl-ember,
  .goat-lockup:focus-visible .gl-ember,
  .goat-lockup.is-active .gl-ember { animation: none; opacity: 0; }

  .goat-lockup:hover .gl-ring,
  .goat-lockup:focus-visible .gl-ring,
  .goat-lockup.is-active .gl-ring {
    animation: none;
    opacity: 0.5;
    transform: scale(1.15);
    transition: opacity 330ms linear 300ms;
  }
}

/* ---- Goat lockup banner ----
 * Hover component from brand/lockup-hover, not the looping SVG. The two
 * campaign lines sit above the lockup. Animation is :hover on .goat-lockup
 * only -- hovering the sentences or StarGithub must not play it. */

.goat {
  display: block;
  box-sizing: border-box;
  width: 100%;
  /* 22px, not the reference's 16px: the operator asked for more air between
     the Star-Github button and this banner. Do not "fix" it back to 16px. */
  margin-top: 22px;
  margin-bottom: 2px;
  color: var(--ink-cream, #f0e6d2);
  cursor: pointer;
  text-decoration: none;
}
.goat:focus-visible { outline: 2px solid var(--accent, #3ecf8e); outline-offset: 2px; border-radius: 8px; }
.goat__copy { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; }
.goat__line { margin: 0; font-size: 10.5px; line-height: 1.4; font-weight: 500; }
.goat__line--ask { color: var(--ink-muted, #a99f8c); font-weight: 400; }
.goat .goat-lockup {
  font-size: 11px;
  display: flex;
  width: 100%;
  max-width: 100%;
  gap: 1.15em;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  overflow: hidden;
  background: #0b0b0d;
  transition: transform var(--dur-base, 300ms) var(--ease, cubic-bezier(0.25, 0.1, 0.25, 1)), box-shadow var(--dur-base, 300ms) var(--ease, cubic-bezier(0.25, 0.1, 0.25, 1));
}
.goat .goat-lockup.goat-lockup--paper {
  background: #f6efe6;
}`;

/** Stable id so remounting the settings tab cannot append a second copy. */
const STYLE_ID = "ct-goat-banner-css";

function ensureBannerCss() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = GOAT_BANNER_CSS;
    document.head.appendChild(style);
}

/**
 * The campaign banner. Renders in two very different roots:
 *
 *  - the plugin panel's shadow root, which already receives this stylesheet
 *    through PANEL_CSS;
 *  - the Discord settings tab, which is plain light DOM that no shadow
 *    stylesheet can reach.
 *
 * So the component injects into document.head itself and the caller wires
 * nothing. From inside the shadow root that injection is inert - document
 * styles do not cross a shadow boundary - so the panel is unaffected either
 * way, and the guard above keeps it to one element regardless.
 */
export function GoatBanner(): JSX.Element {
    React.useEffect(ensureBannerCss, []);

    return (
        <a className="goat" href={GOAT_URL} target="_blank" rel="noopener noreferrer">
            <span className="goat__copy">
                <span className="goat__line">Goat Project - Help fight Cancer, Alzheimer&rsquo;s, Parkinson&rsquo;s, COVID-19, Dengue, Hepatitis C etc.</span>
                <span className="goat__line goat__line--ask">Contribute your idle computer to Earn GOAT.</span>
            </span>
                <span className="goat-lockup" data-goat-mark>
                <span className="goat-lockup__meteors" aria-hidden="true">
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                <i>
                </i>
                </span>
                <span className="goat-lockup__mark" aria-hidden="true">
                <svg className="goat-lockup__svg" viewBox="46 -16 220 250" xmlns="http://www.w3.org/2000/svg" focusable="false">
                <g className="gl-head">
                <path d="M62 210 C74 148 120 98 190 80 C152 106 106 150 82 216 Z"/>
                <path d="M186 84 C214 62 226 32 210 8 C216 36 200 62 174 80 Z"/>
                <path d="M170 82 C190 60 194 34 180 16 C186 40 172 62 156 78 Z"/>
                <path d="M188 82 C206 90 218 104 222 122 C212 106 200 94 182 90 Z"/>
                <path d="M206 122 C215 134 217 149 209 160 C212 147 208 133 200 127 Z"/>
                <circle cx="197" cy="99" r="3.6"/>
                </g>
                <g className="gl-seal">
                <rect className="gl-seal-glow" x="214" y="182" width="36" height="36" rx="4"/>
                <rect className="gl-seal-face" x="214" y="182" width="36" height="36" rx="4"/>
                <svg className="gl-glyph" x="214" y="182" width="36" height="36" viewBox="0 0 100 100">
                <path className="gl-thumb" d="M30 50 C26 50 24 52 24 56 L24 87 C24 91 26 93 30 93 L73 93 C79 93 84 90 85 84 L89 55 C90 49 86 44 80 44 L63 44 C65 38 67 25 65 18 C63 12 55 12 53 18 C51 24 53 33 51 42 C50 47 47 50 42 50 Z" transform="translate(-5 -3)"/>
                <g className="gl-strokes" fill="none">
                <line className="gl-s" x1="35.3" y1="17.1" x2="47.3" y2="30.9"/>
                <line className="gl-s" x1="67.3" y1="17.1" x2="52.7" y2="30.9"/>
                <line className="gl-s" x1="24.7" y1="33.5" x2="76.4" y2="33.5"/>
                <line className="gl-s" x1="27.3" y1="48.4" x2="75.6" y2="48.4"/>
                <line className="gl-s" x1="21.1" y1="60" x2="80" y2="60"/>
                <line className="gl-s" x1="49" y1="25.5" x2="49" y2="80"/>
                </g>
                <g className="gl-burst" transform="translate(53 0)" fill="none">
                <circle className="gl-ring" cx="0" cy="0" r="12"/>
                <line className="gl-ray gl-ray--1" transform="rotate(-168)" x1="10" y1="0" x2="40" y2="0"/>
                <line className="gl-ray gl-ray--2" transform="rotate(-138)" x1="10" y1="0" x2="40" y2="0"/>
                <line className="gl-ray gl-ray--3" transform="rotate(-108)" x1="10" y1="0" x2="40" y2="0"/>
                <line className="gl-ray gl-ray--4" transform="rotate(-76)" x1="10" y1="0" x2="40" y2="0"/>
                <line className="gl-ray gl-ray--5" transform="rotate(-44)" x1="10" y1="0" x2="40" y2="0"/>
                <line className="gl-ray gl-ray--6" transform="rotate(-14)" x1="10" y1="0" x2="40" y2="0"/>
                <circle className="gl-ember gl-ember--a" cx="-7" cy="-2" r="2.2"/>
                <circle className="gl-ember gl-ember--b" cx="8" cy="-5" r="1.9"/>
                <circle className="gl-ember gl-ember--c" cx="0" cy="-9" r="1.6"/>
                </g>
                </svg>
                </g>
                </svg>
                </span>
                <span className="goat-lockup__word">
                <span className="goat-lockup__name">Goatproject</span>
                <span className="goat-lockup__tag">The People&rsquo;s Compute Commons</span>
                </span>
                </span>
        </a>
    );
}
