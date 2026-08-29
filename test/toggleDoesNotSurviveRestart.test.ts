/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE REAL CORE MODULES, not hand-written stubs. core/ resolves fine under
// vitest — the same reason test/guideTarget.test.ts hands settings.ts the
// genuine checkDeploymentUrl(). A stubbed ToggleState or TranslationCache would
// make this file a test of the stub: the whole question here is what the REAL
// ToggleState holds after the REAL hydrate() has run.
import { TranslationCache } from "../src/plugins/channelTranslator/core/cache";
import { aggregate, shouldTranslate, splitJoined } from "../src/plugins/channelTranslator/core/detect";
import { hashContent } from "../src/plugins/channelTranslator/core/hash";
import { ToggleState, translationEnabled } from "../src/plugins/channelTranslator/core/modes";
import { protect, restore } from "../src/plugins/channelTranslator/core/protect";
import { PermanentFailureRegistry } from "../src/plugins/channelTranslator/core/requestBookkeeping";
import { isPermanent, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";

/**
 * TRANSLATION IS OFF AT EVERY START. NOTHING CARRIES IT OVER.
 *
 * Operator ruling 2026-08-29: "Default off shall persist across restart."
 *
 * WHAT USED TO HAPPEN. hydrate() ran `toggle.loadFrom(settings.store.serverState)`
 * and persist() wrote the counterpart, so the guilds a user switched on in one
 * sitting were switched on again the next time Discord opened. Nobody asked for
 * that in the new session, and the consequence is not cosmetic: from the first
 * message onwards, that server's text is being sent to a translation provider by
 * a decision the user made weeks earlier and has no reason to remember making.
 * Being ON is now a deliberate, per-session act.
 *
 * WHY THIS FILE EXECUTES state.ts INSTEAD OF READING IT. Every other panel-side
 * guard in this suite is a source scan, because Panel.tsx imports @webpack/common
 * and cannot be loaded here at all. That reasoning does NOT extend to this
 * property. "Which servers are on after a restart" is a question about what
 * hydrate() does to a real ToggleState, and a scan for the absence of a line
 * cannot answer it — the same information could arrive through persist(), through
 * a second loader, through the settings default, or through anything a future
 * edit adds. So state.ts is compiled and evaluated against stubs, twice, and the
 * second evaluation IS the restart.
 *
 * THE STUB REGISTRY THROWS ON AN UNKNOWN ID rather than answering with an empty
 * object, exactly as test/guideTarget.test.ts's does. A permissive catch-all
 * would let this harness keep passing after state.ts grew an import nobody here
 * had considered — including one that could restore the toggle by another route,
 * which is precisely the regression this file exists to catch.
 */

const STATE_PATH = join(process.cwd(), "src", "plugins", "channelTranslator", "state.ts");
const STATE_SOURCE = readFileSync(STATE_PATH, "utf8");

/** The persisted settings a "restart" carries from one load to the next. */
type Store = Record<string, any>;

interface StateModule {
    toggle: ToggleState;
    cache: TranslationCache;
    hydrate(): void;
    persist(): void;
}

interface LoadedState {
    exports: StateModule;
    /** The settings object this load was given — inspectable after persist(). */
    store: Store;
    /** Every module id the compiled file actually required, in order. */
    required: string[];
}

interface LoadOptions {
    /** The settings that survived the last shutdown. Defaults to a fresh install. */
    store?: Store;
    /** Lets a test mutate the real source to prove an assertion can fail. */
    patchSource?: (source: string) => string;
}

/**
 * A fresh install's settings, with the defaults settings.ts declares for the two
 * ids hydrate() reads. `serverState` is deliberately NOT here: it is no longer
 * declared, and the restart test below plants it explicitly to model the config
 * file of a user who upgraded from a build that did write it.
 */
function freshStore(): Store {
    return { cacheBlob: "[]", provider: "google", appsScriptUrl: "" };
}

/** Compile and evaluate the real state.ts. One call models one client start. */
function loadState(opts: LoadOptions = {}): LoadedState {
    const { store = freshStore(), patchSource = (s: string) => s } = opts;

    const source = patchSource(STATE_SOURCE);
    const compiled = transformSync(source, {
        loader: "ts",
        format: "cjs",
        target: "es2022",
        sourcefile: "state.ts"
    }).code;

    const required: string[] = [];

    const modules: Record<string, unknown> = {
        // Discord-facing, and never reached by hydrate() or persist().
        "@api/MessageUpdater": { updateMessage: () => {} },
        "@webpack/common": {
            ChannelStore: { getChannel: () => undefined },
            MessageStore: { getMessages: () => undefined }
        },
        // The real ones.
        "./core/cache": { TranslationCache },
        "./core/detect": { aggregate, shouldTranslate, splitJoined },
        "./core/hash": { hashContent },
        "./core/modes": { ToggleState, translationEnabled },
        "./core/protect": { protect, restore },
        "./core/requestBookkeeping": { PermanentFailureRegistry },
        "./core/scheduler": { isPermanent, Scheduler },
        // checkDeploymentUrl is called only by validateAppsScriptUrl(), which
        // this file never runs; the entry exists so the import resolves.
        "./core/providers/appsScript": { checkDeploymentUrl: () => ({ ok: false, reason: "stub" }) },
        "./provider": {
            appsScriptProviderFor: () => null,
            currentProvider: () => null,
            warnProviderUnavailable: () => {}
        },
        "./settings": { settings: { store } }
    };

    const require_ = (id: string) => {
        required.push(id);
        if (!(id in modules)) {
            throw new Error(
                `state.ts imported ${JSON.stringify(id)}, which this harness has no stub for. ` +
                "Add one — and check first whether the new import can restore the per-server " +
                "toggle, because that is what this file exists to forbid."
            );
        }
        return modules[id];
    };

    const module_ = { exports: {} as StateModule };
    // eslint-disable-next-line no-new-func
    const run = new Function("require", "module", "exports", "VencordNative", compiled);
    // undefined models a build with no native bridge. Nothing on the paths this
    // file exercises touches it; it is a parameter so a stray read is a clean
    // `undefined` rather than a ReferenceError out of module evaluation.
    run(require_, module_, module_.exports, undefined);

    return { exports: module_.exports, store, required };
}

/** One full session: start, switch `guildId` on, and shut down. */
function sessionThatSwitchedOn(guildId: string): Store {
    const store = freshStore();
    const first = loadState({ store });
    first.exports.hydrate();

    first.exports.toggle.setOn(guildId, true);
    expect(
        first.exports.toggle.isOn(guildId),
        "the fixture never switched the server on — every assertion below would be vacuous"
    ).toBe(true);

    // Everything the plugin does when state changes. If ANY of it writes the
    // toggle to settings, it lands in `store` and the restart below would see it.
    first.exports.persist();
    return store;
}

describe("the harness runs the real module (instrument checks)", () => {
    it("state.ts is on disk and is not empty", () => {
        expect(STATE_SOURCE.length).toBeGreaterThan(1000);
    });

    it("it evaluates state.ts and exposes the exports this file uses", () => {
        const loaded = loadState();
        expect(typeof loaded.exports.hydrate).toBe("function");
        expect(typeof loaded.exports.persist).toBe("function");
        expect(loaded.exports.toggle).toBeInstanceOf(ToggleState);
        // Proof it really required the module graph rather than silently
        // evaluating an empty file.
        expect(loaded.required).toContain("./core/modes");
        expect(loaded.required).toContain("./settings");
    });

    it("an import with no stub is a loud failure, not a silent empty object", () => {
        expect(() => loadState({
            patchSource: src => 'import { nope } from "./not-a-real-module";\n' + src + "\nvoid nope;"
        })).toThrow(/no stub for/);
    });

    it("hydrate() really does read the settings it is given (positive control)", () => {
        // If hydrate() were a no-op under this harness, every "it did not
        // restore the toggle" assertion below would pass for the wrong reason.
        const store = freshStore();
        const cache = new TranslationCache(5000);
        cache.set("hash-1", "en", { text: "hello", sourceLanguage: "fr" } as any);
        store.cacheBlob = cache.serialise();

        const loaded = loadState({ store });
        expect(loaded.exports.cache.get("hash-1", "en"), "the cache was already populated").toBeUndefined();
        loaded.exports.hydrate();
        expect(
            loaded.exports.cache.get("hash-1", "en"),
            "hydrate() read nothing at all — this harness is not exercising it"
        ).toBeDefined();
    });
});

describe("translation is OFF after a restart", () => {
    it("a server switched on in one session is off in the next", () => {
        const carried = sessionThatSwitchedOn("g1");

        // THE RESTART. A brand-new evaluation of the module — new ToggleState,
        // new cache — handed exactly the settings the last session left behind.
        const next = loadState({ store: carried });
        next.exports.hydrate();

        expect(
            next.exports.toggle.isOn("g1"),
            "the previous session's server came back ON — translation resumed without anyone " +
            "asking for it this session"
        ).toBe(false);
    });

    it("it is off before hydrate() as well as after — nothing restores it later", () => {
        const carried = sessionThatSwitchedOn("g1");
        const next = loadState({ store: carried });
        expect(next.exports.toggle.isOn("g1")).toBe(false);
        next.exports.hydrate();
        expect(next.exports.toggle.isOn("g1")).toBe(false);
    });

    it("shutting down writes no record of which servers were on", () => {
        // The other direction. Even if a future hydrate() went looking, there is
        // nothing on disk for it to find.
        const carried = sessionThatSwitchedOn("g1");
        expect(Object.keys(carried)).not.toContain("serverState");
        expect(
            JSON.stringify(carried),
            "a guild id was written into the settings by persist() under some other key"
        ).not.toContain("g1");
    });

    it("a config left over from a build that DID persist it is ignored, not honoured", () => {
        // The upgrade path, which is the case a source scan cannot see at all: the
        // key is still sitting in a real user's settings file today.
        const store = freshStore();
        store.serverState = JSON.stringify(["g1", "g2"]);

        const loaded = loadState({ store });
        loaded.exports.hydrate();

        expect(loaded.exports.toggle.isOn("g1")).toBe(false);
        expect(loaded.exports.toggle.isOn("g2")).toBe(false);
        // …and it is left alone rather than deleted. Removing it is a migration
        // with no user-visible effect; settings.ts records the decision.
        expect(store.serverState).toBe(JSON.stringify(["g1", "g2"]));
    });

    it("the toggle still works WITHIN a session (negative control)", () => {
        // Without this, every assertion above is satisfied by a toggle that can
        // never be switched on at all, which is a far larger defect.
        const loaded = loadState();
        loaded.exports.hydrate();
        loaded.exports.toggle.setOn("g1", true);
        expect(loaded.exports.toggle.isOn("g1")).toBe(true);
        loaded.exports.persist();
        expect(loaded.exports.toggle.isOn("g1"), "persist() cleared the live toggle").toBe(true);
    });

    it("the CACHE still survives the restart (negative control)", () => {
        // The one thing that must NOT have been broken by this change. If the
        // restart above passed because nothing whatsoever crosses it, this fails.
        const store = freshStore();
        const first = loadState({ store });
        first.exports.hydrate();
        first.exports.cache.set("hash-1", "en", { text: "hello", sourceLanguage: "fr" } as any);
        first.exports.persist();

        const next = loadState({ store });
        next.exports.hydrate();
        expect(
            next.exports.cache.get("hash-1", "en"),
            "the translation cache stopped persisting — only the on/off state was meant to"
        ).toBeDefined();
    });

    it("M-REGRESS: restoring the load makes the toggle survive again (mutation control)", () => {
        // The instrument, proved. This puts the deleted line back — verbatim, as
        // it stood in state.ts — and the same restart that is asserted OFF above
        // must now come back ON. If this stops failing over, the assertions above
        // are measuring nothing.
        const restore = (src: string) => src.replace(
            "    cache.loadFrom(settings.store.cacheBlob);\n",
            "    cache.loadFrom(settings.store.cacheBlob);\n    toggle.loadFrom(settings.store.serverState);\n"
        );
        expect(restore(STATE_SOURCE), "the substitution matched nothing")
            .toContain("toggle.loadFrom(settings.store.serverState);");

        const store = freshStore();
        store.serverState = JSON.stringify(["g1"]);

        const patched = loadState({ store, patchSource: restore });
        patched.exports.hydrate();
        expect(
            patched.exports.toggle.isOn("g1"),
            "even with the old line restored the toggle did not come back — this control " +
            "cannot tell the two behaviours apart, so it proves nothing about the real file"
        ).toBe(true);

        // …and the real file, unpatched, does not.
        const real = loadState({ store: { ...freshStore(), serverState: JSON.stringify(["g1"]) } });
        real.exports.hydrate();
        expect(real.exports.toggle.isOn("g1")).toBe(false);
    });
});
