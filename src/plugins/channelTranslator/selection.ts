/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageStore } from "@webpack/common";

import { selectionAction, translationEnabled } from "./core/modes";
import { protect, restore } from "./core/protect";
import { ClickBurstGate } from "./core/requestBookkeeping";
import { settings } from "./settings";
import { entryForMessage, guildIdOf, scheduler, toggle, translationProvider } from "./state";

const POPOVER_ID = "channel-translator-popover";

/**
 * One gesture, one translation.
 *
 * A triple-click fires `dblclick` on the second click and `click` with
 * `detail === 3` on the third, and both handlers below translate — so the
 * gesture the UI recommends for grabbing a whole line issued TWO requests and
 * threw the first answer away. The rule and the reason live in
 * core/requestBookkeeping.ts, where they are unit-tested; this file only routes
 * the two handlers through it.
 *
 * Module-level, like the request path itself: the burst spans two separate
 * events, so a gate constructed per event would be a gate of one.
 */
const clickBurst = new ClickBurstGate();

// There is deliberately no HttpTransport and no currentProvider() call in this
// file. Both used to live here, duplicated from state.ts, and the duplicate was
// the bug: this path resolved its own provider, so it silently disagreed with
// the rendered path about which endpoint and which credential were in use.
//
// state.ts's translationProvider() is now the only way to obtain a provider.
// Getting this wrong again would mean re-adding an import that
// test/providerChokepoint.test.ts fails on.

interface MessageRef {
    channelId: string;
    messageId: string;
}

/**
 * Which message the click landed on, from Discord's own row id.
 *
 * Extracted so the privacy gate and the reverse path read the SAME id from the
 * SAME element. When this returns null the conversation is unknown — a search
 * result, a pinned popout, a fragment outside any row — and every caller must
 * treat that as a refusal, never as "no guild".
 */
function messageRefFor(target: HTMLElement | null): MessageRef | null {
    const row = target?.closest('[id^="chat-messages-"]');
    if (!row) return null;

    // id shape: chat-messages-<channelId>-<messageId>
    const parts = row.id.split("-");
    const channelId = parts[2];
    const messageId = parts[3];
    if (!channelId || !messageId) return null;

    return { channelId, messageId };
}

/**
 * Is the text under the cursor currently a TRANSLATION rather than the original?
 * A cache entry alone is not enough: with translation switched off the user is
 * reading the original, and reversing there translates a language into itself.
 */
function isRenderedTranslated(target: HTMLElement | null, ref: MessageRef): boolean {
    // Case 1: the lower row in Both Language mode is always the translation.
    if (target?.closest(".ct-translated-row")) return true;

    // Case 2: in replace mode with translation enabled for this conversation,
    // the visible text IS the translation. Asked through translationEnabled()
    // rather than toggle.isOn() so a DM the user opted into is included here
    // too — otherwise opting in would silently disable the reverse path.
    return (
        settings.store.mode === "replace" &&
        translationEnabled(toggle, guildIdOf(ref.channelId), settings.store.includeDMs)
    );
}

/**
 * The language to translate BACK into, for the case where the original can no
 * longer be recovered locally and a real request is the only way to show
 * something. See originalFor() first — this is the fallback, not the path.
 */
function reverseTargetFor(target: HTMLElement | null): string | null {
    const ref = messageRefFor(target);
    if (!ref) return null;

    const entry = entryForMessage(ref.messageId);
    if (!entry?.sourceLang) return null;
    if (entry.sourceLang === settings.store.targetLanguage) return null;

    if (!isRenderedTranslated(target, ref)) return null;

    return entry.sourceLang;
}

/**
 * The original text of a message that is currently displayed translated — taken
 * from what we already hold, at no cost.
 *
 * WHERE IT COMES FROM: Discord's own MessageStore. render.tsx's Mode A hands
 * the renderer a prototype-preserving CLONE carrying the translated content and
 * never writes to the store, so `MessageStore.getMessage()` still returns the
 * message as it arrived. The original was never destroyed; it was simply never
 * asked for.
 *
 * WHAT THIS FIXES: render.tsx renders `double-click to see the original`, and
 * following that instruction landed here and issued a BILLED reverse round-trip
 * to a paid provider to reconstruct text sitting in memory — an approximation,
 * charged for, of something we had exactly. index.tsx advertises the same
 * double-click in its patch-failure notice.
 *
 * Returns null rather than guessing whenever the answer is not certain, which
 * leaves translateSelection() to fall through to a real request. That fallback
 * is reachable — a message evicted from the store has no entry here — so it is
 * kept rather than deleted.
 */
function originalFor(target: HTMLElement | null): string | null {
    const ref = messageRefFor(target);
    if (!ref) return null;

    // No translation on record means nothing on screen is a translation of ours,
    // so there is no "original" to go back to.
    const entry = entryForMessage(ref.messageId);
    if (!entry) return null;
    if (!isRenderedTranslated(target, ref)) return null;

    // getMessage is typed as always returning a Message. It does not: a message
    // Discord has evicted from the channel's cache yields undefined, and that is
    // exactly the case this function must decline rather than crash on.
    const stored: { content?: string; } | undefined =
        MessageStore.getMessage(ref.channelId, ref.messageId);

    const original = stored?.content;
    if (typeof original !== "string" || original.trim().length === 0) return null;

    // The stored text and the rendered text being identical means the visible
    // text is already the original — showing it back would be a popover that
    // repeats what the user is looking at.
    if (original.trim() === entry.text.trim()) return null;

    return original;
}

/**
 * @param holdForBurst Wait out the rest of the click burst before spending
 * anything. True for a double-click, which may turn out to be the middle of a
 * triple-click; false for the third click, which is already the last of its
 * gesture and has just superseded whatever the double-click was holding.
 */
async function translateSelection(event: MouseEvent, holdForBurst: boolean): Promise<void> {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    // Only act inside message content, never in the composer or the sidebar.
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[id^="chat-messages-"], [class*="messageContent"]')) return;

    // Every branch below this line puts something on screen, and none of them is
    // the answer to the PREVIOUS gesture any more. beginPopover() carries the
    // whole reason a popover needs an identity at all.
    const popover = beginPopover();

    // THE GATE AND THE FREE PATH, both decided in one place.
    //
    // Everything past a "translate" verdict sends the selected text to a third
    // party, so what this path still asks — and what it deliberately stopped
    // asking — both matter.
    //
    // IT NO LONGER ASKS PERMISSION PER CONVERSATION. Operator ruling 2026-09-11:
    // a deliberate double-click or triple-click translates the selection in any
    // conversation the plugin can identify, whatever the per-server toggle says
    // and whatever `includeDMs` says. What it DOES still ask is whether the click
    // can be traced to a conversation at all; an untraceable one is refused,
    // because nothing true can be said about text of unknown origin. The two
    // refusals that went, and why, are recorded on selectionGate() in
    // core/modes.ts.
    //
    // THE AUTOMATIC PATH IS UNCHANGED, and it is a different question with a
    // different answer: translationEnabled(), asked by render.tsx, by state.ts's
    // repaintChannel(), and by isRenderedTranslated() above — which is why
    // settings.store.includeDMs is still read in this file.
    //
    // The judgement — including the rule that a recoverable original is served
    // locally and never becomes a request — is core/modes.ts's selectionAction()
    // and is unit-tested there. This function only collects the facts and obeys.
    const ref = messageRefFor(target);
    const action = selectionAction(toggle, {
        channel: ref ? { guildId: guildIdOf(ref.channelId) } : null,
        includeDMs: settings.store.includeDMs,
        heldOriginal: originalFor(target),
        reverseTo: reverseTargetFor(target),
        targetLanguage: settings.store.targetLanguage
    });

    if (action.kind === "showHeldOriginal") {
        showPopover(popover, event.clientX, event.clientY, action.text);
        return;
    }
    if (action.kind === "refuse") {
        showPopover(popover, event.clientX, event.clientY, action.reason);
        return;
    }

    // PAST THIS LINE A REQUEST GOES OUT, so this is where a double-click that is
    // really the first half of a triple-click has to stop. Deliberately below the
    // branches above — showing a held original or a refusal is answered locally,
    // sends nothing, and must not be delayed — and above the "…" popover, so a
    // superseded click leaves no trace on screen for the click that replaced it
    // to fight with.
    if (holdForBurst && !(await clickBurst.settle())) return;

    // THE HOLD IS A WINDOW THIS GESTURE SPENDS WITH NOTHING ON SCREEN, and that is
    // what made muting the paint insufficient.
    //
    // beginPopover() took this gesture's token above, but its FIRST showPopover()
    // is the line below, and the mousedown listener that dismisses a popover is
    // registered inside showPopover() — so for the whole of CLICK_BURST_MS this
    // gesture holds a token with no popover and no listener of its own. A popover
    // from an EARLIER gesture can still be on screen with a live listener, and
    // clicking it runs THAT gesture's dismiss(), which calls invalidatePopover()
    // and moves the generation past this one. The hold then resolves TRUE — the
    // burst gate's epoch is untouched, because no later click superseded this one —
    // so without this check the gesture walked on and sent the selection, and only
    // its paint was dropped: the user clicked away, their text went to the
    // provider, and nothing was ever shown. A silent send, and a worse outcome than
    // the resurrected popover the generation counter was added to stop.
    //
    // SO A STALE GENERATION ABORTS THE GESTURE, not merely its render. This is the
    // same question showPopover() asks, asked one step earlier — the last point
    // where the answer can still prevent a request rather than discard one.
    //
    // Unconditional rather than inside the holdForBurst branch. The third click
    // reaches here with no await behind it and cannot be stale today; making the
    // check depend on that staying true is how the next await reopens the hole.
    if (!popoverIsCurrent(popover)) return;

    showPopover(popover, event.clientX, event.clientY, "…");

    // The popover is already open showing "…", so an unusable provider has to
    // replace it with the reason rather than leaving that ellipsis on screen.
    const resolved = translationProvider();
    if (!resolved.ok) {
        showPopover(popover, event.clientX, event.clientY, resolved.reason);
        return;
    }
    const { provider } = resolved;

    try {
        // Always sl=auto. Asserting the source is an assumption we cannot
        // guarantee — the selection may be the original row, a mixed-language
        // fragment, or a region-subtagged code the endpoint rejects. The
        // DESTINATION was decided by selectionAction() above, on the far side of
        // the gate: a reverse target is a language, never a permission.
        const translated = await scheduler.run(async () => {
            // THE OTHER WAIT BETWEEN THE GATE AND THE SEND, and it is two waits in
            // one place. scheduler.run() parks until one of three concurrency slots
            // frees up — the rendered path can be holding all three while a channel
            // repaints — and a transient failure sleeps its backoff and then runs
            // this callback AGAIN. The user can dismiss during either, and until
            // this line both still went out: the retry PRIVACY.md counts as one of
            // four attempts was issued for a gesture nobody was waiting for.
            //
            // null RATHER THAN A THROW. An exception here would be indistinguishable
            // from a network failure — retried, counted toward the circuit breaker,
            // and finally painted as "Translation unavailable" for a gesture the
            // user themselves ended. An abandoned attempt is not a provider fault.
            if (!popoverIsCurrent(popover)) return null;
            const { masked, tokens } = protect(text);
            const [result] = await provider.translate([masked], "auto", action.to);
            return restore(result.text, tokens);
        });
        // Nothing was sent and nothing is owed an answer: the gesture was
        // abandoned before its attempt left, so the popover the user dismissed
        // stays dismissed.
        if (translated === null) return;
        showPopover(popover, event.clientX, event.clientY, translated);
    } catch {
        // One message for every failure, because after the spend cap was removed
        // there is no longer a class of refusal that comes from the user's own
        // settings rather than from the network. The cap used to be special here:
        // "Translation unavailable" for a limit the user had themselves set would
        // send them to debug the provider instead of the setting. Nothing left
        // reaching this line has that shape — a missing deployment URL is caught
        // by the !resolved.ok branch above, with its own wording.
        showPopover(popover, event.clientX, event.clientY, "Translation unavailable");
    }
}

/**
 * A FORGED CLICK IS NOT A GESTURE, AND SINCE 2026-09-11 THE GESTURE IS THE ONLY
 * PERMISSION LEFT.
 *
 * `isTrusted` is false for every event a script created — `new
 * MouseEvent("dblclick")`, `el.click()`, anything handed to
 * `dispatchEvent()` — and true only for one the user physically performed. It
 * is read-only in the DOM standard, so page script cannot forge a true.
 *
 * WHAT THIS CLOSES, AND WHY IT WAS NOT URGENT UNTIL NOW. This path used to ask
 * the per-server toggle and the DM opt-in as well, so a synthetic click still had
 * to get past two decisions the user had made; both were taken out of the gate by
 * the 2026-09-11 ruling, and the justification for taking them out — written on
 * selectionGate() in core/modes.ts and in PRIVACY.md — is that a double-click or
 * triple-click is a DELIBERATE USER ACTION. An untrusted event is by definition
 * not one. Without this line that justification is false: anything else running
 * in the page could select text in a direct message, dispatch a dblclick, and
 * send it to a third party with nobody having clicked and nothing left to refuse
 * it. A reproduction did exactly that with both privacy toggles off.
 *
 * IT IS THE FIRST STATEMENT IN BOTH HANDLERS, above the burst gate and above
 * every read of the selection, because everything below it either transmits the
 * selection or paints on screen on the strength of a user action. In
 * onTripleClick() that ordering does a second job of its own — see there.
 */
function onDoubleClick(event: MouseEvent): void {
    if (!event.isTrusted) return;
    // May be the middle of a triple-click, so it holds before it spends.
    void translateSelection(event, true);
}

/**
 * Triple-click does not re-fire dblclick — the browser fires click with
 * detail === 3 and expands the selection from a word to the whole block.
 * Without this, a triple-click would translate only the word the preceding
 * double-click selected.
 *
 * It also means the dblclick handler has ALREADY run for this one gesture and
 * may have a request held. supersede() runs first and synchronously, inside the
 * event handler, so it cannot lose the race to a waiter waking up: the held
 * double-click drops itself, and the whole gesture costs one translation — this
 * one, which carries the whole block rather than a single word.
 */
function onTripleClick(event: MouseEvent): void {
    // Same refusal as onDoubleClick above, same reason, and here it must also come
    // before supersede(): that call drops whatever the real double-click is
    // holding, so a guard placed after it would let a synthetic third click cancel
    // a translation the user genuinely asked for, even though the synthetic click
    // itself sends nothing.
    if (!event.isTrusted) return;
    if (event.detail !== 3) return;
    clickBurst.supersede();
    void translateSelection(event, false);
}

/**
 * WHICH POPOVER THE USER IS STILL WAITING FOR — a number that only moves
 * forward.
 *
 * THE DEFECT. One gesture is not one request: scheduler.run() retries a transient
 * failure (core/scheduler.ts, "every remaining attempt"), and a request that has
 * already gone out cannot be recalled. So this sequence was reachable, and was
 * observed — double-click, "…" appears, the first attempt fails, the user clicks
 * away to dismiss, the retry succeeds a second later, and showPopover() puts the
 * dismissed gesture's popover back on screen over whatever the user is now
 * reading. Dismissal removed the host element and nothing else, so the only
 * record that the user had moved on was a DOM node the retry cheerfully rebuilt.
 *
 * THE FIX IS AN IDENTITY, NOT A CANCEL. A gesture takes a generation before it
 * renders anything and hands that token to every showPopover() call it makes;
 * dismissal and teardown move the generation on; a render whose token is no
 * longer current is dropped before the first DOM write. An attempt already in
 * flight still completes — nothing here can un-send it, and claiming otherwise
 * would be a promise PRIVACY.md must not make — it simply has nowhere to land.
 *
 * Monotonic, like ClickBurstGate's epoch and for the same reason: a counter that
 * only ever increments cannot hand a stale holder a value that matches again, so
 * no waiter needs cleaning up and no token needs remembering.
 */
let popoverGeneration = 0;

/**
 * Claim the screen for this gesture, and return the token that proves it.
 *
 * Called once per gesture, ABOVE every branch that renders, so that all of one
 * gesture's outcomes — a held original, a refusal, the ellipsis, the translation,
 * the failure message — share one identity while the previous gesture's outcomes
 * share none of it.
 */
function beginPopover(): number {
    return ++popoverGeneration;
}

/**
 * The user has moved on: nothing already issued may paint again.
 *
 * Both callers are statements about the USER, not about any request — the
 * mousedown that dismisses the popover, and removeSelectionHandler() when the
 * plugin is switched off. Incrementing invalidates every outstanding token at
 * once, without having to know how many there are.
 */
function invalidatePopover(): void {
    popoverGeneration++;
}

/**
 * Is this token still the gesture the user is waiting for?
 *
 * ONE PREDICATE, THREE CALL SITES, and that is the point. Two of them are on the
 * request path and ABORT the gesture — after the burst hold, and inside the
 * scheduler immediately before the send — while the third is showPopover()'s own
 * check, which drops a render that arrives too late to matter. Two spellings of one
 * comparison is how a later edit fixes the paint and leaves the send.
 */
function popoverIsCurrent(token: number): boolean {
    return token === popoverGeneration;
}

function showPopover(token: number, x: number, y: number, text: string): void {
    // A token that is not the current generation belongs to a gesture the user has
    // finished with — dismissed, superseded, or in flight when the plugin was
    // switched off. Returning above the first DOM write is the whole point: a late
    // retry must not resurrect a popover that was closed.
    if (!popoverIsCurrent(token)) return;

    document.getElementById(POPOVER_ID)?.remove();

    const host = document.createElement("div");
    host.id = POPOVER_ID;
    host.style.cssText = `position:fixed;left:${x}px;top:${y + 14}px;z-index:2147483001;`;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .pop {
          max-width: 320px;
          padding: 9px 12px;
          font: 13px/1.45 -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
          color: #f0e6d2;
          background: rgba(28, 26, 38, 0.62);
          border: 0.5px solid rgba(255, 255, 255, 0.13);
          border-radius: 14px;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
          backdrop-filter: blur(16px) saturate(1.3);
          -webkit-backdrop-filter: blur(16px) saturate(1.3);
        }
      </style>
      <div class="pop"></div>`;
    // textContent, not innerHTML — never inject message text as markup.
    shadow.querySelector(".pop")!.textContent = text;

    // Invalidating as well as removing the host. Removing it alone left this
    // gesture's token current, so an attempt still in flight — or a retry of one —
    // called showPopover() afterwards and built the popover straight back up.
    const dismiss = () => {
        invalidatePopover();
        host.remove();
        document.removeEventListener("mousedown", dismiss);
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
}

export function installSelectionHandler(): void {
    document.addEventListener("dblclick", onDoubleClick);
    document.addEventListener("click", onTripleClick);
}

export function removeSelectionHandler(): void {
    document.removeEventListener("dblclick", onDoubleClick);
    document.removeEventListener("click", onTripleClick);
    // A click can be held mid-burst at this moment. Without this it would wake
    // up after the plugin was switched off, send, be billed, and paint a popover
    // onto a client that has no translator running.
    clickBurst.abandon();
    // The same hazard one step further on, and abandon() cannot reach it: a click
    // that has ALREADY sent is past the gate, and its attempt can still be
    // retried. Invalidating the generation is what keeps that answer off a client
    // with no translator running, rather than merely removing the host below and
    // letting the retry paint a new one.
    invalidatePopover();
    document.getElementById(POPOVER_ID)?.remove();
}
