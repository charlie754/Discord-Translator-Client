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
 * conversation be translated AUTOMATICALLY?", and it is what every rendering
 * caller must ask.
 *
 * A DELIBERATE double-click or triple-click is a DIFFERENT question with a
 * different answer: selectionGate() asks neither this class nor `includeDMs`.
 * Operator ruling 2026-09-11 — "make double-click/triple-click translation
 * available whether translate toggle is off" and, asked directly whether DMs
 * were in scope, "Yes - always translate". Do not collapse the two back into
 * one function; the note on selectionGate() says what each now governs.
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
 * label. So double-click translation really does work during the outage — and
 * since the 2026-09-11 ruling it works for every identified conversation rather
 * than only for the servers whose toggle is on, which is what
 * UNAVAILABLE_FOOTER promises and what index.tsx's 15-second notice promises
 * too. Freezing the switch off blocked the user from pre-arming the rendered
 * path for the moment the patches match again.
 *
 * SO THE SWITCH IS A PREFERENCE, NOT A STATUS. The pill carries the status and
 * the footer explains it; the switch says what the user WANTS. Once the control
 * is operable a display-only override is the worse bug of the two — a click that
 * switches the server on while the track stays grey is a control lying about its
 * own state, and flip() writes from `isOn`, so the next click would then appear
 * to do nothing at all. The two signals cannot disagree any more, and for a
 * simpler reason than the one that used to hold: UNAVAILABLE_FOOTER is a single
 * sentence whose promise does not depend on the toggle at all, so there is no
 * branch left that could fall out of step with the track.
 *
 * Panel.tsx renders `toggle.isOn(guildId)` directly again. Do not reintroduce a
 * display-only wrapper here.
 */

/**
 * THE ONE ANSWER TO "MAY THIS CONVERSATION BE TRANSLATED AUTOMATICALLY?" — for
 * the rendered mainline and for the scrollback batcher behind it. It is NOT the
 * answer for the double-click path any more; selectionGate() below is.
 *
 * Two decisions, deliberately kept apart:
 *
 *   - A SERVER is governed by the panel toggle, per guild.
 *   - A DM is governed by the `includeDMs` setting and by nothing else. It has
 *     no guild id, so `ToggleState` cannot reach it.
 *
 * 🔴 WIDENING THIS FUNCTION IS NOT A WAY TO WIDEN THE DOUBLE-CLICK PATH, AND
 * THE 2026-09-11 RULING IS NOT AN INSTRUCTION TO TOUCH IT. It has four callers
 * and three of them start traffic on a keystroke the user never made:
 *
 *   - render.tsx transformMessage() — Replace mode, every message rendered
 *   - render.tsx wrapContent()      — Both Language mode, every message rendered
 *   - state.ts repaintChannel()     — a whole channel's loaded scrollback at once
 *   - selection.ts isRenderedTranslated() — "is the visible text already one of
 *     OURS?", which the REVERSE path needs in order to know whether there is an
 *     original to go back to. That question genuinely depends on automatic
 *     translation being on: with it off the text on screen IS the original, and
 *     reversing there would translate a language into itself.
 *
 * Making this return true more often re-enables AUTOMATIC channel translation
 * for every server and every DM, which is the exact opposite of the decision
 * that turned it off. The gate below is the only thing the ruling moved.
 *
 * WHAT THIS CLOSES. `includeDMs` used to be read by nothing whatsoever: the
 * mainline hard-blocked DMs through `toggle.isOn(null)` and the selection path
 * asked no question at all. So a control describing a privacy decision governed
 * nothing in either direction, while index.tsx's first-run notice promised
 * "Direct messages are excluded unless you opt in" and PRIVACY.md described the
 * setting as working. Both statements are true only once something reads it.
 * It is read for real now — and both of those sentences have since been
 * rewritten a second time, because what it governs is AUTOMATIC translation and
 * not a gesture the user makes on one message.
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
 *
 * THERE IS NO `serverOff` AND NO `directMessage` ANY MORE, AND THEIR ABSENCE IS
 * THE 2026-09-11 CHANGE.
 *
 * `serverOff` read "Not translated: translation is off for this server. Turn it
 * on from the translator panel." and `directMessage` read "Not translated: this
 * is a direct message. Turn on Also translate direct messages in the plugin
 * settings to allow it." Each named a permission the double-click path no longer
 * asks for, so each became unreachable — and an unreachable refusal constant is
 * an invitation to wire it back up, which is why `serverState` and
 * toggleShowsOn() were deleted rather than left unused as well. The wording is
 * recorded here because it is the evidence of what the gate used to refuse.
 *
 * THE RULING. "Make double-click/triple-click translation available whether
 * translate toggle is off", and, asked directly whether DMs were in scope,
 * "Yes - always translate". A deliberate gesture on text the user is already
 * looking at is a different act from switching a whole conversation on, and it
 * is the user who performs it.
 */
export const SELECTION_REFUSAL = {
    unknownChannel:
        "Not translated: this text could not be traced to a conversation, so " +
        "there is no way to tell whether you allowed it."
} as const;

export type SelectionGate =
    | { allowed: true; }
    | { allowed: false; reason: string; };

/**
 * THE GATE FOR THE DOUBLE-CLICK / TRIPLE-CLICK PATH, WHICH NOW ASKS EXACTLY ONE
 * QUESTION: CAN THIS TEXT BE TRACED TO A CONVERSATION AT ALL?
 *
 * Operator ruling 2026-09-11. A deliberate double-click or triple-click
 * translates the selection in any conversation the plugin can identify —
 * whatever the per-server panel toggle says, and whatever `includeDMs` says.
 * Both gestures arrive here through selectionAction() and nowhere else, because
 * a triple-click fires `dblclick` on its second click and `click` with
 * `detail === 3` on its third; one change here therefore covers both, and a
 * separate triple-click gate would be a second copy of this decision.
 *
 * WHY `unknownChannel` SURVIVES WHEN THE OTHER TWO DID NOT. The two that went
 * answered "did the user permit this conversation?", which is the question the
 * ruling settles. This one answers "WHICH conversation is this?", and that is not
 * the same question. `channel === null` means the click could not be traced to a
 * message row at all: a search result, a pinned popout, a surface this plugin
 * does not recognise. That is not "no guild" — it is "we do not know", and
 * without an answer there is nothing true the plugin can say about the text, so
 * it still fails closed. A `null` guild id and an unknown conversation must never
 * collapse into one answer.
 *
 * 🔴 `toggle` AND `includeDMs` ARE STILL TAKEN AND ARE DELIBERATELY NOT READ.
 * They are not left-overs. Keeping them is the only way the ruling can be stated
 * as a TEST rather than as this comment: "the answer does not change when the
 * toggle flips, or when the DM setting flips" cannot be asserted against a
 * function that cannot be handed either one, and test/modes.test.ts sweeps both
 * across every combination for exactly that reason. They are also still the
 * user's real values, threaded from selection.ts, so a later condition cannot be
 * wired to a literal by accident. Until there is such a condition, reading either
 * one in this body re-closes the path the ruling opened.
 *
 * THE AUTOMATIC PATH IS UNTOUCHED, AND THAT SEPARATION IS THE WHOLE CHANGE.
 * translationEnabled() above still governs rendering and the scrollback batcher,
 * and still refuses a switched-off server and an opted-out DM. This function no
 * longer calls it.
 */
export function selectionGate(
    toggle: ToggleState,
    channel: { guildId: string | null; } | null,
    includeDMs: boolean | undefined
): SelectionGate {
    if (!channel) return { allowed: false, reason: SELECTION_REFUSAL.unknownChannel };
    return { allowed: true };
}

/**
 * THE PANEL'S FOOTER IN THE `unavailable` STATE, WHICH IS ONE SENTENCE AGAIN.
 *
 * 🔴 READ THIS BEFORE "FIXING" IT BACK, BECAUSE THIS EXACT SENTENCE WAS ONCE THE
 * DEFECT HERE. The footer used to render "Discord changed. Translation is
 * paused; double-click still works." for every user in that state, while
 * selectionGate() refused with SELECTION_REFUSAL.serverOff whenever the
 * per-server toggle was off. A user whose server had never been switched on was
 * told a manual route still worked, tried it, and was refused. The fix was a
 * second sentence for that case, chosen by asking the gate rather than by
 * re-deciding.
 *
 * THE SENTENCE IS TRUE NOW, FOR A REASON THAT DID NOT EXIST THEN. Since the
 * 2026-09-11 ruling the gate's only refusal is `unknownChannel`, and the panel
 * cannot produce that case: it returns null before rendering when there is no
 * guild id, so the channel it would hand the gate is an object literal and never
 * null. There is no input the panel can supply for which the double-click path
 * refuses, so there is nothing left to branch on — and a branch would now be the
 * opposite lie, withholding a route that works.
 *
 * SO THE CONDITION TO RE-READ IS THE GATE, NEVER THIS STRING. If selectionGate()
 * grows a refusal a server channel can reach, this sentence starts over-promising
 * exactly as it did the first time, and the two-branch form — derived FROM the
 * gate, never from a second copy of its condition — is what it has to go back
 * to. test/panelUnavailableToggle.test.ts pins the premise it rests on: the gate
 * allows every identified conversation, whatever the toggle and the DM setting
 * say.
 *
 * A PLAIN CONSTANT, AND unavailableFooter() IS DELETED. A function taking three
 * parameters, reading none of them and having one possible return value is dead
 * machinery that reads like a live choice. It also made Panel.tsx a reader of the
 * `includeDMs` setting, which put the panel inside an exact-membership privacy
 * guard over the paths that transmit text — a guard it has no business being in
 * now that it has no decision to make. See test/selectionPrivacy.test.ts. (That
 * guard is a whole-file substring scan, so the `settings.store` expression is
 * deliberately not spelled out in this comment or in Panel.tsx's: naming it would
 * make either file register as a reader.)
 *
 * The wording stays in core/ for the reason recorded on translationEnabled():
 * Panel.tsx imports @webpack/common and cannot be loaded by this suite at all,
 * so core/ is the only layer where the copy can be asserted at all.
 */
export const UNAVAILABLE_FOOTER =
    "Discord changed. Translation is paused; double-click still works.";

export interface SelectionContext {
    /**
     * The conversation the click landed in, or null when it could not be traced
     * to one at all. Null is "we do not know", which is NOT the same as a DM's
     * null guild id, and must not be collapsed into it.
     */
    channel: { guildId: string | null; } | null;
    /**
     * The user's DM opt-in, passed on to selectionGate(), which since the
     * 2026-09-11 ruling does not read it. It is threaded anyway: it is what makes
     * "the DM setting does not change this answer" assertable as behaviour, and it
     * keeps the real setting wired here rather than a literal a later condition
     * could be attached to by mistake. Where it DOES decide something is
     * translationEnabled(), i.e. automatic translation.
     */
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
