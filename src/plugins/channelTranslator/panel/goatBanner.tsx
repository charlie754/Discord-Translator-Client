/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/goatBanner.tsx
import { React } from "@webpack/common";
import type { JSX } from "react";

/** The plate's only destination: the GOAT Cam website, opened on an explicit click. */
const GOAT_URL = "https://goatcam.dagoat.io";

/**
 * The GOAT Cam banner: self-promotion of the author's own iPhone app, GOAT Cam,
 * which turns an iPhone into a webcam for a Windows 11 PC. It replaced the
 * author's earlier Goat Project banner in the same two places, keeping every
 * element of it - the two copy lines, the dark plate as the only link, the
 * animated goat lockup (head, the 羊 seal that cross-fades to a thumbs-up, the
 * spark burst, nine meteors), the hover lift and the reduced-motion behaviour -
 * and adding a real coffee photo with viewfinder brackets and a "1080p · 60 fps"
 * readout, the GOAT Cam wordmark, and a QR code for the App Store listing.
 *
 * SOURCE. This is a port of the GOAT Cam master web build (brand/goatcam-banner in
 * the GOAT Cam repository, 2026-10-25), and ports copy it rather than redesign it:
 *
 *  - The first part of the stylesheet below is the master goatcam-banner.css with
 *    its comments and redundant whitespace removed, one rule per line. That is a
 *    whitespace-only transform, made because the master's ~30 KB budget for sheet
 *    plus markup holds only when the sheet ships without its comments. The
 *    master's README carries the commentary, the measured sizes and the motion
 *    contract that were stripped from here.
 *  - The markup is the master's canonical fragment, converted to JSX by machine:
 *    the lockup SVG, the QR path and the photo's data URI are byte-for-byte the
 *    master's. The QR encodes the App Store listing; never re-encode it and never
 *    draw over it.
 *
 * NOTHING HERE IS FETCHED. The photo (CC0, Alex Knight - credited in NOTICE.md) is
 * a WebP carried inline as a data: URI, the QR and the lockup are inline SVG, and
 * the stylesheet references no url() at all. The App Store address exists only as
 * QR modules, i.e. pixels, so it is not a host anywhere in the build, and
 * goatcam.dagoat.io is reached only when the user clicks the plate. That is what
 * keeps scripts/checkHosts.mjs down to the one link target in
 * scripts/allowed-hosts.txt, and test/goatBanner.test.ts pins it.
 *
 * The last four lines of the stylesheet are this host's glue - the only lines
 * that are not the master's:
 *
 *  1. .goat's margin. 22px above, 2px below, as the previous banner had it: the
 *     operator asked for more air between the Star-Github button and this
 *     banner. Do not "fix" it back to the master's 0.
 *  2-4. The panel's lift gate, as the master README's "Lift" section prescribes.
 *     The panel variant carries .goat--gated, which switches off the master's
 *     ungated lift, and the gate re-enables it only under .shell:hover - the
 *     same gate the panel's .kofi and .gh buttons use, because the shell is
 *     collapsed until hovered and no control in it should react to the cursor
 *     before the panel has opened. Reduced motion stops it, like every other
 *     travelling part. The settings variant is not gated and keeps the master's
 *     gentler settings lift (1.02 / 0.99), which is all in the master part.
 *
 * No token fallbacks are added, because the master already carries them: every
 * token is defined on .goat itself and nothing reads :root, and the two copy
 * colours read the panel's --ink-cream / --ink-muted with the panel's own values
 * as fallbacks. So the sheet renders the same in the panel's shadow root, where
 * :host defines those two, and in the settings tab's light DOM, where nothing does.
 *
 * KEYBOARD FOCUS. The plate is ONE anchor carrying both goat-lockup and
 * goat__link. The master triggers its animation on :hover, :focus-visible and
 * .is-active of .goat-lockup, so focusing the plate from the keyboard plays the
 * same animation as the pointer does (the lift alone stays pointer-only, by the
 * master's contract). The previous banner wrapped the lockup in a separate
 * a.goat__link, so focus landed on the wrapper and never reached the lockup.
 * goat__link carries no rules; it stays as a stable hook for this host.
 */
export const GOAT_BANNER_CSS = `
.goat{--gc-950:#140d08;--gc-900:#1c130c;--gc-caramel:#c98a46;--gc-caramel-deep:#8f4f1c;--gc-gold:#f0c07a;--gc-cream:#f8eedf;--gc-cream-soft:#d8c2a5;--gc-muted:#b09878;--gc-line:rgba(248,238,223,.14);--gc-serif:"Palatino Linotype",Palatino,"Book Antiqua","Iowan Old Style","URW Palladio L",P052,Georgia,serif;--gc-sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;--gc-mono:ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",Menlo,monospace;--gc-in:cubic-bezier(.16,1,.3,1);--gc-out:cubic-bezier(.4,0,.2,1);--gc-t-out:360ms;--gc-ink:var(--ink-cream,#f0e6d2);--gc-ink-muted:var(--ink-muted,#a99f8c);--gc-lift:scale(1.05);--gc-press:scale(.96);--gc-lift-shadow:0 18px 44px rgba(0,0,0,.55),0 0 0 1px rgba(240,192,122,.22);--gl-cream:var(--gc-cream);--gl-glyph:#f6efe6;--gl-seal:var(--gc-caramel-deep);--gl-seal-lit:var(--gc-caramel);--gl-name:var(--gc-cream);--gl-tag:var(--gc-muted);--gl-spark:var(--gc-gold);--gl-meteor-tail:rgba(248,238,223,0);--gl-meteor-head:rgba(240,192,122,.7);--gl-meteor-halo:rgba(240,192,122,.5);--gl-in:var(--gc-in);--gl-out:var(--gc-out);--gl-t-out:var(--gc-t-out);--gl-t-fade:450ms;--gl-seal-scale:1;display:block;box-sizing:border-box;width:100%;margin:0;padding:0;color:var(--gc-ink);font:400 10.5px/1.4 var(--gc-sans);text-align:left;-webkit-font-smoothing:antialiased;}
.goat *,.goat *::before,.goat *::after{box-sizing:border-box;}
.goat__copy{display:flex;flex-direction:column;gap:4px;margin:0 0 8px;padding:2px 0 0;}
.goat__line{display:block;margin:0;font-size:10.5px;line-height:1.4;font-weight:500;color:var(--gc-ink);text-wrap:pretty;}
.goat__line--ask{color:var(--gc-ink-muted);font-weight:400;}
.goat__line em{font:italic 700 1.14em/1 var(--gc-serif);color:var(--gc-gold);letter-spacing:.02em;}
.goat .goat-lockup{position:relative;display:grid;isolation:isolate;width:100%;max-width:100%;min-width:0;margin:0;border:1px solid var(--gc-line);border-radius:10px;background:var(--gc-950);overflow:hidden;overflow:clip;color:var(--gc-cream);font-size:7.2px;line-height:1;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform var(--gc-t-out) var(--gc-out),box-shadow var(--gc-t-out) var(--gc-out);}
.goat .goat-lockup:hover{color:var(--gc-cream);text-decoration:none;}
.goat .goat-lockup:focus-visible{outline:2px solid var(--gc-gold);outline-offset:2px;}
.goat-lockup ::selection{background:var(--gc-caramel-deep);color:#f6efe6;}
.gc-photo{--gc-arm:9px;--gc-vf-in:6px;grid-area:photo;position:relative;z-index:1;display:block;min-width:0;overflow:hidden;container-type:size;background:var(--gc-950);--gc-edge:linear-gradient(to left,#0000,#000 3px);-webkit-mask:var(--gc-edge);mask:var(--gc-edge);}
.gc-photo__frame{position:absolute;left:var(--gc-px,50%);top:var(--gc-py,40%);display:block;width:100%;width:max(100cqw,100cqh * 264 / 222);aspect-ratio:264 / 222;translate:calc(var(--gc-px,50%) * -1) calc(var(--gc-py,40%) * -1);transform-origin:48% 42%;transition:transform var(--gc-t-out) var(--gc-out);}
.gc-photo__img{display:block;width:100%;height:100%;max-width:none;margin:0;border:0;object-fit:cover;user-select:none;-webkit-user-drag:none;}
.gc-photo::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:var(--gc-scrim,linear-gradient(to right,rgba(20,13,8,0) 62%,var(--gc-950)));}
.gc-steam{position:absolute;left:58%;bottom:75%;width:24%;height:auto;aspect-ratio:60 / 120;translate:-50% 0;overflow:visible;opacity:0;filter:blur(.6px);transition:opacity var(--gc-t-out) var(--gc-out);}
.gc-steam path{fill:none;stroke:rgba(255,247,236,.9);stroke-width:6;stroke-linecap:round;stroke-dasharray:44 100;stroke-dashoffset:44;animation:gc-steam 3.2s linear infinite paused;}
.gc-steam path:nth-child(2){animation-duration:3.7s;animation-delay:-1.3s;}
.gc-steam path:nth-child(3){animation-duration:2.9s;animation-delay:-2.2s;}
.gc-vf{--gc-m:conic-gradient(at var(--gc-arm) var(--gc-arm),#0000 75%,#000 0) 0 0 / calc(100% - var(--gc-arm)) calc(100% - var(--gc-arm));position:absolute;z-index:2;pointer-events:none;inset:var(--gc-vf-in) var(--gc-vf-in) calc(var(--gc-vf-in) + var(--gc-vf-b,0px));border:2px solid rgba(248,238,223,.62);-webkit-mask:var(--gc-m);mask:var(--gc-m);transition:inset var(--gc-t-out) var(--gc-out);}
.gc-vf::after{content:"";position:absolute;inset:-2px;border:2px solid var(--gc-gold);opacity:0;transition:opacity var(--gc-t-out) var(--gc-out);}
.gc-osd{position:absolute;z-index:3;top:3px;left:calc(var(--gc-vf-in) + var(--gc-arm) + 6px);display:flex;align-items:flex-start;gap:3px;margin:0;padding:3px 4px;border-radius:4px;background:rgba(20,13,8,.62);color:var(--gc-cream);font:500 var(--gc-osd-fs,6.5px)/1 var(--gc-mono);letter-spacing:.05em;font-variant-numeric:tabular-nums;white-space:nowrap;}
.gc-osd__dot{flex:none;width:var(--gc-dot,5px);height:var(--gc-dot,5px);margin-top:1px;border-radius:50%;background:var(--gc-gold);}
.gc-osd__t{display:flex;flex-direction:column;gap:2px;}
.gc-osd__sep{display:none;}
.gc-qr{grid-area:qr;position:relative;z-index:2;display:flex;align-items:center;gap:10px;min-width:0;}
.gc-qr__tile{flex:none;display:block;width:var(--gc-qr,72px);height:var(--gc-qr,72px);overflow:hidden;border-radius:var(--gc-qr-r,6px);background:#fbf5ea;box-shadow:0 6px 16px -8px rgba(0,0,0,.7),0 0 0 0 rgba(201,138,70,0);transition:box-shadow var(--gc-t-out) var(--gc-out);}
.gc-qr__tile svg{display:block;width:100%;height:100%;shape-rendering:crispEdges;}
.gc-qr__cap{display:none;flex-direction:column;gap:2px;color:var(--gc-cream-soft);font:600 11px/1.3 var(--gc-sans);white-space:nowrap;}
.gc-qr__cap span{color:var(--gc-muted);font-weight:400;}
.goat-lockup__mark{grid-area:mark;position:relative;z-index:1;display:block;height:5.4em;align-self:center;}
.goat-lockup__svg{display:block;height:100%;width:auto;overflow:visible;}
.gl-head > *{fill:var(--gl-cream);}
.gl-seal{transform-box:fill-box;transform-origin:50% 50%;transform:scale(var(--gl-seal-scale,1));}
.gl-seal-face{fill:var(--gl-seal);transition:fill var(--gl-t-out) var(--gl-out);}
.gl-seal-glow{fill:var(--gl-seal-lit);opacity:0;filter:blur(5px);transition:opacity var(--gl-t-out) var(--gl-out);}
.gl-glyph{overflow:visible;}
.gl-char{fill:var(--gl-glyph);opacity:1;transition:opacity var(--gl-t-out) var(--gl-out);}
.gl-thumb{fill:var(--gl-glyph);opacity:0;transition:opacity var(--gl-t-out) var(--gl-out);}
.gl-burst{opacity:0;}
.gl-ray{stroke:var(--gl-spark);stroke-width:3.2;stroke-linecap:round;stroke-dasharray:9 32;stroke-dashoffset:9;opacity:0;}
.gl-ring{fill:none;stroke:var(--gl-spark);stroke-width:3;opacity:0;transform-box:fill-box;transform-origin:50% 50%;}
.gl-ember{fill:var(--gl-spark);opacity:0;transform-box:fill-box;transform-origin:50% 50%;}
.goat-lockup__word{grid-area:word;position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:var(--gc-word-gap,5px);min-width:0;}
.goat-lockup__name{display:block;margin:0;padding:0;font:400 var(--gc-name,18px)/1 var(--gc-serif);letter-spacing:-.005em;text-transform:none;text-indent:0;color:var(--gl-name);white-space:nowrap;}
.goat-lockup__tag{display:block;margin:0;padding:0;font:600 var(--gc-tag,7px)/1.25 var(--gc-sans);letter-spacing:var(--gc-tag-track,.14em);text-transform:uppercase;text-indent:0;color:var(--gl-tag);white-space:nowrap;transition:color var(--gl-t-out) var(--gl-out);}
.gc-tag__sep{white-space:pre;}
.goat-lockup__meteors{grid-row:mark;grid-column:mark-start / word-end;position:absolute;inset:var(--gc-meteor-inset,-22% -12%);z-index:0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity var(--gl-t-out) var(--gl-out);-webkit-mask-image:radial-gradient(120% 100% at 40% 45%,#000 34%,transparent 78%);mask-image:radial-gradient(120% 100% at 40% 45%,#000 34%,transparent 78%);}
.goat-lockup__meteors i{position:absolute;top:0;left:0;width:1px;height:var(--gl-m-h,4.4em);border-radius:1px;background:linear-gradient(to bottom,var(--gl-meteor-tail),var(--gl-meteor-head));rotate:34deg;translate:3.2em -4.8em;animation:gl-meteor var(--gl-m-d,3.3s) linear var(--gl-m-delay,0s) infinite paused;}
.goat-lockup__meteors i::after{content:"";position:absolute;left:50%;bottom:0;width:2.5px;height:2.5px;border-radius:50%;background:var(--gl-cream);box-shadow:0 0 7px 1px var(--gl-meteor-halo);translate:-50% 40%;}
.goat-lockup__meteors i:nth-child(1){left:74%;top:6%;--gl-m-h:5.2em;--gl-m-d:2.85s;--gl-m-delay:0s;}
.goat-lockup__meteors i:nth-child(2){left:52%;top:-4%;--gl-m-h:3.4em;--gl-m-d:3.9s;--gl-m-delay:-.48s;}
.goat-lockup__meteors i:nth-child(3){left:89%;top:22%;--gl-m-h:4.6em;--gl-m-d:3.15s;--gl-m-delay:-1.11s;}
.goat-lockup__meteors i:nth-child(4){left:33%;top:12%;--gl-m-h:2.8em;--gl-m-d:4.65s;--gl-m-delay:-1.65s;}
.goat-lockup__meteors i:nth-child(5){left:64%;top:38%;--gl-m-h:3.9em;--gl-m-d:3.6s;--gl-m-delay:-.27s;}
.goat-lockup__meteors i:nth-child(6){left:18%;top:-8%;--gl-m-h:4.1em;--gl-m-d:4.2s;--gl-m-delay:-1.43s;}
.goat-lockup__meteors i:nth-child(7){left:97%;top:-2%;--gl-m-h:3.1em;--gl-m-d:3.45s;--gl-m-delay:-2.18s;}
.goat-lockup__meteors i:nth-child(8){left:44%;top:30%;--gl-m-h:5.6em;--gl-m-d:2.55s;--gl-m-delay:-.87s;}
.goat-lockup__meteors i:nth-child(9){left:82%;top:48%;--gl-m-h:2.6em;--gl-m-d:5.1s;--gl-m-delay:-2.7s;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .goat-lockup__meteors{opacity:1;transition-duration:630ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .goat-lockup__meteors i,.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-steam path{animation-play-state:running;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .goat-lockup__tag{color:var(--gl-name);transition-duration:630ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-seal-face{fill:var(--gl-seal-lit);transition-duration:690ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-seal-glow{opacity:.7;transition:opacity 690ms var(--gl-in);}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-char{opacity:0;transition:opacity var(--gl-t-fade) linear;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-thumb{opacity:1;transition:opacity var(--gl-t-fade) linear 180ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-burst{opacity:1;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ray{animation:gl-ray 690ms var(--gl-in) var(--gl-ray-lag,0ms) both;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ring{animation:gl-ring 930ms var(--gl-in) 705ms both;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ember{animation:gl-ember 1350ms var(--gl-in) var(--gl-ember-lag,840ms) both;}
.gl-ray--1{--gl-ray-lag:720ms;}
.gl-ray--2{--gl-ray-lag:765ms;}
.gl-ray--3{--gl-ray-lag:738ms;}
.gl-ray--4{--gl-ray-lag:792ms;}
.gl-ray--5{--gl-ray-lag:752ms;}
.gl-ray--6{--gl-ray-lag:816ms;}
.gl-ember--a{--gl-ember-lag:840ms;--gl-ex:-13px;--gl-ey:-28px;}
.gl-ember--b{--gl-ember-lag:975ms;--gl-ex:15px;--gl-ey:-21px;}
.gl-ember--c{--gl-ember-lag:908ms;--gl-ex:3px;--gl-ey:-34px;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-photo__frame{transform:scale(1.06);transition:transform 1200ms var(--gc-in);}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf{inset:calc(var(--gc-vf-in) + 3px) calc(var(--gc-vf-in) + 3px) calc(var(--gc-vf-in) + var(--gc-vf-b,0px) + 3px);transition:inset 420ms var(--gc-in);}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf::after{opacity:1;transition:opacity 300ms linear 140ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-osd__dot{animation:gc-tally 2.4s .5s ease-in-out infinite;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-steam{opacity:1;transition:opacity 700ms var(--gc-in) 150ms;}
.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-qr__tile{box-shadow:0 6px 16px -8px rgba(0,0,0,.7),0 0 0 2px rgba(201,138,70,.6),0 0 14px rgba(201,138,70,.28);transition:box-shadow 630ms var(--gc-in);}
.goat:not(.goat--gated) .goat-lockup:hover{transform:var(--gc-lift);box-shadow:var(--gc-lift-shadow);transition:transform 420ms var(--gc-in),box-shadow 420ms var(--gc-in);}
.goat:not(.goat--gated) .goat-lockup:active{transform:var(--gc-press);transition-duration:120ms;}
@keyframes gl-meteor{0%{translate:3.2em -4.8em;opacity:0;}9%{opacity:1;}68%{opacity:1;}100%{translate:-3.4em 5.1em;opacity:0;}}
@keyframes gl-ray{0%{stroke-dashoffset:9;opacity:0;}22%{opacity:1;}100%{stroke-dashoffset:-32;opacity:0;}}
@keyframes gl-ring{0%{transform:scale(.3);opacity:0;}18%{opacity:.85;}100%{transform:scale(1.9);opacity:0;}}
@keyframes gl-ember{0%{transform:translate(0,0) scale(.4);opacity:0;}25%{opacity:.9;}100%{transform:translate(var(--gl-ex,6px),var(--gl-ey,-16px)) scale(1);opacity:0;}}
@keyframes gc-steam{0%{stroke-dashoffset:44;opacity:0;translate:0 0;}18%{opacity:.95;}65%{opacity:.6;}100%{stroke-dashoffset:-100;opacity:0;translate:2px -6px;}}
@keyframes gc-tally{0%,100%{opacity:1;}50%{opacity:.3;}}
.goat--panel .goat-lockup{font-size:7.2px;--gl-seal-scale:1.8;--gc-meteor-inset:-40% 0 -20%;grid-template-columns:auto minmax(0,1fr) 72px;grid-template-rows:72px auto;grid-template-areas:"photo photo qr" "mark word word";gap:4px 8px;padding:7px 7px 7px 10px;}
.goat--panel .gc-photo{margin:-7px 0 -24px -10px;--gc-px:46%;--gc-py:8%;--gc-vf-b:22px;--gc-scrim:linear-gradient(to right,rgba(20,13,8,0) 70%,var(--gc-950)),linear-gradient(to bottom,rgba(20,13,8,0) 52%,rgba(20,13,8,.86) 78%,var(--gc-950) 94%);--gc-edge:linear-gradient(to left,#0000,#000 3px),linear-gradient(to top,#0000,#000 3px);-webkit-mask-composite:source-in;mask-composite:intersect;}
.goat--panel .gc-osd{--gc-osd-fs:6.5px;align-items:center;gap:3px;padding:2px 4px;left:calc(var(--gc-vf-in) + var(--gc-arm) + 3px);}
.goat--panel .gc-osd__t{display:block;}
.goat--panel .gc-osd__sep{display:inline;white-space:pre;}
.goat--panel .gc-osd__dot{margin-top:0;}
.goat--panel .gc-steam{left:63%;}
.goat--settings .goat-lockup{font-size:13px;--gl-seal-scale:1.25;--gc-name:26px;--gc-tag:8px;--gc-tag-track:.15em;--gc-word-gap:8px;--gc-qr:74px;--gc-qr-r:7px;--gc-lift:scale(1.02);--gc-press:scale(.99);grid-template-columns:128px auto minmax(0,1fr) auto;grid-template-areas:"photo mark word qr";align-items:center;column-gap:14px;padding:13px 14px 13px 0;}
.goat--settings .gc-photo{--gc-arm:11px;--gc-vf-in:7px;--gc-px:46%;--gc-py:42%;align-self:stretch;margin:-13px 0;}
.goat--settings .gc-osd{--gc-osd-fs:7px;--gc-dot:7px;top:4px;gap:4px;padding:3px 5px;}
.goat--settings .gc-qr__cap{display:flex;}
.goat--strip{display:inline-flex;flex-wrap:nowrap;align-items:center;gap:10px;width:auto;max-width:none;}
.goat--strip .goat__copy{flex:none;width:160px;margin:0;gap:3px;}
.goat--strip .goat-lockup{flex:none;width:max-content;height:76px;font-size:8px;--gl-seal-scale:1.6;--gc-tag:7px;--gc-word-gap:4px;--gc-qr-r:8px;--gc-meteor-inset:-22% -10%;--gc-lift:scale(1.02);--gc-press:scale(.99);grid-template-columns:96px auto auto 72px;grid-template-areas:"photo mark word qr";align-items:center;column-gap:10px;padding:1px 1px 1px 0;}
.goat--strip .gc-photo{--gc-arm:8px;--gc-vf-in:5px;--gc-px:50%;--gc-py:40%;align-self:stretch;margin:-1px 0;}
.goat--strip .gc-osd,.goat--strip .gc-tag__sep{display:none;}
.goat--strip .goat-lockup__tag{display:flex;flex-direction:column;}
@media (prefers-reduced-motion:reduce){.goat-lockup__meteors i{animation:none;translate:0 0;opacity:.5;}.gc-steam{display:none;}.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ray,.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ember{animation:none;opacity:0;}.goat-lockup:is(:hover,:focus-visible,.is-active) .gl-ring{animation:none;opacity:.5;transform:scale(1.15);transition:opacity 330ms linear 300ms;}.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-photo__frame{transform:none;}.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf{inset:var(--gc-vf-in) var(--gc-vf-in) calc(var(--gc-vf-in) + var(--gc-vf-b,0px));}.goat-lockup:is(:hover,:focus-visible,.is-active) .gc-osd__dot{animation:none;}.goat .goat-lockup,.goat:not(.goat--gated) .goat-lockup:hover,.goat:not(.goat--gated) .goat-lockup:active{transform:none;}}
.goat{margin-top:22px;margin-bottom:2px}
.shell:hover .goat--gated .goat-lockup:hover{transform:var(--gc-lift);box-shadow:var(--gc-lift-shadow);transition:transform 420ms var(--gc-in),box-shadow 420ms var(--gc-in)}
.shell:hover .goat--gated .goat-lockup:active{transform:var(--gc-press);transition-duration:120ms}
@media (prefers-reduced-motion:reduce){.shell:hover .goat--gated .goat-lockup:hover,.shell:hover .goat--gated .goat-lockup:active{transform:none}}
`;

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
 * The GOAT Cam banner. Renders in two very different roots:
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
 *
 * `variant` is required, not defaulted: "panel" and "settings" are two different
 * grid layouts, measured for the open panel's 220-245px and the settings tab's
 * 594px respectively, and the wrong one does not fit its host. A third call site
 * must be made to choose rather than inheriting whichever default happened to be
 * here. The panel variant also opts into the .shell:hover lift gate above.
 */
export function GoatBanner({ variant }: { variant: "panel" | "settings"; }): JSX.Element {
    React.useEffect(ensureBannerCss, []);

    const rootClass = variant === "panel" ? "goat goat--panel goat--gated" : "goat goat--settings";

    return (
        <div className={rootClass}>
            <div className="goat__copy">
                {/*
                  A LINE WAS REMOVED FROM THE TOP OF THIS BLOCK, and what it was for is
                  worth knowing before anybody removes another.

                  It read "From the makers of Discord Translator" and it named the product
                  this promotion belongs to, which is what both extension stores ask for:
                  Chrome requires an ad to be "presented in context or clearly state which
                  product they are bundled with", and Mozilla accepts promotions "in user
                  interface elements that are clearly identified as belonging to the
                  add-on". It also stopped the banner reading as native Discord content,
                  which is the thing Chrome's third-party-site clause is actually written
                  about. Operator instruction, 2026-08-29: delete it from both variants.

                  What still carries the attribution: in the panel this banner renders
                  inside the plugin's own shadow-root panel, under the plugin's own
                  heading; in the settings tab it renders inside the "Discord Translator"
                  settings screen. The store requirement is met by CONTEXT now rather
                  than by a sentence, which is a weaker guarantee than it was — a future
                  reviewer asking "where does this ad say what it belongs to?" should be
                  pointed here rather than at a line that no longer exists.
                */}
                <span className="goat__line">GOAT Cam &mdash; your iPhone, <em>NOW</em> your PC&rsquo;s webcam.</span>
                <span className="goat__line goat__line--ask">Free Windows&nbsp;11 app &middot; USB or Wi&#8209;Fi &middot; Scan for the iPhone app.</span>
            </div>
            <a className="goat-lockup goat__link" href={GOAT_URL} target="_blank" rel="noopener noreferrer" aria-label={"GOAT Cam \u2014 open goatcam.dagoat.io"} data-goat-mark="">
                <span className="gc-photo" aria-hidden="true">
                    <span className="gc-photo__frame">
                        <img className="gc-photo__img" src="data:image/webp;base64,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" alt="" width="264" height="222" draggable="false" />
                        <svg className="gc-steam" viewBox="0 0 60 120" focusable="false">
                            <path pathLength="100" d="M22 118C14 100 30 88 22 70S14 40 24 22" />
                            <path pathLength="100" d="M32 118C40 98 24 84 33 64S42 36 32 14" />
                            <path pathLength="100" d="M42 118C36 102 48 90 41 74S36 50 44 34" />
                        </svg>
                    </span>
                    <span className="gc-vf" />
                    <span className="gc-osd">
                        <span className="gc-osd__dot" />
                        <span className="gc-osd__t">
                            <span>1080p</span>
                            <span className="gc-osd__sep"> &middot; </span>
                            <span>60 fps</span>
                        </span>
                    </span>
                </span>
                <span className="goat-lockup__meteors" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                </span>
                <span className="goat-lockup__mark" aria-hidden="true">
                    <svg className="goat-lockup__svg" viewBox="46 -16 220 250" xmlns="http://www.w3.org/2000/svg" focusable="false">
                        <g className="gl-head">
                            <path d="M62 210 C74 148 120 98 190 80 C152 106 106 150 82 216 Z" />
                            <path d="M186 84 C214 62 226 32 210 8 C216 36 200 62 174 80 Z" />
                            <path d="M170 82 C190 60 194 34 180 16 C186 40 172 62 156 78 Z" />
                            <path d="M188 82 C206 90 218 104 222 122 C212 106 200 94 182 90 Z" />
                            <path d="M206 122 C215 134 217 149 209 160 C212 147 208 133 200 127 Z" />
                            <circle cx="197" cy="99" r="3.6" />
                        </g>
                        <g className="gl-seal">
                            <rect className="gl-seal-glow" x="214" y="182" width="36" height="36" rx="4" />
                            <rect className="gl-seal-face" x="214" y="182" width="36" height="36" rx="4" />
                            <svg className="gl-glyph" x="214" y="182" width="36" height="36" viewBox="0 0 100 100">
                                <path className="gl-thumb" d="M30 50 C26 50 24 52 24 56 L24 87 C24 91 26 93 30 93 L73 93 C79 93 84 90 85 84 L89 55 C90 49 86 44 80 44 L63 44 C65 38 67 25 65 18 C63 12 55 12 53 18 C51 24 53 33 51 42 C50 47 47 50 42 50 Z" transform="translate(-5 -3)" />
                                <path className="gl-char" d="M33.5 18.12Q39.14 21.51 41.54 23.62Q43.93 25.74 43.65 27.85Q43.37 29.97 42.24 30.96Q41.11 31.94 40.55 31.94Q39.42 31.94 38.57 29.12Q37.45 25.17 32.93 18.97ZM20.52 33.07H52.68Q58.89 23.76 60.86 16.99L66.79 20.66Q63.96 22.07 61.14 25.74Q58.04 29.41 54.37 33.07H68.2L72.43 28.84L77.79 34.77H51.55V47.46H63.96L68.2 43.79L72.99 49.15H51.55V62.13H71.58L76.1 57.9L81.46 63.82H51.55V73.7Q51.55 76.8 51.83 81.32L47.04 83.01Q47.32 78.78 47.32 63.82H27.85Q24.19 63.82 21.08 64.67L18.54 62.13H47.32V49.15H35.47Q31.8 49.15 28.7 50L26.16 47.46H47.32V34.77H29.83Q26.16 34.77 23.06 35.61Z" />
                                <g className="gl-burst" transform="translate(53 0)" fill="none">
                                    <circle className="gl-ring" cx="0" cy="0" r="12" />
                                    <line className="gl-ray gl-ray--1" transform="rotate(-168)" x1="10" y1="0" x2="40" y2="0" />
                                    <line className="gl-ray gl-ray--2" transform="rotate(-138)" x1="10" y1="0" x2="40" y2="0" />
                                    <line className="gl-ray gl-ray--3" transform="rotate(-108)" x1="10" y1="0" x2="40" y2="0" />
                                    <line className="gl-ray gl-ray--4" transform="rotate(-76)" x1="10" y1="0" x2="40" y2="0" />
                                    <line className="gl-ray gl-ray--5" transform="rotate(-44)" x1="10" y1="0" x2="40" y2="0" />
                                    <line className="gl-ray gl-ray--6" transform="rotate(-14)" x1="10" y1="0" x2="40" y2="0" />
                                    <circle className="gl-ember gl-ember--a" cx="-7" cy="-2" r="2.2" />
                                    <circle className="gl-ember gl-ember--b" cx="8" cy="-5" r="1.9" />
                                    <circle className="gl-ember gl-ember--c" cx="0" cy="-9" r="1.6" />
                                </g>
                            </svg>
                        </g>
                    </svg>
                </span>
                <span className="goat-lockup__word">
                    <span className="goat-lockup__name">GOAT Cam</span>
                    <span className="goat-lockup__tag">
                        <span className="gc-tag__a">iPhone app</span>
                        <span className="gc-tag__sep"> &middot; </span>
                        <span className="gc-tag__b">On the App Store</span>
                    </span>
                </span>
                <span className="gc-qr">
                    <span className="gc-qr__tile">
                        <svg viewBox="0 0 37 37" shapeRendering="crispEdges" role="img" aria-label="QR code that opens GOAT Cam on the App Store" xmlns="http://www.w3.org/2000/svg" focusable="false">
                            <rect width="37" height="37" fill="#fbf5ea" />
                            <path fill="#1c130c" d="M4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM17 4h1v1h-1zM20 4h1v1h-1zM22 4h1v1h-1zM24 4h1v1h-1zM26 4h1v1h-1zM27 4h1v1h-1zM28 4h1v1h-1zM29 4h1v1h-1zM30 4h1v1h-1zM31 4h1v1h-1zM32 4h1v1h-1zM4 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM16 5h1v1h-1zM18 5h1v1h-1zM21 5h1v1h-1zM23 5h1v1h-1zM26 5h1v1h-1zM32 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM17 6h1v1h-1zM18 6h1v1h-1zM19 6h1v1h-1zM20 6h1v1h-1zM23 6h1v1h-1zM24 6h1v1h-1zM26 6h1v1h-1zM28 6h1v1h-1zM29 6h1v1h-1zM30 6h1v1h-1zM32 6h1v1h-1zM4 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM10 7h1v1h-1zM14 7h1v1h-1zM16 7h1v1h-1zM17 7h1v1h-1zM18 7h1v1h-1zM19 7h1v1h-1zM21 7h1v1h-1zM23 7h1v1h-1zM24 7h1v1h-1zM26 7h1v1h-1zM28 7h1v1h-1zM29 7h1v1h-1zM30 7h1v1h-1zM32 7h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM15 8h1v1h-1zM21 8h1v1h-1zM22 8h1v1h-1zM23 8h1v1h-1zM26 8h1v1h-1zM28 8h1v1h-1zM29 8h1v1h-1zM30 8h1v1h-1zM32 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM20 9h1v1h-1zM21 9h1v1h-1zM22 9h1v1h-1zM24 9h1v1h-1zM26 9h1v1h-1zM32 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM27 10h1v1h-1zM28 10h1v1h-1zM29 10h1v1h-1zM30 10h1v1h-1zM31 10h1v1h-1zM32 10h1v1h-1zM13 11h1v1h-1zM16 11h1v1h-1zM17 11h1v1h-1zM19 11h1v1h-1zM20 11h1v1h-1zM4 12h1v1h-1zM7 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM16 12h1v1h-1zM19 12h1v1h-1zM21 12h1v1h-1zM25 12h1v1h-1zM28 12h1v1h-1zM30 12h1v1h-1zM31 12h1v1h-1zM32 12h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM12 13h1v1h-1zM15 13h1v1h-1zM16 13h1v1h-1zM19 13h1v1h-1zM20 13h1v1h-1zM23 13h1v1h-1zM28 13h1v1h-1zM30 13h1v1h-1zM31 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM15 14h1v1h-1zM17 14h1v1h-1zM19 14h1v1h-1zM21 14h1v1h-1zM22 14h1v1h-1zM26 14h1v1h-1zM30 14h1v1h-1zM4 15h1v1h-1zM5 15h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM11 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM21 15h1v1h-1zM22 15h1v1h-1zM23 15h1v1h-1zM27 15h1v1h-1zM28 15h1v1h-1zM29 15h1v1h-1zM32 15h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM7 16h1v1h-1zM10 16h1v1h-1zM11 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM16 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM23 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM32 16h1v1h-1zM8 17h1v1h-1zM11 17h1v1h-1zM13 17h1v1h-1zM14 17h1v1h-1zM18 17h1v1h-1zM19 17h1v1h-1zM26 17h1v1h-1zM27 17h1v1h-1zM28 17h1v1h-1zM29 17h1v1h-1zM30 17h1v1h-1zM31 17h1v1h-1zM32 17h1v1h-1zM4 18h1v1h-1zM5 18h1v1h-1zM6 18h1v1h-1zM7 18h1v1h-1zM8 18h1v1h-1zM9 18h1v1h-1zM10 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM16 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM20 18h1v1h-1zM22 18h1v1h-1zM23 18h1v1h-1zM25 18h1v1h-1zM26 18h1v1h-1zM28 18h1v1h-1zM30 18h1v1h-1zM32 18h1v1h-1zM4 19h1v1h-1zM7 19h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1zM18 19h1v1h-1zM19 19h1v1h-1zM22 19h1v1h-1zM23 19h1v1h-1zM25 19h1v1h-1zM26 19h1v1h-1zM28 19h1v1h-1zM30 19h1v1h-1zM32 19h1v1h-1zM7 20h1v1h-1zM8 20h1v1h-1zM10 20h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM16 20h1v1h-1zM19 20h1v1h-1zM20 20h1v1h-1zM22 20h1v1h-1zM23 20h1v1h-1zM24 20h1v1h-1zM29 20h1v1h-1zM4 21h1v1h-1zM5 21h1v1h-1zM7 21h1v1h-1zM8 21h1v1h-1zM9 21h1v1h-1zM11 21h1v1h-1zM13 21h1v1h-1zM16 21h1v1h-1zM19 21h1v1h-1zM20 21h1v1h-1zM22 21h1v1h-1zM23 21h1v1h-1zM25 21h1v1h-1zM28 21h1v1h-1zM30 21h1v1h-1zM31 21h1v1h-1zM4 22h1v1h-1zM5 22h1v1h-1zM6 22h1v1h-1zM10 22h1v1h-1zM11 22h1v1h-1zM12 22h1v1h-1zM13 22h1v1h-1zM14 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM18 22h1v1h-1zM19 22h1v1h-1zM23 22h1v1h-1zM25 22h1v1h-1zM26 22h1v1h-1zM27 22h1v1h-1zM28 22h1v1h-1zM29 22h1v1h-1zM32 22h1v1h-1zM4 23h1v1h-1zM5 23h1v1h-1zM6 23h1v1h-1zM7 23h1v1h-1zM9 23h1v1h-1zM14 23h1v1h-1zM15 23h1v1h-1zM16 23h1v1h-1zM17 23h1v1h-1zM23 23h1v1h-1zM28 23h1v1h-1zM29 23h1v1h-1zM30 23h1v1h-1zM4 24h1v1h-1zM5 24h1v1h-1zM6 24h1v1h-1zM9 24h1v1h-1zM10 24h1v1h-1zM12 24h1v1h-1zM13 24h1v1h-1zM15 24h1v1h-1zM17 24h1v1h-1zM19 24h1v1h-1zM21 24h1v1h-1zM23 24h1v1h-1zM24 24h1v1h-1zM25 24h1v1h-1zM26 24h1v1h-1zM27 24h1v1h-1zM28 24h1v1h-1zM29 24h1v1h-1zM30 24h1v1h-1zM31 24h1v1h-1zM12 25h1v1h-1zM17 25h1v1h-1zM19 25h1v1h-1zM20 25h1v1h-1zM21 25h1v1h-1zM22 25h1v1h-1zM24 25h1v1h-1zM28 25h1v1h-1zM29 25h1v1h-1zM4 26h1v1h-1zM5 26h1v1h-1zM6 26h1v1h-1zM7 26h1v1h-1zM8 26h1v1h-1zM9 26h1v1h-1zM10 26h1v1h-1zM12 26h1v1h-1zM14 26h1v1h-1zM16 26h1v1h-1zM17 26h1v1h-1zM19 26h1v1h-1zM21 26h1v1h-1zM22 26h1v1h-1zM23 26h1v1h-1zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h1v1h-1zM29 26h1v1h-1zM4 27h1v1h-1zM10 27h1v1h-1zM12 27h1v1h-1zM14 27h1v1h-1zM16 27h1v1h-1zM17 27h1v1h-1zM20 27h1v1h-1zM21 27h1v1h-1zM23 27h1v1h-1zM24 27h1v1h-1zM28 27h1v1h-1zM31 27h1v1h-1zM4 28h1v1h-1zM6 28h1v1h-1zM7 28h1v1h-1zM8 28h1v1h-1zM10 28h1v1h-1zM12 28h1v1h-1zM13 28h1v1h-1zM14 28h1v1h-1zM17 28h1v1h-1zM23 28h1v1h-1zM24 28h1v1h-1zM25 28h1v1h-1zM26 28h1v1h-1zM27 28h1v1h-1zM28 28h1v1h-1zM29 28h1v1h-1zM32 28h1v1h-1zM4 29h1v1h-1zM6 29h1v1h-1zM7 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h1v1h-1zM13 29h1v1h-1zM16 29h1v1h-1zM18 29h1v1h-1zM19 29h1v1h-1zM22 29h1v1h-1zM23 29h1v1h-1zM24 29h1v1h-1zM25 29h1v1h-1zM27 29h1v1h-1zM32 29h1v1h-1zM4 30h1v1h-1zM6 30h1v1h-1zM7 30h1v1h-1zM8 30h1v1h-1zM10 30h1v1h-1zM14 30h1v1h-1zM16 30h1v1h-1zM18 30h1v1h-1zM19 30h1v1h-1zM20 30h1v1h-1zM24 30h1v1h-1zM27 30h1v1h-1zM28 30h1v1h-1zM30 30h1v1h-1zM31 30h1v1h-1zM32 30h1v1h-1zM4 31h1v1h-1zM10 31h1v1h-1zM13 31h1v1h-1zM14 31h1v1h-1zM17 31h1v1h-1zM18 31h1v1h-1zM19 31h1v1h-1zM22 31h1v1h-1zM26 31h1v1h-1zM27 31h1v1h-1zM28 31h1v1h-1zM29 31h1v1h-1zM30 31h1v1h-1zM32 31h1v1h-1zM4 32h1v1h-1zM5 32h1v1h-1zM6 32h1v1h-1zM7 32h1v1h-1zM8 32h1v1h-1zM9 32h1v1h-1zM10 32h1v1h-1zM12 32h1v1h-1zM13 32h1v1h-1zM15 32h1v1h-1zM18 32h1v1h-1zM19 32h1v1h-1zM20 32h1v1h-1zM22 32h1v1h-1zM23 32h1v1h-1zM24 32h1v1h-1zM25 32h1v1h-1zM27 32h1v1h-1zM28 32h1v1h-1z" />
                        </svg>
                    </span>
                    <span className="gc-qr__cap">iPhone app<span>On the App Store</span></span>
                </span>
            </a>
        </div>
    );
}
