/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings } from "@main/settings";
import { session } from "electron";

type PolicyMap = Record<string, string[]>;

export const ConnectSrc = ["connect-src"];
export const ImageSrc = [...ConnectSrc, "img-src"];
export const CssSrc = ["style-src", "font-src"];
export const ImageAndMediaSrc = [...ImageSrc, "media-src"];
export const ImageAndCssSrc = [...ImageSrc, ...CssSrc];
export const ImageScriptsAndCssSrc = [...ImageAndCssSrc, "script-src", "worker-src"];
export const CSPSrc = ["style-src", "connect-src", "img-src", "frame-src", "font-src", "media-src", "worker-src"];

// Plugins can whitelist their own domains by importing this object in their native.ts
// script and just adding to it. But generally, you should just edit this file instead

export const CspPolicies: PolicyMap = {
    "http://localhost:*": ImageAndCssSrc,
    "http://127.0.0.1:*": ImageAndCssSrc,
    "localhost:*": ImageAndCssSrc,
    "127.0.0.1:*": ImageAndCssSrc,

    "*.github.io": ImageAndCssSrc, // GitHub pages, used by most themes
    "github.com": ImageAndCssSrc, // GitHub content (stuff uploaded to markdown forms), used by most themes
    "raw.githubusercontent.com": ImageAndCssSrc, // GitHub raw, used by some themes
    "*.gitlab.io": ImageAndCssSrc, // GitLab pages, used by some themes
    "gitlab.com": ImageAndCssSrc, // GitLab raw, used by some themes
    "*.codeberg.page": ImageAndCssSrc, // Codeberg pages, used by some themes
    "codeberg.org": ImageAndCssSrc, // Codeberg raw, used by some themes

    "*.githack.com": ImageAndCssSrc, // githack (namely raw.githack.com), used by some themes
    "jsdelivr.net": ImageAndCssSrc, // jsDelivr, used by very few themes

    "fonts.googleapis.com": CssSrc, // Google Fonts, used by many themes

    "i.imgur.com": ImageSrc, // Imgur, used by some themes
    "i.ibb.co": ImageSrc, // ImgBB, used by some themes
    "i.pinimg.com": ImageSrc, // Pinterest, used by some themes
    "files.catbox.moe": ImageAndCssSrc, // Catbox, used by some themes

    "cdn.discordapp.com": ImageAndCssSrc, // Discord CDN, used by Vencord and some themes to load media
    "media.discordapp.net": ImageSrc, // Discord media CDN, possible alternative to Discord CDN

    // Function Specific.
    // Upstream allow-listed roughly a dozen more hosts for plugins this fork
    // does not ship (Last.fm, ListenBrainz, ReviewDB, Decor, Dearrow, USRBG,
    // Tenor) plus *.vencord.dev for its cloud and badge services. Nothing here
    // requests them any more, and a CSP entry is a standing permission, so they
    // are gone.
    "api.github.com": ConnectSrc, // update checks against our own releases
    // The gtx endpoint the Google provider builds its URLs against. The translation
    // request itself is issued by a main-process fetch (channelTranslator/native.ts),
    // which no CSP applies to — this entry only covers requests originating in the
    // renderer, so it is a fallback, not the guard on the transport.
    "translate.googleapis.com": ConnectSrc,
    // translation.googleapis.com — the paid Cloud Translation v2 API that
    // core/providers/googleCloud.ts posts to — is deliberately NOT listed here.
    // On the desktop every translation request is issued by the main process, so
    // no CSP applies to it and an entry would buy that provider nothing. What an
    // entry WOULD buy is a standing permission for any renderer code to reach
    // that host, which is the quiet widening the pruning note above was written
    // about. If a renderer-side path to it ever appears, add it in that change.
};

const findHeader = (headers: PolicyMap, headerName: Lowercase<string>) => {
    return Object.keys(headers).find(h => h.toLowerCase() === headerName);
};

const parsePolicy = (policy: string): PolicyMap => {
    const result: PolicyMap = {};
    policy.split(";").forEach(directive => {
        const [directiveKey, ...directiveValue] = directive.trim().split(/\s+/g);
        if (directiveKey && !Object.prototype.hasOwnProperty.call(result, directiveKey)) {
            result[directiveKey] = directiveValue;
        }
    });

    return result;
};

const stringifyPolicy = (policy: PolicyMap): string =>
    Object.entries(policy)
        .filter(([, values]) => values?.length)
        .map(directive => directive.flat().join(" "))
        .join("; ");

const patchCsp = (headers: PolicyMap) => {
    const reportOnlyHeader = findHeader(headers, "content-security-policy-report-only");
    if (reportOnlyHeader)
        delete headers[reportOnlyHeader];

    const header = findHeader(headers, "content-security-policy");

    if (header) {
        const csp = parsePolicy(headers[header][0]);

        const pushDirective = (directive: string, ...values: string[]) => {
            csp[directive] ??= [...(csp["default-src"] ?? [])];
            csp[directive].push(...values);
        };

        pushDirective("style-src", "'unsafe-inline'");
        // we could make unsafe-inline safe by using strict-dynamic with a random nonce on our Vencord loader script https://content-security-policy.com/strict-dynamic/
        // HOWEVER, at the time of writing (24 Jan 2025), Discord is INSANE and also uses unsafe-inline
        // Once they stop using it, we also should
        pushDirective("script-src", "'unsafe-inline'", "'unsafe-eval'");

        for (const directive of ["style-src", "connect-src", "img-src", "font-src", "media-src", "worker-src"]) {
            pushDirective(directive, "blob:", "data:", "vencord:", "vesktop:", "equicord:", "equibop:");
        }

        for (const [host, directives] of Object.entries(NativeSettings.store.customCspRules)) {
            for (const directive of directives) {
                pushDirective(directive, host);
            }
        }

        for (const [host, directives] of Object.entries(CspPolicies)) {
            for (const directive of directives) {
                pushDirective(directive, host);
            }
        }

        headers[header] = [stringifyPolicy(csp)];
    }
};

export function initCsp() {
    session.defaultSession.webRequest.onHeadersReceived(({ responseHeaders, resourceType }, cb) => {
        if (responseHeaders) {
            if (resourceType === "mainFrame")
                patchCsp(responseHeaders);

            // Fix hosts that don't properly set the css content type, such as
            // raw.githubusercontent.com
            if (resourceType === "stylesheet") {
                const header = findHeader(responseHeaders, "content-type");
                if (header)
                    responseHeaders[header] = ["text/css"];
            }
        }

        cb({ cancel: false, responseHeaders });
    });

    // assign a noop to onHeadersReceived to prevent other mods from adding their own incompatible ones.
    // For instance, OpenAsar adds their own that doesn't fix content-type for stylesheets which makes it
    // impossible to load css from github raw despite our fix above
    session.defaultSession.webRequest.onHeadersReceived = () => { };
}
