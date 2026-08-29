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

/*
 * THERE IS NO toggleShowsOn() ANY MORE, AND ITS ABSENCE IS THE FIX.
 *
 * WHAT IT DID. It returned false while the state was `unavailable` whatever the
 * user had chosen, so the panel's switch rendered OFF for the whole of a patch
 * outage. It was aimed at a real contradiction — the pill reads "Discord
 * updated" and the footer says translation is paused, and a GREEN switch beside
 * them said the opposite — but it answered that contradiction in the wrong
 * place, and this file's own comment called it "deliberately only cosmetic".
 *
 * THE DEFECT ITS REMOVAL CLOSES IS A LOCKOUT, not a cosmetic one. Three facts
 * met: Panel.tsx also carried `disabled={state === "unavailable"}`; the toggle
 * stopped surviving a start at all (see hydrate() in state.ts, operator ruling
 * "default off shall persist across restart"); and this function forced the
 * switch to read off. A user who started the client while Discord was unpatched
 * therefore had translation off, a switch that read off, and NO WAY TO MOVE IT —
 * the single control that could turn translation on was the control the outage
 * disabled. While the on-state still persisted, a server switched on in an
 * earlier session stayed on and resumed by itself, so the trap only closed when
 * the two changes met.
 *
 * WHY UNLOCKING IT IS CORRECT AND NOT A WORKAROUND. selectionGate() below does
 * NOT consult `patchesOk`; only panelState() does, and only to pick the pill's
 * label. So double-click translation really does work during the outage, for
 * exactly the servers whose toggle is on — which is what
 * UNAVAILABLE_FOOTER.doubleClickWorks already promises, and what index.tsx's
 * 15-second notice promises too. Freezing the switch off blocked the user from
 * enabling the one path that still worked, and from pre-arming the rendered path
 * for the moment the patches match again.
 *
 * SO THE SWITCH IS A PREFERENCE, NOT A STATUS. The pill carries the status and
 * the footer explains it; the switch says what the user WANTS. Once the control
 * is operable a display-only override is the worse bug of the two — a click that
 * switches the server on while the track stays grey is a control lying about its
 * own state, and flip() writes from `isOn`, so the next click would then appear
 * to do nothing at all. The two signals no longer disagree in any case:
 * unavailableFooter() branches on the same toggle the switch now renders, so an
 * ON switch is shown beside "double-click still works" and an OFF switch beside
 * the sentence saying this server is not switched on.
 *
 * Panel.tsx renders `toggle.isOn(guildId)` directly again. Do not reintroduce a
 * display-only wrapper here.
 */

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
 * switched on was told a manual route still worked, tried it, and was refused.
 *
 * DERIVED FROM selectionGate() RATHER THAN FROM toggle.isOn(). The claim the
 * sentence makes is exactly "would the double-click path allow this?", so it is
 * answered by the function that decides it. A second copy of the condition here
 * would be a copy that can disagree with the path it describes — which is the
 * defect being fixed, one layer down. It is also why DMs come out right for free:
 * the gate already reads `includeDMs` for a null guild id.
 *
 * THE OFF WORDING NOW POINTS AT THE SWITCH, AND THAT IS THE SECOND DEFECT FIXED
 * HERE. It used to end "The switch is unavailable until translation works
 * again." — an accurate description of `disabled={state === "unavailable"}` in
 * Panel.tsx, and a lie the moment that attribute was removed; the note above the
 * toggle in this file says why it had to go. It was also the only guidance the
 * panel gave in the one state where the user was locked out, so it told them
 * their situation was unfixable while a working route existed. The wording
 * therefore names the control, says what switching it on buys IMMEDIATELY
 * (double-click, which selectionGate() allows without ever reading
 * `patchesOk`), and says what it buys LATER (the rendered path, as soon as the
 * patches match again). It still promises nothing about the state the user is in
 * at the moment they read it.
 *
 * A pure function over explicit arguments, in core/, for the reason recorded on
 * translationEnabled() above: Panel.tsx imports @webpack/common and cannot be
 * loaded by this suite at all, so core/ is the only layer where the wording can
 * be pinned as BEHAVIOUR — see test/panelUnavailableToggle.test.ts.
 */
export const UNAVAILABLE_FOOTER = {
    doubleClickWorks:
        "Discord changed. Translation is paused; double-click still works.",
    serverOff:
        "Discord changed. Translation is paused and this server is not switched on; " +
        "turn it on with the switch above and double-click will translate straight " +
        "away, with channel translation resuming on its own once Discord is patched."
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
