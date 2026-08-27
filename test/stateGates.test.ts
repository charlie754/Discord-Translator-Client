/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ToggleState, translationEnabled } from "../src/plugins/channelTranslator/core/modes";

/**
 * Two defects in state.ts and index.tsx, at the only layer that can see them.
 *
 * state.ts and index.tsx both resolve Vencord aliases (@api/MessageUpdater,
 * @api/Notices, @webpack/common) that do not exist under vitest, so neither can
 * be imported here — the same constraint recorded in
 * test/providerChokepoint.test.ts, test/selectionPrivacy.test.ts and
 * test/settingsCopy.test.ts. Source scanning is the only instrument that reaches
 * these files, and it is used here ONLY for wiring. The DECISION asserted below
 * is imported and exercised for real: translationEnabled() from core/modes.ts.
 * (isBilledProvider() from core/usage.ts used to be the second one; that module
 * is deleted, along with every provider that could bill anyone.)
 *
 * 1. A MODE THE USER COULD SWITCH TO IN ORDER TO DEFEAT THEIR OWN SETTING.
 *    Both render entry points ask translationEnabled(), which knows about
 *    includeDMs. repaintChannel() in state.ts asked toggle.isOn() directly,
 *    which cannot. In Replace mode that did not show, because transformMessage()
 *    enqueues its own translations and is gated correctly. In Both-Language mode
 *    it did: wrapContent() only READS the cache, so repaintChannel() is the sole
 *    thing that enqueues anything, and its gate said no for every DM. One
 *    setting, two answers, chosen by which mode the user happened to be in.
 *
 * 2. THE RECIPIENT WAS NEVER VOLUNTEERED AFTER FIRST RUN. The consent notice
 *    fires once, on a fresh install — and it named "Google Translate" as though
 *    it were the only destination. It is not: the surviving alternative is an
 *    Apps Script deployment the user stands up in their own Google account, a
 *    different recipient reached over a different URL.
 *
 *    This defect used to have a COST half as well — switching to DeepL or Google
 *    Cloud Translation started billing the user's own key while consentGiven was
 *    already true, so an announcement was wired through state.ts to say so. Both
 *    paid providers are deleted. The announcement is deleted with them, and the
 *    describe below asserts that it really is gone rather than merely idle.
 */

const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
const STATE = join(PLUGIN, "state.ts");
const INDEX = join(PLUGIN, "index.tsx");
const RENDER = join(PLUGIN, "render.tsx");

function read(path: string): string {
    return readFileSync(path, "utf8");
}

function isCommentLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** An import of the identifier, not a mention of it in a comment. */
function importsIdentifier(source: string, identifier: string): boolean {
    return new RegExp(`import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from`, "m").test(source);
}

/** A call to the identifier, not a mention of it in a comment. */
function callsIdentifier(source: string, identifier: string): boolean {
    return source
        .split("\n")
        .filter(line => !isCommentLine(line))
        .some(line => new RegExp(`\\b${identifier.replace(".", "\\.")}\\s*\\(`).test(line));
}

/** Every non-comment line of the file, joined — for phrase searches over code only. */
function codeOnly(source: string): string {
    return source.split("\n").filter(line => !isCommentLine(line)).join("\n");
}

describe("the scanned files exist and are not empty", () => {
    it("state.ts, index.tsx and render.tsx are all present", () => {
        for (const file of [STATE, INDEX, RENDER]) {
            expect(existsSync(file), `not found: ${file}`).toBe(true);
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("the comment filter does not swallow real code (control for every scan below)", () => {
        const sample = [
            "// const on = toggle.isOn(guildIdOf(channelId));",
            " * toggle.isOn() cannot see a DM opt-in",
            "const on = translationEnabled(toggle, guildIdOf(channelId), settings.store.includeDMs);"
        ].join("\n");
        expect(callsIdentifier(sample, "translationEnabled")).toBe(true);
        // The first two lines mention toggle.isOn and must NOT count as calls.
        expect(callsIdentifier(sample, "toggle.isOn")).toBe(false);
    });
});

/*
 * DEFECT 1 — the whole-channel enqueue path asks the one decision.
 */
describe("repaintChannel asks translationEnabled, not the toggle", () => {
    const src = () => read(STATE);

    it("state.ts imports and calls translationEnabled", () => {
        expect(importsIdentifier(src(), "translationEnabled")).toBe(true);
        expect(callsIdentifier(src(), "translationEnabled")).toBe(true);
    });

    it("state.ts no longer calls toggle.isOn, which cannot see a DM opt-in", () => {
        expect(
            callsIdentifier(src(), "toggle.isOn"),
            "toggle.isOn() answers false for every DM regardless of includeDMs. " +
            "Use translationEnabled(toggle, guildId, settings.store.includeDMs)."
        ).toBe(false);
    });

    it("spells the decision exactly as render.tsx does, so the two cannot drift", () => {
        // Not a second spelling of the same question: the identical argument
        // list, character for character. A paraphrase here is how the two paths
        // disagreed in the first place.
        const call = "translationEnabled(toggle, guildIdOf(channelId), settings.store.includeDMs)";
        expect(codeOnly(src())).toContain(call);
        // render.tsx's wrapContent() uses the same channelId-shaped call.
        expect(codeOnly(read(RENDER))).toContain(call);
    });

    it("the gate is what decides whether messages are enqueued at all", () => {
        const source = codeOnly(src());
        const gate = source.indexOf("const on = translationEnabled(");
        const enqueue = source.indexOf("requestTranslation(original)");
        expect(gate, "the repaintChannel gate was not found").toBeGreaterThan(-1);
        expect(enqueue, "the enqueue call was not found").toBeGreaterThan(-1);
        expect(gate).toBeLessThan(enqueue);
        // And the enqueue really is inside the `if (on)` branch.
        expect(source.slice(gate, enqueue)).toContain("if (on) {");
    });

    /**
     * The behaviour the wiring above buys, exercised for real against the same
     * function state.ts now calls. This is what makes the two modes agree.
     */
    it("with includeDMs on, a DM is allowed — the answer Replace mode already got", () => {
        const toggle = new ToggleState();
        expect(translationEnabled(toggle, null, true)).toBe(true);
    });

    it("with includeDMs off or unset, a DM is still refused (negative control)", () => {
        const toggle = new ToggleState();
        expect(translationEnabled(toggle, null, false)).toBe(false);
        expect(translationEnabled(toggle, null, undefined)).toBe(false);
    });

    it("a server still answers to the panel toggle and not to includeDMs", () => {
        const toggle = new ToggleState();
        expect(translationEnabled(toggle, "guild-1", true)).toBe(false);
        toggle.setOn("guild-1", true);
        expect(translationEnabled(toggle, "guild-1", false)).toBe(true);
    });
});

/*
 * DEFECT 2 — the disclosure the first-run notice owes the user.
 *
 * The billed-provider announcement that used to live here is GONE, and this is
 * the record of why. It existed because switching to DeepL or Google Cloud
 * Translation changed the recipient AND started billing the user's own key while
 * consentGiven was already true, so nothing said so. Both providers have been
 * deleted; neither surviving one can bill anybody, so there is no price to
 * announce and no announcement to test.
 *
 * The half of that defect that did NOT go away is the recipient. Message text
 * still leaves this machine and which third party receives it still depends on a
 * setting, so the first-run notice below still has to say so — and now has to
 * name BOTH destinations rather than one of them.
 */
describe("the billed-provider machinery is gone, not merely unused", () => {
    const state = () => read(STATE);
    const index = () => read(INDEX);

    it("state.ts holds no notifier, no announcement and no idea of billing", () => {
        const src = codeOnly(state());
        for (const dead of [
            "isBilledProvider",
            "billedProviderNotifier",
            "billedProvidersAnnounced",
            "announceBilledProvider"
        ]) {
            expect(src, `${dead} survived in state.ts`).not.toContain(dead);
        }
    });

    it("index.tsx registers no notifier and ships no cost notice", () => {
        const src = codeOnly(index());
        for (const dead of [
            "setBilledProviderNotifier",
            "billedProviderNotice",
            "Google Cloud Translation",
            "DeepL"
        ]) {
            expect(src, `${dead} survived in index.tsx`).not.toContain(dead);
        }
    });

    it("core/usage.ts, which decided billed-ness, is not on disk at all", () => {
        // The import of isBilledProvider used to be at the top of this file. A
        // deleted module is invisible to a source scan of state.ts, so it is
        // asserted directly.
        expect(existsSync(join(PLUGIN, "core", "usage.ts"))).toBe(false);
        expect(existsSync(join(PLUGIN, "usageSettings.tsx"))).toBe(false);
    });

    it("the scans above can actually fail (positive control)", () => {
        // Each assertion is a .not.toContain over codeOnly(), so the control is
        // that codeOnly() surfaces a live line carrying one of those words.
        const live = codeOnly('const x = isBilledProvider("deepl");');
        expect(live).toContain("isBilledProvider");
        expect(codeOnly(" * isBilledProvider is gone\n")).not.toContain("isBilledProvider");
    });
});

/*
 * The first-run notice, which is the surviving half of defect 2.
 */
describe("the first-run notice is honest about both providers", () => {
    const consentNotice = (): string => {
        // Comments stripped FIRST. The block explains why it no longer names one
        // provider of two, and naming the old wording in that explanation must
        // not read as still shipping it — a guard that forbids its own
        // explanation rots, and this one went red on correct code before the
        // strip was added.
        const src = codeOnly(read(INDEX));
        const start = src.indexOf("if (!settings.store.consentGiven) {");
        expect(start, "the consent notice was not found in index.tsx").toBeGreaterThan(-1);
        const end = src.indexOf("\n        }", start);
        expect(end).toBeGreaterThan(start);
        return src.slice(start, end);
    };

    /**
     * The sentence the USER reads, not the source that produces it.
     *
     * The notice is written as adjacent string literals joined by `+`, so any
     * phrase that happens to straddle a concatenation boundary is absent from
     * the raw source while being present on screen — "Direct messages are " +
     * "excluded unless you opt in." is exactly that, and it went red here on
     * correct code. Reading the source directly would therefore have forced
     * either a weakened assertion or a reflow of the shipped notice to suit the
     * test. Both are the wrong fix: the claim is about what the user is told, so
     * the literals are rejoined and the claim is checked against that.
     */
    const noticeText = (): string =>
        (consentNotice().match(/"((?:[^"\\]|\\.)*)"/g) ?? [])
            .map(literal => literal.slice(1, -1))
            .join("");

    it("the rejoin really does bridge a concatenation boundary (positive control)", () => {
        // Without this control the helper could silently return "" and every
        // .toContain below would fail loudly — but every .not.toContain would
        // pass vacuously, which is the dangerous direction.
        expect(noticeText().length).toBeGreaterThan(200);
        const split = '"Direct messages are " +\n"excluded unless you opt in."';
        expect(split).not.toContain("Direct messages are excluded");
        const rejoined = (split.match(/"((?:[^"\\]|\\.)*)"/g) ?? [])
            .map(literal => literal.slice(1, -1))
            .join("");
        expect(rejoined).toContain("Direct messages are excluded unless you opt in");
    });

    it("no longer claims the destination is Google Translate", () => {
        // One of the two providers is not Google Translate: it is a deployment
        // the user stands up themselves, at a URL only they know.
        expect(
            consentNotice(),
            "the first-run notice named one provider of two as if it were the only one"
        ).not.toContain("Google Translate");
        expect(noticeText()).not.toContain("Google Translate");
    });

    it("names BOTH destinations, because which third party receives the text is a setting", () => {
        const notice = noticeText();
        expect(notice).toContain("Google (free)");
        expect(notice).toContain("Apps Script");
    });

    it("makes the disclosure that survived dropping the paid providers", () => {
        // Removing DeepL and Google Cloud removed the PRICE, not the fact that
        // private message text leaves this machine. A notice that answered
        // "is it free?" and stopped would be answering a question nobody asked
        // about their DMs.
        const notice = noticeText();
        expect(
            notice,
            "the notice must still say the text leaves the machine, not merely that it is free"
        ).toContain("leaves this machine");
        // PRIVACY.md and core/modes.ts both rest on this sentence.
        expect(notice).toContain("Direct messages are excluded unless you opt in");
    });

    it("promises nothing about a bill that could be broken by adding a paid provider", () => {
        // "neither can bill you" is a claim about the whole provider registry,
        // not about today's default. test/providers.test.ts is what holds the
        // registry to it; this asserts the two are talking about the same thing.
        const notice = noticeText();
        expect(notice).toContain("neither can bill you");
        expect(notice).not.toContain("DeepL");
        expect(notice).not.toContain("Google Cloud Translation");
    });

    it("its extractor really is reading the notice and not the whole file (control)", () => {
        // If the slice were empty or the whole file, every assertion above would
        // be meaningless in one direction or the other.
        const notice = consentNotice();
        expect(notice.length).toBeGreaterThan(200);
        expect(notice).toContain("consentGiven = true");
        expect(notice).not.toContain("export default definePlugin");
    });
});
