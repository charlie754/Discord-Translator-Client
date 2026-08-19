import type { Patch } from "@utils/types";

/**
 * Both patches target the same webpack module. This anchor has been repaired
 * three times in twenty days upstream, and showMeYourName patches the same
 * module — so one Discord rename breaks two plugins at once.
 *
 * Everything about this file is quarantined: if either patch stops matching,
 * the panel and the double-click translator keep working and the UI says so.
 */

const hits = { clone: false, wrap: false };

export function markPatchHit(id: "clone" | "wrap"): void {
    hits[id] = true;
}

export function patchesOk(): boolean {
    return hits.clone && hits.wrap;
}

export function patchHit(id: "clone" | "wrap"): boolean {
    return hits[id];
}

export const CHANNEL_TRANSLATOR_PATCHES: Omit<Patch, "plugin">[] = [
    {
        find: '.CUSTOM_GIFT?""',
        replacement: [
            {
                // Mode A: swap a prototype-preserving clone in at the memo boundary,
                // so Discord's own renderer parses markdown, mentions and emoji.
                match: /\i\.memo\(function\((\i)\)\{(?=let \i,\i)/,
                replace: "$&$1.message=$self.transformMessage($1?.message);"
            },
            {
                // Mode B: wrap the content slot so a translated row can be appended.
                match: /childrenMessageContent:(\i),/g,
                replace:
                    "childrenMessageContent:$self.wrapContent($1,arguments[0]?.message?.id," +
                    "arguments[0]?.message?.channel_id),"
            }
        ]
    }
];
