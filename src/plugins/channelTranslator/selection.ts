/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MessageStore } from "@webpack/common";

import { selectionAction, translationEnabled } from "./core/modes";
import { protect, restore } from "./core/protect";
import { ClickBurstGate, isCapRefusal } from "./core/usage";
import { settings } from "./settings";
import { entryForMessage, guildIdOf, scheduler, toggle, translationProvider } from "./state";

const POPOVER_ID = "channel-translator-popover";

/**
 * One gesture, one billed translation.
 *
 * A triple-click fires `dblclick` on the second click and `click` with
 * `detail === 3` on the third, and both handlers below translate — so the
 * gesture the UI recommends for grabbing a whole line issued TWO requests to a
 * paid provider and threw the first answer away. The rule and the reason live in
 * core/usage.ts with the rest of the spend guards, where they are unit-tested;
 * this file only routes the two handlers through it.
 *
 * Module-level, like the request path itself: the burst spans two separate
 * events, so a gate constructed per event would be a gate of one.
 */
const clickBurst = new ClickBurstGate();

// There is deliberately no HttpTransport and no currentProvider() call in this
// file any more. Both used to live here, duplicated from state.ts, and the
// duplicate was the bug: this path translated through the RAW provider, so
// double-click and triple-click translation was neither counted by the usage
// meter nor stopped by the user's own monthly character cap. A user who set a
// cap kept paying past it, through here.
//
// state.ts's translationProvider() is now the only way to obtain a provider, and
// what it returns is already metered. Getting this wrong again would mean
// re-adding an import that test/meteredProviderChokepoint.test.ts fails on.

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

    // THE PRIVACY GATE AND THE FREE PATH, both decided in one place.
    //
    // Everything past a "translate" verdict sends the selected text to a third
    // party. This path used to ask nothing at all: not the per-server toggle,
    // not DMs. A double-click inside a private message shipped it; a
    // double-click in a server the user had deliberately switched OFF shipped it
    // too, billed on the paid providers. The rendered path in render.tsx had
    // guarded both since it was written.
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
        showPopover(event.clientX, event.clientY, action.text);
        return;
    }
    if (action.kind === "refuse") {
        showPopover(event.clientX, event.clientY, action.reason);
        return;
    }

    // PAST THIS LINE THE REQUEST IS BILLED, so this is where a double-click that
    // is really the first half of a triple-click has to stop. Deliberately below
    // the free branches above — showing a held original or a refusal costs
    // nothing and must not be delayed — and above the "…" popover, so a
    // superseded click leaves no trace on screen for the click that replaced it
    // to fight with.
    if (holdForBurst && !(await clickBurst.settle())) return;

    showPopover(event.clientX, event.clientY, "…");

    // The popover is already open showing "…", so an unusable provider has to
    // replace it with the reason rather than leaving that ellipsis on screen.
    const resolved = translationProvider();
    if (!resolved.ok) {
        showPopover(event.clientX, event.clientY, resolved.reason);
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
            const { masked, tokens } = protect(text);
            const [result] = await provider.translate([masked], "auto", action.to);
            return restore(result.text, tokens);
        });
        showPopover(event.clientX, event.clientY, translated);
    } catch (err) {
        // Now that this path is capped, it can be refused by the user's own cap
        // — and "Translation unavailable" for that is the exact message
        // core/usage.ts exists to avoid, because it sends people to the Google
        // Cloud console to debug a limit that only exists in these settings.
        showPopover(
            event.clientX,
            event.clientY,
            isCapRefusal(err) ? err.message : "Translation unavailable"
        );
    }
}

function onDoubleClick(event: MouseEvent): void {
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
    if (event.detail !== 3) return;
    clickBurst.supersede();
    void translateSelection(event, false);
}

function showPopover(x: number, y: number, text: string): void {
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

    const dismiss = () => { host.remove(); document.removeEventListener("mousedown", dismiss); };
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
    document.getElementById(POPOVER_ID)?.remove();
}
