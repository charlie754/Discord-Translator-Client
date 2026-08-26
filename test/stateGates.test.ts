/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ToggleState, translationEnabled } from "../src/plugins/channelTranslator/core/modes";
import { isBilledProvider } from "../src/plugins/channelTranslator/core/usage";

/**
 * Two defects in state.ts and index.tsx, at the only layer that can see them.
 *
 * state.ts and index.tsx both resolve Vencord aliases (@api/MessageUpdater,
 * @api/Notices, @webpack/common) that do not exist under vitest, so neither can
 * be imported here — the same constraint recorded in
 * test/meteredProviderChokepoint.test.ts, test/selectionPrivacy.test.ts and
 * test/settingsCopy.test.ts. Source scanning is the only instrument that reaches
 * these files, and it is used here ONLY for wiring. Every DECISION asserted
 * below is imported and exercised for real: translationEnabled() from
 * core/modes.ts and isBilledProvider() from core/usage.ts.
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
 * 2. THE COST FACT WAS NEVER VOLUNTEERED AFTER FIRST RUN. The consent notice
 *    fires once, on a fresh install, while the provider is still the free
 *    keyless one — and it named "Google Translate" and no price. Switching later
 *    to DeepL or Google Cloud Translation changes the recipient AND starts
 *    billing the user's own key, and nothing said so: consentGiven was already
 *    true, so the notice never returned.
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
 * DEFECT 2 — switching to a billed provider says so, once.
 */
describe("switching to a billed provider surfaces the cost once", () => {
    const state = () => read(STATE);
    const index = () => read(INDEX);

    it("state.ts decides billed-ness with core/usage's isBilledProvider, not a second list", () => {
        expect(importsIdentifier(state(), "isBilledProvider")).toBe(true);
        expect(callsIdentifier(state(), "isBilledProvider")).toBe(true);
    });

    it("the two providers that charge the user really are the billed ones", () => {
        // Imported and run, so the notice cannot be wired to a stale idea of
        // which providers cost money.
        expect(isBilledProvider("deepl")).toBe(true);
        expect(isBilledProvider("google-cloud")).toBe(true);
        expect(isBilledProvider("google")).toBe(false);
    });

    it("index.tsx registers the notifier and tears it down on stop", () => {
        const src = index();
        expect(importsIdentifier(src, "setBilledProviderNotifier")).toBe(true);
        expect(codeOnly(src)).toContain("setBilledProviderNotifier(null)");
        // The notice itself is shown by index.tsx, which owns every notice.
        expect(codeOnly(src)).toContain("showNotice(billedProviderNotice(providerId)");
    });

    it("state.ts calls out through the injected notifier rather than importing index.tsx", () => {
        // index.tsx already imports state.ts. A direct call back would be a
        // cycle, and a cycle here is a plugin that fails to load.
        expect(importsIdentifier(state(), "showNotice")).toBe(false);
        expect(state()).not.toContain('from "./index"');
        expect(codeOnly(state())).toContain("billedProviderNotifier?.(providerId)");
    });

    it("fires at most once per provider per session — this runs on every message", () => {
        const src = codeOnly(state());
        // syncTranslationIdentity() is called from requestTranslation(), i.e.
        // per message. Without the announced-set this would be a banner per
        // message rather than a notice per switch.
        expect(src).toContain("billedProvidersAnnounced.has(providerId)");
        expect(src).toContain("billedProvidersAnnounced.add(providerId)");
        const guard = src.indexOf("billedProvidersAnnounced.has(providerId)");
        const fire = src.indexOf("billedProviderNotifier?.(");
        expect(guard).toBeGreaterThan(-1);
        expect(fire).toBeGreaterThan(guard);
    });

    it("announces a SWITCH, not the baseline — otherwise it nags on every launch", () => {
        const src = codeOnly(state());
        // The first sync of a session establishes what the provider already was.
        // Treating that as a switch would re-show the notice at every Discord
        // start for anyone who had settled on a paid provider months ago.
        expect(src).toContain("const isSwitch = lastProviderIdentity !== null;");
        expect(src).toContain("if (isSwitch) announceBilledProvider(");
    });

    it("hydrate() takes the baseline, so a switch made before the first translation still speaks", () => {
        const src = codeOnly(state());
        const start = src.indexOf("export function hydrate(");
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, src.indexOf("\n}", start));
        expect(
            body,
            "without this, the first translation of the session is the baseline — so a user who " +
            "opens settings, switches to a paid provider and only then translates is told nothing"
        ).toContain("syncTranslationIdentity();");
    });

    it("the notice says what it costs and how to stop it", () => {
        const src = index();
        const start = src.indexOf("function billedProviderNotice(");
        expect(start, "billedProviderNotice() not found").toBeGreaterThan(-1);
        const body = src.slice(start, src.indexOf("\n}", start));
        expect(body).toContain("bills you");
        expect(body).toContain("your own API key");
        // A cost notice with no way out is an alarm, not information.
        expect(body).toContain("monthly character cap");
        expect(body).toContain("Google (free)");
        // It names the provider that was actually chosen.
        expect(body).toContain("${label}");
    });

    it("names both billed providers in words a user recognises from the settings screen", () => {
        const src = index();
        expect(src).toContain('"deepl": "DeepL"');
        expect(src).toContain('"google-cloud": "Google Cloud Translation"');
    });
});

/*
 * The first-run notice, which is the other half of defect 2.
 */
describe("the first-run notice is honest about all three providers", () => {
    const consentNotice = (): string => {
        // Comments stripped FIRST. The block explains why it no longer names one
        // provider of three, and naming the old wording in that explanation must
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

    it("no longer claims the destination is Google Translate", () => {
        // Two of the three providers are not Google Translate, and one of them
        // is not Google at all.
        expect(
            consentNotice(),
            "the first-run notice named one provider of three as if it were the only one"
        ).not.toContain("Google Translate");
    });

    it("says that two of the providers are billed to the user", () => {
        const notice = consentNotice();
        expect(notice).toContain("billed to");
        expect(notice).toContain("DeepL");
        expect(notice).toContain("Google Cloud Translation");
    });

    it("still says the default costs nothing, and still promises the DM opt-in", () => {
        const notice = consentNotice();
        expect(notice).toContain("costs nothing");
        // PRIVACY.md and core/modes.ts both rest on this sentence.
        expect(notice).toContain("Direct messages are excluded unless you opt in");
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
