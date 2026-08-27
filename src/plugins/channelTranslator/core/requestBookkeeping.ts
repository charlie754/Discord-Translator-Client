/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Two rules about WHICH REQUESTS ARE WORTH MAKING — not about what they cost.
 *
 * Both of these lived in core/usage.ts, whose subject was money: a spend meter,
 * a monthly character cap, and refusals for the two providers billed to the
 * user's own key. Those providers are gone — every surviving path is free — so
 * the meter, the cap and the whole of that file went with them.
 *
 * These two did NOT go, and the reason they were ever filed under "spend" was
 * incidental: money was the loudest consequence of making a request that should
 * not have been made, so the guards were written down beside the meter. Take the
 * money away and both rules still hold, for reasons that were always the real
 * ones — a request that can only fail again is waste, and one gesture should
 * produce one answer. Hence this file, and hence its name: request bookkeeping,
 * not spend.
 *
 * Deliberately in core/, like everything it sits beside: no settings, no
 * DataStore, no Discord, no DOM. That is what lets both rules be tested offline.
 */

/**
 * How many permanently-failed messages are remembered before the oldest is
 * forgotten. Matched to the 5,000-entry translation cache so the two bounds
 * cannot drift into a state where a message is evicted from one and not the
 * other.
 */
export const MAX_TRACKED_PERMANENT_FAILURES = 5_000;

/**
 * The messages that will never translate, so they are not re-sent forever.
 *
 * WHAT IT CLOSES, and none of it depends on a bill. state.ts re-enqueues every
 * untranslated message on every render pass by design ("failure is transient"),
 * the cache is written only on success so nothing suppresses a failure, and the
 * circuit breaker cannot help: it opens on five CONSECUTIVE non-permanent
 * failures and any interleaved success resets the count, so one poison message
 * inside healthy traffic never trips it. Without this registry a message the
 * provider will refuse identically forever is sent again on every pass, for the
 * whole session — burning the free endpoint's rate budget and the Apps Script
 * deployment's daily allowance on an answer that is already known, and dragging
 * the scheduler's three concurrent slots away from messages that could render.
 *
 * Only failures the scheduler itself calls permanent belong here. A transient
 * failure must keep retrying — that is the behaviour the original comment was
 * protecting and it survives intact.
 *
 * Insertion-ordered and bounded: a Set iterates in insertion order, so evicting
 * `values().next()` drops the oldest. Re-marking moves an entry to the back,
 * which keeps a message that keeps failing from being evicted by newer ones.
 */
export class PermanentFailureRegistry {
    private readonly keys = new Set<string>();

    constructor(private readonly capacity: number = MAX_TRACKED_PERMANENT_FAILURES) {}

    has(key: string): boolean {
        return this.keys.has(key);
    }

    mark(key: string): void {
        this.keys.delete(key);
        this.keys.add(key);
        while (this.keys.size > this.capacity) {
            const oldest: string | undefined = this.keys.values().next().value;
            if (oldest === undefined) break;
            this.keys.delete(oldest);
        }
    }

    /**
     * Forget everything. Called when the thing that caused the failures may have
     * changed underneath us — a new provider, a new deployment URL — because a
     * message the free gtx endpoint refused is not a message the user's own Apps
     * Script proxy refuses.
     */
    clear(): void {
        this.keys.clear();
    }

    get size(): number {
        return this.keys.size;
    }
}

/**
 * How long a click waits to find out whether it is the middle of a longer
 * gesture, in milliseconds.
 *
 * 500 ms because that is the multi-click interval both Blink and Windows default
 * to, and it is the same clock the browser itself uses to decide that a third
 * click belongs to the same burst. It is a DEFAULT and not a fact: a user who
 * has raised their system double-click speed past this can still complete a
 * triple-click outside the window, and then still sends two requests. Waiting
 * longer would buy that case at the price of stalling every double-click
 * translation, so the residual is stated rather than gold-plated.
 */
export const CLICK_BURST_MS = 500;

const defaultBurstWait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/**
 * One gesture, one translation.
 *
 * THE BUG. A triple-click is not a separate event from a double-click: the
 * browser fires `dblclick` on the second click and then `click` with
 * `detail === 3` on the third, and selection.ts translates on both. So one
 * triple-click — the gesture the product recommends for selecting a whole line —
 * issued TWO requests, and threw the first answer away when the second popover
 * replaced it. The rendered path has dedupe guards for exactly this class of
 * duplicate; the selection path had none.
 *
 * IT IS STILL WORTH DOING WITH NOTHING BILLED. The wasted request is no longer
 * money, but it is still a request: the free gtx endpoint rate-limits, an Apps
 * Script deployment has a daily allowance of roughly 5,000 calls on a consumer
 * account, and doubling the traffic of the plugin's most-used gesture halves
 * both. The discarded answer is also a discarded scheduler slot, and its
 * popover is a flicker the user sees.
 *
 * WHY IT IS A WAIT AND NOT A CANCEL. A request that has already gone cannot be
 * recalled — the endpoint has already been asked — so the first click of the
 * burst can only be held, never undone. The double-click's request therefore
 * waits out the rest of the burst and drops itself if a third click arrives:
 * the third click is the one the user meant, since it carries the whole
 * selection rather than a single word.
 *
 * The free-of-charge LOCAL paths must NOT be routed through this. Showing a
 * held original is answered from memory with no request at all, and delaying it
 * by half a second would be a regression in the one interaction the UI
 * advertises. Only the request path waits.
 */
export class ClickBurstGate {
    /** Bumped by every click. A waiter that no longer holds the newest one lost. */
    private epoch = 0;

    constructor(
        private readonly windowMs: number = CLICK_BURST_MS,
        private readonly wait: (ms: number) => Promise<void> = defaultBurstWait
    ) {}

    /**
     * Hold this click for the rest of the burst.
     *
     * Resolves true if it is still the newest click and may send, false if a
     * later click in the same gesture — or a later gesture entirely — superseded
     * it, in which case the caller must return without sending anything.
     */
    async settle(): Promise<boolean> {
        const mine = ++this.epoch;
        await this.wait(this.windowMs);
        return this.epoch === mine;
    }

    /**
     * A click that is going to send immediately, so anything still waiting is
     * now the wrong request. Synchronous on purpose: it runs inside the event
     * handler, before any waiter can wake, which is what makes the supersede
     * win the race.
     */
    supersede(): void {
        this.epoch++;
    }

    /** Drop everything pending — the handlers are being removed, or the plugin stopped. */
    abandon(): void {
        this.epoch++;
    }
}
