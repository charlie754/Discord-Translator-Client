/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Mode = "replace" | "bilingual";

export type PanelState = "off" | "translating" | "on" | "degraded" | "unavailable";

export interface PanelContext {
    guildId: string | null;
    patchesOk: boolean;
    breakerOpen: boolean;
    pending: number;
}

/**
 * Per-server, not per-channel (design D4): you join a foreign server, toggle
 * once, and every channel in it follows.
 *
 * A DM has no guild id, so `isOn(null)` is false and `setOn(null, true)` does
 * nothing: the panel toggle cannot reach a DM and never could. That is not the
 * whole DM answer, though — this class deliberately does not know about the
 * `includeDMs` setting, because core/ knows nothing about settings at all.
 * `translationEnabled()` below is the ONLY function that answers "may this
 * conversation be translated?", and it is what every caller must ask.
 */
export class ToggleState {
    private servers = new Set<string>();

    isOn(guildId: string | null): boolean {
        if (guildId === null) return false;
        return this.servers.has(guildId);
    }

    setOn(guildId: string | null, on: boolean): void {
        if (guildId === null) return;
        if (on) this.servers.add(guildId);
        else this.servers.delete(guildId);
    }

    panelState(ctx: PanelContext): PanelState {
        if (!ctx.patchesOk) return "unavailable";
        if (!this.isOn(ctx.guildId)) return "off";
        if (ctx.breakerOpen) return "degraded";
        if (ctx.pending > 0) return "translating";
        return "on";
    }

    serialise(): string {
        return JSON.stringify([...this.servers]);
    }

    static deserialise(json: string): ToggleState {
        const state = new ToggleState();
        try {
            const parsed = JSON.parse(json);
            if (Array.isArray(parsed)) {
                for (const id of parsed) if (typeof id === "string") state.servers.add(id);
            }
        } catch {
            // Corrupt state is not an error — start with everything off.
        }
        return state;
    }

    /**
     * Forget every server, leaving the object as newly constructed.
     *
     * THE DEFECT THIS CLOSES. state.ts's hydrate() stopped RESTORING the toggle,
     * but "stopped restoring" is not "starts empty": this object is a module-level
     * singleton, so it outlives a start()/stop() pair. Calling stopPlugin() and
     * then startPlugin() on the already-loaded plugin — which the plugin list does,
     * and which never reloads the module — left the previous run's switched-on
     * servers switched on, and translation resumed on a server the user had not
     * enabled since the plugin was turned back on. Only a whole-client restart
     * genuinely emptied it, so "OFF at every start" was true of one of the two
     * routes into start().
     *
     * hydrate() calls this, which makes being ON a per-START decision by every
     * route rather than a per-PROCESS one.
     */
    clear(): void {
        this.servers.clear();
    }

    /** Repopulate from persisted JSON. Used to hydrate after plugin start. */
    loadFrom(json: string): void {
        this.servers.clear();
        const revived = ToggleState.deserialise(json);
        for (const id of revived.serverIds()) this.servers.add(id);
    }

    /** Internal: exposes stored ids for loadFrom. */
    serverIds(): IterableIterator<string> {
        return this.servers.values();
    }
}

/**
 * WHAT THE PANEL'S SWITCH SHOWS — which is not always what the user chose.
 *
 * THE DEFECT THIS CLOSES. In the `unavailable` state the panel says three
 * things at once, and one of them used to be a lie: the pill reads "Discord
 * updated", the footer reads "Discord changed. Translation is paused;
 * double-click still works." — and the switch stayed GREEN and
 * `aria-checked="true"`, because it rendered `toggle.isOn(guildId)` directly.
 * Nothing is being translated in that state; `.track[aria-checked="true"]` is
 * the only thing that paints the track with the accent colour and slides the
 * thumb across (panel/styles.ts), so the one control on the panel was
 * announcing "on" to sighted users and to a screen reader while the two
 * sentences beside it said translation had stopped.
 *
 * COSMETIC, AND DELIBERATELY ONLY COSMETIC. This does NOT clear the toggle and
 * must never be made to. The session's choice outlives the outage, so when
 * Discord is patched and `patchesOk()` goes true again the user's servers come
 * back on by themselves, in the same sitting, with nothing to re-do. A "fix"
 * that called `setOn(guildId, false)` here would make a transient outage
 * silently forget every server the user had enabled — a far worse defect than
 * the one being fixed, and invisible until the outage ended. `toggle` is taken
 * by value and only read; nothing in this function can write to it.
 *
 * (The choice is per START, not per install: state.ts's hydrate() clears the
 * toggle — see clear() above — so nothing carries across a restart OR across a
 * stop/start of the plugin on its own. That is a separate decision and this
 * function is indifferent to it: it never touches storage or the toggle either
 * way, which is why the outage above can be survived while a start cannot.)
 *
 * A pure function over explicit arguments, in core/, for the reason recorded on
 * translationEnabled() above: Panel.tsx imports @webpack/common and cannot be
 * loaded by this suite at all, so core/ is the only layer where the decision can
 * be pinned as BEHAVIOUR rather than as a string search over JSX — see
 * test/modes.test.ts.
 */
export function toggleShowsOn(
    toggle: ToggleState,
    guildId: string | null,
    state: PanelState
): boolean {
    if (state === "unavailable") return false;
    return toggle.isOn(guildId);
}

/**
 * THE ONE ANSWER TO "MAY THIS CONVERSATION BE TRANSLATED?" — for the rendered
 * mainline and for the double-click selection popover alike.
 *
 * Two decisions, deliberately kept apart:
 *
 *   - A SERVER is governed by the panel toggle, per guild.
 *   - A DM is governed by the `includeDMs` setting and by nothing else. It has
 *     no guild id, so `ToggleState` cannot reach it.
 *
 * WHAT THIS CLOSES. `includeDMs` used to be read by nothing whatsoever: the
 * mainline hard-blocked DMs through `toggle.isOn(null)` and the selection path
 * asked no question at all. So a control describing a privacy decision governed
 * nothing in either direction, while index.tsx's first-run notice promised
 * "Direct messages are excluded unless you opt in" and PRIVACY.md described the
 * setting as working. Both statements are true only once something reads it.
 *
 * `includeDMs !== true` rather than `!includeDMs` on purpose. A settings store
 * read before hydration yields `undefined`, and `undefined` must mean OFF.
 * Failing closed here is the difference between a missing default and someone's
 * private message arriving at a third party.
 *
 * A pure function over explicit arguments, in core/, because that is the only
 * layer this suite can import and therefore the only layer where this decision
 * can be behaviour-tested at all — see test/modes.test.ts.
 */
export function translationEnabled(
    toggle: ToggleState,
    guildId: string | null,
    includeDMs: boolean | undefined
): boolean {
    if (guildId === null) return includeDMs === true;
    return toggle.isOn(guildId);
}

/**
 * What the selection popover says when it refuses. Exported so the refusal is
 * asserted against one string rather than a copy pasted into a test.
 *
 * A refusal SPEAKS rather than returning quietly. A double-click that silently
 * does nothing is indistinguishable from a broken plugin, and the user would
 * reasonably try again — which is the state the previous code left them in for
 * every other failure it had a message for.
 */
export const SELECTION_REFUSAL = {
    unknownChannel:
        "Not translated: this text could not be traced to a conversation, so " +
        "there is no way to tell whether you allowed it.",
    directMessage:
        "Not translated: this is a direct message. Turn on \"Also translate " +
        "direct messages\" in the plugin settings to allow it.",
    serverOff:
        "Not translated: translation is off for this server. Turn it on from " +
        "the translator panel."
} as const;

export type SelectionGate =
    | { allowed: true; }
    | { allowed: false; reason: string; };

/**
 * The privacy gate for the double-click / triple-click path.
 *
 * THE HOLE THIS CLOSES. `translateSelection()` checked only that the selection
 * was non-empty and that the click landed inside message content, then sent the
 * text. It consulted neither the per-server toggle nor anything about DMs, so a
 * double-click inside a private message — or inside a server the user had
 * deliberately switched OFF — shipped that text to the provider, billed on the
 * paid ones. The rendered path had guarded both since it was written; this one
 * never had.
 *
 * `channel === null` means the click could not be traced to a message row. That
 * is not "no guild" — it is "we do not know", and it fails closed, because a
 * `null` guild id and an unknown conversation must not collapse into the same
 * answer.
 *
 * The allow/deny decision itself is `translationEnabled()` and only that; this
 * function chooses the wording. One implementation, so a change to the decision
 * cannot leave the two paths disagreeing.
 */
export function selectionGate(
    toggle: ToggleState,
    channel: { guildId: string | null; } | null,
    includeDMs: boolean | undefined
): SelectionGate {
    if (!channel) return { allowed: false, reason: SELECTION_REFUSAL.unknownChannel };
    if (translationEnabled(toggle, channel.guildId, includeDMs)) return { allowed: true };
    return {
        allowed: false,
        reason: channel.guildId === null
            ? SELECTION_REFUSAL.directMessage
            : SELECTION_REFUSAL.serverOff
    };
}

/**
 * THE PANEL'S FOOTER IN THE `unavailable` STATE, WHICH IS NOT ONE SENTENCE.
 *
 * THE DEFECT THIS CLOSES. The footer rendered one fixed line — "Discord changed.
 * Translation is paused; double-click still works." — for every user in that
 * state. The second half is a promise about the double-click path, and that path
 * is governed by selectionGate(), which refuses with SELECTION_REFUSAL.serverOff
 * whenever the per-server toggle is off. So a user whose server was never
 * switched on was told a manual route still worked, tried it, and was refused —
 * and could not repair it either, because Panel.tsx disables the switch while the
 * state is `unavailable`. The panel named the one control that would have fixed
 * it and then withheld it.
 *
 * DERIVED FROM selectionGate() RATHER THAN FROM toggle.isOn(). The claim the
 * sentence makes is exactly "would the double-click path allow this?", so it is
 * answered by the function that decides it. A second copy of the condition here
 * would be a copy that can disagree with the path it describes — which is the
 * defect being fixed, one layer down. It is also why DMs come out right for free:
 * the gate already reads `includeDMs` for a null guild id.
 *
 * THE OFF WORDING PROMISES NOTHING. It says what is true (paused, and this server
 * was never switched on) and then says the switch is unavailable, rather than
 * pointing at a control that will refuse. Telling the user to "turn it on from
 * the panel" here would be the same lie in a new place.
 *
 * A pure function over explicit arguments, in core/, for the reason recorded on
 * toggleShowsOn() above: Panel.tsx imports @webpack/common and cannot be loaded
 * by this suite at all, so core/ is the only layer where the wording can be
 * pinned as BEHAVIOUR — see test/panelUnavailableToggle.test.ts.
 */
export const UNAVAILABLE_FOOTER = {
    doubleClickWorks:
        "Discord changed. Translation is paused; double-click still works.",
    serverOff:
        "Discord changed. Translation is paused, and this server was not switched on, " +
        "so double-click will not translate it either. The switch is unavailable until " +
        "translation works again."
} as const;

export function unavailableFooter(
    toggle: ToggleState,
    guildId: string | null,
    includeDMs: boolean | undefined
): string {
    return selectionGate(toggle, { guildId }, includeDMs).allowed
        ? UNAVAILABLE_FOOTER.doubleClickWorks
        : UNAVAILABLE_FOOTER.serverOff;
}

export interface SelectionContext {
    /**
     * The conversation the click landed in, or null when it could not be traced
     * to one at all. Null is "we do not know", which is NOT the same as a DM's
     * null guild id, and must not be collapsed into it.
     */
    channel: { guildId: string | null; } | null;
    includeDMs: boolean | undefined;
    /**
     * The message's original text, when the click is on a translation of ours
     * and that original is still held locally. Null when it is not recoverable.
     */
    heldOriginal: string | null;
    /**
     * The recorded source language, for the case where the visible text is a
     * translation but the original is gone and a request is the only way back.
     */
    reverseTo: string | null;
    /** Where a plain forward translation of the selection would go. */
    targetLanguage: string;
}

export type SelectionAction =
    | { kind: "showHeldOriginal"; text: string; }
    | { kind: "refuse"; reason: string; }
    | { kind: "translate"; to: string; };

/**
 * Everything the double-click path decides, as one pure function, in the order
 * it must decide it. The DOM work — which message was clicked, what the store
 * still holds — stays in selection.ts; the JUDGEMENT is here, because this is
 * the only layer the test suite can import and therefore the only layer where
 * these two properties can be asserted as behaviour rather than as a string
 * search over source:
 *
 *   1. A RECOVERABLE ORIGINAL IS NEVER A REQUEST. render.tsx tells the user to
 *      double-click to see the original, and that used to buy an approximation
 *      of text we already had, from a billed provider. `showHeldOriginal` is
 *      ordered first so no later branch can turn it into a charge. It needs no
 *      gate of its own: nothing leaves the client on that branch.
 *
 *   2. NOTHING ELSE HAPPENS WITHOUT THE GATE. `reverseTo` is a language, not a
 *      permission — it must not carry the request past selectionGate(), which
 *      is why it is consulted only after the gate has already allowed.
 */
export function selectionAction(
    toggle: ToggleState,
    ctx: SelectionContext
): SelectionAction {
    if (ctx.heldOriginal !== null) {
        return { kind: "showHeldOriginal", text: ctx.heldOriginal };
    }

    const gate = selectionGate(toggle, ctx.channel, ctx.includeDMs);
    if (!gate.allowed) return { kind: "refuse", reason: gate.reason };

    return { kind: "translate", to: ctx.reverseTo ?? ctx.targetLanguage };
}
