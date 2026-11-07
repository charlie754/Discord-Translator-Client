/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/goatBanner.tsx
import { React } from "@webpack/common";
import type { CSSProperties, JSX } from "react";

import { bannerEvents, type Model, useGoatBannerModel } from "../banner/coordinator";

const DAGOAT_URL = "https://dagoat.io";
const QR_SIZE = 37;
const DAGOAT_LINE = "Goat Project - Help fight Cancer, Alzheimer’s, Parkinson’s, COVID-19, Dengue, Hepatitis C etc.";
const DAGOAT_ASK = "Contribute your idle compute to Earn GOAT.";

// Static extension preview only; this image is not part of the signed banner.
const IPHONE_PREVIEW_DATA_URL = "data:image/webp;base64,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";

type OnlineBanner = {
    headline?: string;
    headlineEm?: string;
    wordmark?: string;
    tagline?: string[];
    badge?: string;
    effects?: { viewfinder?: boolean; steam?: boolean };
    link?: string;
    qr?: { size?: number; rows?: string[] };
    photo?: {
        w?: number;
        h?: number;
        focus?: number[];
        steamAt?: number[];
        textBox?: number[];
    };
    labels?: { link?: string; qr?: string };
};

const toText = (value: unknown): string => typeof value === "string" ? value : "";

/** Turn the signed 0/1 QR rows into the one-path representation used by the brand. */
export function qrPathFromRows(rows: string[]): string {
    let path = "";
    for (let y = 0; y < rows.length; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
            if (row[x] === "1") path += `M${x} ${y}h1v1h-1z`;
        }
    }
    return path;
}

/**
 * Field limits are deliberately character-based in node tests. The visual gate
 * checks the resulting CSS against the 220–245px panel and 594px settings widths.
 */
export function fitClass(text: string, max: number): string {
    if (text.length <= max) return "";
    if (text.length <= max / 0.85) return "goat-fit-shrink";
    return "goat-fit-shrink goat-fit-ellipsis";
}

const percentage = (value: number | undefined, fallback: number) => {
    const number = Number(value);
    const safe = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
    return `${safe * 100}%`;
};
const style = (values: Record<string, string>): CSSProperties => values as CSSProperties;

function headlineChildren(headline: string, emphasis: string | undefined): Array<string | JSX.Element> {
    if (!emphasis) return [headline];
    const at = headline.indexOf(emphasis);
    if (at < 0) return [headline];
    return [headline.slice(0, at), <em key="headline-emphasis">{emphasis}</em>, headline.slice(at + emphasis.length)];
}

// A function, not a constant: JSX at module level runs the factory before Vencord exists.
const mark = () => (
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
);

function bannerEventsProps() {
    return {
        onPointerEnter: () => bannerEvents.pointer(true),
        onPointerLeave: () => bannerEvents.pointer(false),
        onFocus: () => bannerEvents.focus(true),
        onBlur: () => bannerEvents.focus(false),
        onClick: () => bannerEvents.click()
    };
}

/** The original offline DaGoat lockup from c92b854, kept as a separate model. */
export function GoatBannerDaGoat({ variant }: { variant: "panel" | "settings" }): JSX.Element {
    return (
        <div className={`goat goat--${variant} goat--gated goat--dagoat`}>
            <div className="goat__copy">
                <span className="goat__line">{DAGOAT_LINE}</span>
                <span className="goat__line goat__line--ask">{DAGOAT_ASK}</span>
            </div>
            <a className="goat-lockup goat__link" href={DAGOAT_URL} target="_blank" rel="noopener noreferrer" aria-label="DaGoat - open dagoat.io" data-goat-mark="" {...bannerEventsProps()}>
                <span className="goat-lockup__meteors" aria-hidden="true">
                    {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
                </span>
                {mark()}
                <span className="goat-lockup__word">
                    <span className="goat-lockup__name">Goatproject</span>
                    <span className="goat-lockup__tag">The People’s Compute Commons</span>
                </span>
            </a>
        </div>
    );
}

function GoatBannerOnline({ variant, model }: { variant: "panel" | "settings"; model: Extract<Model, { kind: "online" }> }): JSX.Element {
    const banner = model.banner as OnlineBanner;
    const headline = toText(banner.headline);
    const wordmark = toText(banner.wordmark);
    const tagline = Array.isArray(banner.tagline) ? banner.tagline.map(toText) : [];
    const photo = banner.photo ?? {};
    const focus = photo.focus ?? [];
    const steamAt = photo.steamAt ?? [];
    const imageStyle = style({
        objectPosition: `${percentage(focus[0], 0.3)} ${percentage(focus[1], 0.55)}`
    });
    const photoStyle = style({
        "--gc-px": percentage(focus[0], 0.3),
        "--gc-py": percentage(focus[1], 0.55)
    });
    const taglineText = tagline.join(" · ");
    const badge = toText(banner.badge);
    const qrRows = Array.isArray(banner.qr?.rows) ? banner.qr.rows : [];
    const events = bannerEventsProps();

    return (
        <div className={`goat goat--${variant} goat--gated goat--online`}>
            <div className="goat__copy">
                <span className={`goat__line ${fitClass(headline, 48)}`}>{headlineChildren(headline, toText(banner.headlineEm) || undefined)}</span>
            </div>
            <a className="goat-lockup goat__link" href={banner.link} target="_blank" rel="noopener noreferrer" aria-label={banner.labels?.link} data-goat-mark="" {...events}>
                <span className="gc-photo" aria-hidden="true" style={photoStyle}>
                    <span className="gc-photo__frame">
                        <img className="gc-photo__img" src={model.photoDataUrl} alt="" width={photo.w} height={photo.h} draggable="false" style={imageStyle} />
                    </span>
                    {banner.effects?.steam ? (
                        <svg className="gc-steam" viewBox="0 0 60 120" focusable="false" style={style({ left: percentage(steamAt[0], 0.17), top: percentage(steamAt[1], 0.62), bottom: "auto", translate: "-50% -50%" })}>
                            <path pathLength="100" d="M22 118C14 100 30 88 22 70S14 40 24 22" />
                            <path pathLength="100" d="M32 118C40 98 24 84 33 64S42 36 32 14" />
                            <path pathLength="100" d="M42 118C36 102 48 90 41 74S36 50 44 34" />
                        </svg>
                    ) : null}
                    {banner.effects?.viewfinder ? <span className="gc-vf" /> : null}
                </span>
                <span className="goat-lockup__word">
                    <span className={`goat-lockup__name ${fitClass(wordmark, 12)}`}>{wordmark}</span>
                    <span className={`goat-lockup__tag ${fitClass(taglineText, 18)}`}>
                        {tagline.flatMap((part, index) => [
                            index === 0 ? null : " · ",
                            <span className={`gc-tag__part ${fitClass(part, 18)}`} key={`${part}-${index}`}>{part}</span>
                        ])}
                    </span>
                </span>
                {badge ? <span className="gc-osd gc-badge" aria-hidden="true"><span className="gc-osd__dot" aria-hidden="true" /><span className={`gc-badge__text ${fitClass(badge, 16)}`}>{badge}</span></span> : null}
                <span className="gc-iphone" aria-hidden="true">
                    <img className="gc-iphone__screen" src={IPHONE_PREVIEW_DATA_URL} alt="" width="60" height="128" draggable="false" />
                </span>
                <span className="gc-qr">
                    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} shapeRendering="crispEdges" role="img" aria-label={banner.labels?.qr} xmlns="http://www.w3.org/2000/svg" focusable="false">
                        <rect width={QR_SIZE} height={QR_SIZE} fill="#fbf5ea" />
                        <path fill="#1c130c" d={qrPathFromRows(qrRows)} />
                    </svg>
                </span>
            </a>
        </div>
    );
}

export const GOAT_BANNER_CSS = `
/* DaGoat original lockup, restored from c92b854. Every selector is rooted so it cannot style the online model. */
.goat--dagoat{--gl-name-min:20px;--gl-tag-min:10px;--gl-seal-scale:1;display:block;box-sizing:border-box;width:100%;margin-top:22px;margin-bottom:2px;color:var(--ink-cream,#f0e6d2);}
.goat--dagoat .goat__copy{display:flex;flex-direction:column;gap:4px;margin:0 0 8px;}
.goat--dagoat .goat__line{display:block;margin:0;font-size:10.5px;line-height:1.4;font-weight:500;}
.goat--dagoat .goat__line--ask{color:var(--ink-muted,#a99f8c);font-weight:400;}
.goat--dagoat .goat__link{display:block;color:inherit;cursor:pointer;text-decoration:none;}
.goat--dagoat .goat__link:focus-visible{outline:2px solid var(--accent,#3ecf8e);outline-offset:2px;border-radius:8px;}
.goat--dagoat .goat-lockup{position:relative;display:inline-flex;align-items:center;gap:2em;width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;isolation:isolate;overflow:hidden;overflow:clip;background:#0b0b0d;color:#f2f3f5;text-decoration:none;font-size:20px;line-height:1;-webkit-tap-highlight-color:transparent;}
.goat--dagoat .goat-lockup__mark{position:relative;z-index:1;display:block;height:5.4em;flex:none;}
.goat--dagoat .goat-lockup__svg{display:block;width:auto;height:100%;overflow:visible;}
.goat--dagoat .gl-head>*{fill:#ece7db;}
.goat--dagoat .gl-seal{transform-box:fill-box;transform-origin:50% 50%;transform:scale(var(--gl-seal-scale));}
.goat--dagoat .gl-seal-face{fill:#b3382c;transition:fill 360ms cubic-bezier(.4,0,.2,1);}
.goat--dagoat .gl-seal-glow{fill:#b3382c;opacity:0;filter:blur(5px);transition:opacity 360ms cubic-bezier(.4,0,.2,1);}
.goat--dagoat .gl-glyph{overflow:visible;}
.goat--dagoat .gl-char{fill:#f6efe6;opacity:1;transition:opacity 360ms cubic-bezier(.4,0,.2,1);}
.goat--dagoat .gl-thumb{fill:#f6efe6;opacity:0;transition:opacity 360ms cubic-bezier(.4,0,.2,1);}
.goat--dagoat .gl-burst{opacity:0;}
.goat--dagoat .gl-ray{stroke:#f7ead6;stroke-width:3.2;stroke-linecap:round;stroke-dasharray:9 32;stroke-dashoffset:9;opacity:0;}
.goat--dagoat .gl-ring{fill:none;stroke:#f7ead6;stroke-width:3;opacity:0;transform-box:fill-box;transform-origin:50% 50%;}
.goat--dagoat .gl-ember{fill:#f7ead6;opacity:0;transform-box:fill-box;transform-origin:50% 50%;}
.goat--dagoat .goat-lockup__word{position:relative;z-index:1;display:flex;flex-direction:column;gap:.62em;font-family:Inter,"Helvetica Neue","Segoe UI",Arial,sans-serif;font-weight:300;}
.goat--dagoat .goat-lockup__name{font-size:max(var(--gl-name-min),1em);line-height:1;letter-spacing:.24em;text-transform:uppercase;text-indent:.24em;color:#f2f3f5;white-space:nowrap;}
.goat--dagoat .goat-lockup__tag{font-size:max(var(--gl-tag-min),.43em);font-weight:500;line-height:1;letter-spacing:.28em;text-transform:uppercase;text-indent:.28em;color:#9b9da4;white-space:nowrap;}
.goat--dagoat .goat-lockup__meteors{position:absolute;inset:-22% -12%;z-index:0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity 360ms cubic-bezier(.4,0,.2,1);}
.goat--dagoat .goat-lockup__meteors i{position:absolute;top:0;left:0;width:1px;height:var(--gl-m-h,4.4em);border-radius:1px;background:linear-gradient(to bottom,rgba(236,231,219,0),rgba(236,231,219,.68));rotate:34deg;translate:3.2em -4.8em;animation:dagoat-meteor var(--gl-m-d,3.3s) linear var(--gl-m-delay,0s) infinite;}
.goat--dagoat .goat-lockup__meteors i::after{content:"";position:absolute;left:50%;bottom:0;width:2.5px;height:2.5px;border-radius:50%;background:#ece7db;box-shadow:0 0 7px 1px rgba(236,231,219,.55);translate:-50% 40%;}
.goat--dagoat .goat-lockup__meteors i:nth-child(1){left:74%;top:6%;--gl-m-h:5.2em;--gl-m-d:2.85s;}.goat--dagoat .goat-lockup__meteors i:nth-child(2){left:52%;top:-4%;--gl-m-h:3.4em;--gl-m-d:3.9s;--gl-m-delay:-.48s;}.goat--dagoat .goat-lockup__meteors i:nth-child(3){left:89%;top:22%;--gl-m-h:4.6em;--gl-m-d:3.15s;--gl-m-delay:-1.11s;}.goat--dagoat .goat-lockup__meteors i:nth-child(4){left:33%;top:12%;--gl-m-h:2.8em;--gl-m-d:4.65s;--gl-m-delay:-1.65s;}.goat--dagoat .goat-lockup__meteors i:nth-child(5){left:64%;top:38%;--gl-m-h:3.9em;--gl-m-d:3.6s;--gl-m-delay:-.27s;}.goat--dagoat .goat-lockup__meteors i:nth-child(6){left:18%;top:-8%;--gl-m-h:4.1em;--gl-m-d:4.2s;--gl-m-delay:-1.43s;}.goat--dagoat .goat-lockup__meteors i:nth-child(7){left:97%;top:-2%;--gl-m-h:3.1em;--gl-m-d:3.45s;--gl-m-delay:-2.18s;}.goat--dagoat .goat-lockup__meteors i:nth-child(8){left:44%;top:30%;--gl-m-h:5.6em;--gl-m-d:2.55s;--gl-m-delay:-.87s;}.goat--dagoat .goat-lockup__meteors i:nth-child(9){left:82%;top:48%;--gl-m-h:2.6em;--gl-m-d:5.1s;--gl-m-delay:-2.7s;}
.goat--dagoat .goat-lockup:hover .goat-lockup__meteors,.goat--dagoat .goat-lockup:focus-visible .goat-lockup__meteors,.goat--dagoat .goat-lockup.is-active .goat-lockup__meteors{opacity:1;}.goat--dagoat .goat-lockup:hover .gl-seal-face,.goat--dagoat .goat-lockup:focus-visible .gl-seal-face,.goat--dagoat .goat-lockup.is-active .gl-seal-face{fill:#c8412f;}.goat--dagoat .goat-lockup:hover .gl-seal-glow,.goat--dagoat .goat-lockup:focus-visible .gl-seal-glow,.goat--dagoat .goat-lockup.is-active .gl-seal-glow{opacity:.7;}.goat--dagoat .goat-lockup:hover .gl-char,.goat--dagoat .goat-lockup:focus-visible .gl-char,.goat--dagoat .goat-lockup.is-active .gl-char{opacity:0;}.goat--dagoat .goat-lockup:hover .gl-thumb,.goat--dagoat .goat-lockup:focus-visible .gl-thumb,.goat--dagoat .goat-lockup.is-active .gl-thumb{opacity:1;}.goat--dagoat .goat-lockup:hover .gl-burst,.goat--dagoat .goat-lockup:focus-visible .gl-burst,.goat--dagoat .goat-lockup.is-active .gl-burst{opacity:1;}
.goat--dagoat .gl-ray--1{--gl-ray-lag:720ms;}.goat--dagoat .gl-ray--2{--gl-ray-lag:765ms;}.goat--dagoat .gl-ray--3{--gl-ray-lag:738ms;}.goat--dagoat .gl-ray--4{--gl-ray-lag:792ms;}.goat--dagoat .gl-ray--5{--gl-ray-lag:752ms;}.goat--dagoat .gl-ray--6{--gl-ray-lag:816ms;}.goat--dagoat .gl-ember--a{--gl-ember-lag:840ms;--gl-ex:-13px;--gl-ey:-28px;}.goat--dagoat .gl-ember--b{--gl-ember-lag:975ms;--gl-ex:15px;--gl-ey:-21px;}.goat--dagoat .gl-ember--c{--gl-ember-lag:908ms;--gl-ex:3px;--gl-ey:-34px;}
.goat--dagoat .goat-lockup:hover .gl-ray,.goat--dagoat .goat-lockup:focus-visible .gl-ray,.goat--dagoat .goat-lockup.is-active .gl-ray{animation:dagoat-ray 690ms cubic-bezier(.16,1,.3,1) var(--gl-ray-lag,0ms) both;}.goat--dagoat .goat-lockup:hover .gl-ring,.goat--dagoat .goat-lockup:focus-visible .gl-ring,.goat--dagoat .goat-lockup.is-active .gl-ring{animation:dagoat-ring 930ms cubic-bezier(.16,1,.3,1) 705ms both;}.goat--dagoat .goat-lockup:hover .gl-ember,.goat--dagoat .goat-lockup:focus-visible .gl-ember,.goat--dagoat .goat-lockup.is-active .gl-ember{animation:dagoat-ember 1350ms cubic-bezier(.16,1,.3,1) var(--gl-ember-lag,840ms) both;}
@keyframes dagoat-meteor{0%{translate:3.2em -4.8em;opacity:0;}9%{opacity:1;}68%{opacity:1;}100%{translate:-3.4em 5.1em;opacity:0;}}
@keyframes dagoat-ray{0%{stroke-dashoffset:9;opacity:0;}22%{opacity:1;}100%{stroke-dashoffset:-32;opacity:0;}}@keyframes dagoat-ring{0%{transform:scale(.3);opacity:0;}18%{opacity:.85;}100%{transform:scale(1.9);opacity:0;}}@keyframes dagoat-ember{0%{transform:translate(0,0) scale(.4);opacity:0;}25%{opacity:.9;}100%{transform:translate(var(--gl-ex,6px),var(--gl-ey,-16px)) scale(1);opacity:0;}}
.goat--dagoat.goat--panel .goat-lockup{--gl-name-min:15px;--gl-tag-min:7px;--gl-seal-scale:1.44;}.goat--dagoat.goat--panel .goat-lockup__name{letter-spacing:.24em;text-indent:0;}.goat--dagoat.goat--panel .goat-lockup__tag{letter-spacing:.18em;text-indent:0;}.goat--dagoat.goat--settings .goat-lockup{--gl-seal-scale:1.2;font-size:16px;}
@media (prefers-reduced-motion:reduce){.goat--dagoat .goat-lockup__meteors i{animation:none;translate:0 0;opacity:.5;}.goat--dagoat .goat-lockup:hover .gl-ray,.goat--dagoat .goat-lockup:focus-visible .gl-ray,.goat--dagoat .goat-lockup.is-active .gl-ray,.goat--dagoat .goat-lockup:hover .gl-ember,.goat--dagoat .goat-lockup:focus-visible .gl-ember,.goat--dagoat .goat-lockup.is-active .gl-ember{animation:none;opacity:0;}.goat--dagoat .goat-lockup:hover .gl-ring,.goat--dagoat .goat-lockup:focus-visible .gl-ring,.goat--dagoat .goat-lockup.is-active .gl-ring{animation:none;opacity:.5;transform:scale(1.15);}}

/* Online v2 look. The field limits are headline 48, wordmark 12, tagline part 18, badge 16. */
.goat--online{--gc-950:#140d08;--gc-gold:#f0c07a;--gc-cream:#f8eedf;--gc-cream-soft:#d8c2a5;--gc-line:rgba(248,238,223,.14);--gc-serif:"Palatino Linotype",Palatino,"Book Antiqua","Iowan Old Style",Georgia,serif;--gc-sans:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;--gc-mono:ui-monospace,Consolas,"SF Mono",Menlo,monospace;--gc-in:cubic-bezier(.16,1,.3,1);--gc-out:cubic-bezier(.4,0,.2,1);--gc-t-out:360ms;--gc-ink:var(--ink-cream,#f0e6d2);--gc-lift:translateY(-2px);--gc-press:scale(.98);--gc-lift-shadow:0 18px 44px rgba(0,0,0,.55),0 0 0 1px rgba(240,192,122,.22);--gc-qr:72px;--gc-qr-zoom:2.2223;--gc-arm:9px;display:block;box-sizing:border-box;width:100%;margin-top:22px;margin-bottom:2px;padding:0;color:var(--gc-ink);font:400 10.5px/1.4 var(--gc-sans);text-align:left;-webkit-font-smoothing:antialiased;}
.goat--online *,.goat--online *::before,.goat--online *::after{box-sizing:border-box;}.goat--online .goat__copy{display:block;margin:0 0 8px;padding:2px 0 1px;}.goat--online .goat__line{display:block;margin:0;font-size:10.5px;line-height:1.4;font-weight:500;color:var(--gc-ink);}.goat--online .goat__line em{font:italic 700 1.14em/1 var(--gc-serif);color:var(--gc-gold);letter-spacing:.02em;}.goat--online .goat-lockup{position:relative;z-index:2;display:block;width:100%;height:var(--gc-h,136px);margin:0;padding:0;border:1px solid var(--gc-line);border-radius:10px;background:var(--gc-950);color:var(--gc-cream);line-height:1;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform var(--gc-t-out) var(--gc-out),box-shadow var(--gc-t-out) var(--gc-out);}.goat--online .goat-lockup:hover{color:var(--gc-cream);text-decoration:none;}.goat--online .goat-lockup:focus-visible{outline:2px solid var(--gc-gold);outline-offset:2px;}
.goat--online .gc-photo{position:absolute;inset:0;z-index:0;display:block;overflow:hidden;border-radius:9px;container-type:size;background:var(--gc-950);}.goat--online .gc-photo__frame{position:absolute;left:var(--gc-px,0%);top:var(--gc-py,50%);display:block;width:max(100cqw,100cqh * 800 / 498);aspect-ratio:800 / 498;translate:calc(var(--gc-px,0%) * -1) calc(var(--gc-py,50%) * -1);transform-origin:30% 55%;transition:transform var(--gc-t-out) var(--gc-out);}.goat--online .gc-photo__img{display:block;width:100%;height:100%;max-width:none;margin:0;border:0;object-fit:cover;user-select:none;-webkit-user-drag:none;}.goat--online .gc-photo::after{content:"";position:absolute;inset:0;pointer-events:none;background:var(--gc-scrim,none);}.goat--online .gc-steam{position:absolute;left:13%;bottom:41.5%;width:7.5%;height:auto;aspect-ratio:60 / 120;translate:-50% 0;overflow:visible;opacity:0;filter:blur(.5px);transition:opacity var(--gc-t-out) var(--gc-out);}.goat--online .gc-steam path{fill:none;stroke:rgba(255,247,236,.9);stroke-width:6;stroke-linecap:round;stroke-dasharray:44 100;stroke-dashoffset:44;animation:goatcam-steam 3.2s linear infinite paused;}.goat--online .gc-vf{--gc-m:conic-gradient(at var(--gc-arm) var(--gc-arm),#0000 75%,#000 0) 0 0 / calc(100% - var(--gc-arm)) calc(100% - var(--gc-arm));position:absolute;z-index:1;pointer-events:none;inset:var(--gc-vf-t,6px) var(--gc-vf-r,6px) var(--gc-vf-b,6px) var(--gc-vf-l,6px);border:2px solid rgba(248,238,223,.62);-webkit-mask:var(--gc-m);mask:var(--gc-m);transition:inset var(--gc-t-out) var(--gc-out);}.goat--online .gc-vf::after{content:"";position:absolute;inset:-2px;border:2px solid var(--gc-gold);opacity:0;transition:opacity var(--gc-t-out) var(--gc-out);}
.goat--online .gc-osd{position:absolute;z-index:1;top:3px;left:calc(var(--gc-vf-l,6px) + var(--gc-arm) + 4px);display:flex;align-items:center;gap:3px;margin:0;padding:2px 4px;border-radius:4px;background:rgba(20,13,8,.62);color:var(--gc-cream);font:500 var(--gc-osd-fs,6.5px)/1 var(--gc-mono);letter-spacing:.05em;font-variant-numeric:tabular-nums;white-space:nowrap;}.goat--online .gc-osd__dot{flex:none;width:var(--gc-dot,5px);height:var(--gc-dot,5px);border-radius:50%;background:var(--gc-gold);}.goat--online .goat-lockup__word{position:absolute;z-index:1;left:var(--gc-word-x,16px);top:var(--gc-word-y,12px);display:flex;flex-direction:column;align-items:flex-start;gap:var(--gc-word-gap,5px);pointer-events:none;}.goat--online .goat-lockup__word::before{content:"";position:absolute;z-index:-1;inset:-10px -14px;background:radial-gradient(closest-side,rgba(20,13,8,.62),rgba(20,13,8,.3) 60%,rgba(20,13,8,0));}.goat--online .goat-lockup__name{display:block;font:400 var(--gc-name,17px)/1 var(--gc-serif);letter-spacing:-.005em;color:var(--gc-cream);white-space:nowrap;}.goat--online .goat-lockup__tag{display:flex;gap:.4em;font:600 var(--gc-tag,6.5px)/1.25 var(--gc-sans);letter-spacing:var(--gc-tag-track,.15em);text-transform:uppercase;color:var(--gc-cream-soft);white-space:nowrap;transition:color var(--gc-t-out) var(--gc-out);}.goat--online .gc-tag__part{display:inline-block;}.goat--online .gc-qr{position:absolute;z-index:3;top:var(--gc-qr-y,auto);right:var(--gc-qr-x,14px);bottom:var(--gc-qr-b,auto);display:block;width:var(--gc-qr);height:var(--gc-qr);overflow:hidden;border-radius:6px;background:#fbf5ea;box-shadow:0 6px 16px -8px rgba(0,0,0,.7);transform-origin:var(--gc-qr-origin,100% 100%);transition:scale 120ms var(--gc-out),box-shadow 120ms var(--gc-out);}.goat--online .gc-qr svg{display:block;width:100%;height:100%;shape-rendering:crispEdges;}.goat--online .gc-qr:hover,.goat--online .goat-lockup:focus-visible .gc-qr{scale:var(--gc-qr-zoom);box-shadow:0 8px 20px -6px rgba(0,0,0,.75),0 0 0 1px rgba(201,138,70,.55);transition-duration:200ms;transition-timing-function:var(--gc-in);}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-photo__frame{transform:scale(1.06);transition:transform 1200ms var(--gc-in);}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-steam{opacity:1;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-steam path{animation-play-state:running;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf{inset:calc(var(--gc-vf-t,6px) + 3px) calc(var(--gc-vf-r,6px) + 3px) calc(var(--gc-vf-b,6px) + 3px) calc(var(--gc-vf-l,6px) + 3px);}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf::after{opacity:1;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-osd__dot{animation:goatcam-tally 2.4s .5s ease-in-out infinite;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .goat-lockup__tag{color:var(--gc-cream);}.goat--online:not(.goat--gated) .goat-lockup:hover{transform:var(--gc-lift);box-shadow:var(--gc-lift-shadow);}.goat--online:not(.goat--gated) .goat-lockup:active{transform:var(--gc-press);}
.goat--online .goat-fit-shrink{font-size:85%;}.goat--online .goat-fit-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.goat--online .goat--panel .goat-lockup{--gc-h:128px;}.goat--online.goat--panel .gc-photo{--gc-px:0%;--gc-py:55%;--gc-scrim:none;}.goat--online.goat--panel .gc-qr{--gc-qr-x:14px;--gc-qr-b:14px;--gc-qr-origin:100% 100%;}.goat--online.goat--panel .gc-osd{left:auto;right:calc(var(--gc-vf-r,6px) + var(--gc-arm) + 4px);}.goat--online.goat--panel .goat-lockup__word{--gc-word-x:22px;--gc-word-y:14px;}
.goat--online.goat--panel .goat-lockup__word{left:var(--gc-word-x,16px)!important;right:calc(var(--gc-qr) + var(--gc-qr-x,14px) + 6px);width:auto!important;max-width:none;}
.goat--online.goat--panel .goat-lockup__name{max-width:100%;overflow:hidden;text-overflow:ellipsis;}
.goat--online.goat--panel .goat-lockup__tag{flex-wrap:wrap;row-gap:2px;white-space:normal;max-width:100%;}
.goat--online.goat--panel .gc-tag__part{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;}.goat--online.goat--settings .goat-lockup{--gc-h:106.4px;--gc-qr:74px;--gc-qr-zoom:2.1622;--gc-arm:11px;}.goat--online.goat--settings .gc-photo{--gc-px:0%;--gc-py:68%;--gc-scrim:none;}.goat--online.goat--settings .gc-qr{--gc-qr-x:18px;--gc-qr-y:calc((var(--gc-h) - 2px - var(--gc-qr)) / 2);--gc-qr-origin:100% 50%;}.goat--online.goat--settings .gc-vf{--gc-vf-t:7px;--gc-vf-l:7px;--gc-vf-b:7px;--gc-vf-r:7px;}.goat--online.goat--settings .gc-osd{--gc-osd-fs:7px;--gc-dot:7px;top:4px;left:22px;gap:4px;padding:3px 5px;}.goat--online.goat--settings .goat-lockup__word{--gc-word-x:222px;--gc-word-y:34px;--gc-name:30px;--gc-tag:8.5px;--gc-word-gap:9px;}.goat--online .goat--panel .goat-lockup,.goat--online .goat--settings .goat-lockup{margin:0;}.goat--online .goat--panel .goat-lockup__word,.goat--online .goat--settings .goat-lockup__word{pointer-events:none;}
@keyframes goatcam-steam{0%{stroke-dashoffset:44;opacity:0;translate:0 0;}18%{opacity:.95;}65%{opacity:.6;}100%{stroke-dashoffset:-100;opacity:0;translate:2px -6px;}}@keyframes goatcam-tally{0%,100%{opacity:1;}50%{opacity:.3;}}
@media (prefers-reduced-motion:reduce){.goat--online .gc-steam{display:none;}.goat--online .gc-qr,.goat--online .gc-qr:hover,.goat--online .goat-lockup:focus-visible .gc-qr{transition:none;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-photo__frame{transform:none;}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-vf{inset:var(--gc-vf-t,6px) var(--gc-vf-r,6px) var(--gc-vf-b,6px) var(--gc-vf-l,6px);}.goat--online .goat-lockup:is(:hover,:focus-visible,.is-active) .gc-osd__dot{animation:none;}.goat--online .goat-lockup,.goat--online .goat-lockup:hover,.goat--online .goat-lockup:active{transform:none;}}
/* Maps online geometry, ported from the founder-approved Maps widget. */
.goat--online .goat__copy {
  display: block;
  height: 48px;
  margin: 0 0 8px;
  padding: 0;
}
.goat--online .goat__line {
  display: block;
  width: 100%;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
}
.goat--online .goat-lockup {
  height: 74px;
}
.goat--online .goat-lockup__word {
  position: absolute;
  z-index: 1;
  left: 22px;
  top: 14px;
  display: flex;
  width: 112px;
  max-width: 112px;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  overflow: visible;
  pointer-events: none;
}
.goat--online .goat-lockup__name,
.goat--online .goat-lockup__tag {
  display: block;
  flex: none;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}
.goat--online .goat-lockup__name {
  font-size: 15px;
}
.goat--online .goat-lockup__tag {
  font-size: 6px;
}
.goat--online .goat-lockup__name {
  color: var(--gc-cream);
  text-shadow: 0 0 2px rgba(20, 13, 8, .96), 0 0 6px rgba(20, 13, 8, .78), 0 0 10px rgba(20, 13, 8, .42);
}
.goat--online .goat-lockup__tag {
  color: var(--gc-cream-soft);
  text-shadow: 0 0 2px rgba(20, 13, 8, .96), 0 0 5px rgba(20, 13, 8, .8), 0 0 10px rgba(20, 13, 8, .44);
}
.goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__tag {
  color: var(--gc-cream-soft);
}
.goat--online .gc-badge {
  position: absolute;
  z-index: 2;
  top: auto;
  right: auto;
  left: 22px;
  bottom: 7px;
  display: flex;
  align-items: center;
  gap: 3px;
  width: calc(50% - 28px);
  max-width: calc(50% - 28px);
  overflow: hidden;
  white-space: nowrap;
}
.goat--online .gc-badge {
  font: 700 6.5px/1.2 var(--gc-mono);
  padding: 2px 4px;
  letter-spacing: .05em;
  font-variant-numeric: tabular-nums;
  background: rgba(20, 13, 8, .82);
  box-shadow: none;
}
.goat--online .gc-badge__text {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  color: var(--gc-gold);
  text-shadow: 0 0 2px rgba(20, 13, 8, .96), 0 0 5px rgba(20, 13, 8, .8), 0 0 10px rgba(20, 13, 8, .44);
}
.goat--online .gc-badge .gc-osd__dot {
  flex: none;
}
.goat--online .gc-qr {
  --gc-qr: 60px;
  --gc-qr-zoom: 2.6667;
  top: 6px;
  right: 14px;
  bottom: auto;
}
.goat--online .gc-photo,
.goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo {
  --gc-scrim: none;
}
.goat--online .gc-photo::after {
  background: none;
}
.goat--online .gc-photo__img {
  filter: none;
}
.goat--online .goat-lockup__word::before {
  content: "";
  z-index: -1;
  inset: -6px 0 -6px -6px;
  border-radius: 50%;
  background: radial-gradient(ellipse 72px 30px at 48% 50%, rgba(20, 13, 8, .86), rgba(20, 13, 8, .56) 68%, rgba(20, 13, 8, 0) 100%);
  filter: blur(5px);
  opacity: 1;
}
.goat--online .gc-iphone {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 76px;
  display: block;
  width: 30px;
  height: 62px;
  overflow: hidden;
  border: 0;
  border-radius: 6.5px;
  background: transparent;
  box-shadow: 0 2px 5px rgba(0, 0, 0, .55);
  pointer-events: none;
}
.goat--online .gc-iphone::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0;
  border: 1px solid rgba(10, 8, 7, .92);
  border-radius: inherit;
  box-shadow: inset 0 0 0 .5px rgba(255, 239, 214, .4);
  pointer-events: none;
}
.goat--online .gc-iphone__screen {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 4.6px;
  object-fit: fill;
}

.goat--online .gc-badge{left:22px!important;right:auto!important;top:auto!important;bottom:7px!important;width:auto!important;max-width:calc(100% - 140px)!important;}
.goat--online .goat-lockup__word{width:auto!important;max-width:calc(100% - 132px)!important;}
.goat--online.goat--settings .gc-photo__frame{--gc-py:82%!important;top:82%!important;translate:calc(var(--gc-px,0%) * -1) -82%!important;}
`;

const STYLE_ID = "ct-goat-banner-css";

function ensureBannerCss() {
    if (document.getElementById(STYLE_ID)) return;
    const styleElement = document.createElement("style");
    styleElement.id = STYLE_ID;
    styleElement.textContent = GOAT_BANNER_CSS;
    document.head.appendChild(styleElement);
}

export function GoatBanner({ variant }: { variant: "panel" | "settings" }): JSX.Element {
    React.useEffect(ensureBannerCss, []);
    const model = useGoatBannerModel();
    return model.kind === "online" ? GoatBannerOnline({ variant, model }) : GoatBannerDaGoat({ variant });
}
