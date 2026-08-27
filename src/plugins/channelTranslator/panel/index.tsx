/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/panel/index.tsx
import { createRoot,React } from "@webpack/common";

import { Panel } from "./Panel";
import { PANEL_CSS } from "./styles";

const HOST_ID = "channel-translator-host";
let root: any = null;
let reposition: (() => void) | null = null;
let visibilityTimer: ReturnType<typeof setInterval> | null = null;
let chatObserver: ResizeObserver | null = null;
let ariaObserver: MutationObserver | null = null;
let observedAnchor: Element | null = null;

/**
 * Selectors that prove a CHAT AREA exists. Every one of them is specific to the
 * message column — none of them can match a page that merely happens to be
 * mounted.
 *
 * There is deliberately NO `main` fallback here, and one must never be added
 * back. `main` was in this list until the panel was reported covering the
 * settings page for the third time, and it is what made both of the guards
 * below inert: Discord's settings screen is itself inside a `<main>`, so the
 * fallback always matched, the anchor was always non-null and always connected,
 * and "no chat area" became a state the code could not represent. A fallback
 * that matches everything is not a safety net — it is the failure.
 */
const CHAT_SELECTORS = [
    // A Discord data attribute; it churns far less than generated class names.
    '[data-list-id="chat-messages"]',
    '[class*="messagesWrapper"]',
    '[class*="chatContent"]'
] as const;

/**
 * Selectors that prove a full-screen settings/modal layer is open ABOVE the app.
 *
 * This is the third, EXPLICIT signal. The two rules in applyLayerVisibility()
 * infer the state (is the anchor gone? is an ancestor aria-hidden?), and an
 * inference can be defeated by a DOM that does not behave the way it was
 * assumed to — which is exactly what happened twice. This one asks the question
 * directly.
 *
 * `section.vc-settings-tab` is not a guess: it is THIS project's own class,
 * emitted by SettingsTab in src/components/settings/tabs/BaseTab.tsx, and every
 * client settings page this plugin ships is wrapped in it. It is the page in the
 * operator's screenshot, and unlike a Discord class name it cannot churn,
 * because we own it.
 *
 * `[aria-modal="true"]` covers Discord's own full-screen layers and dialogs by
 * ARIA rather than by class name, for the same reason the aria-hidden rule below
 * uses ARIA: it is semantic and stable where Discord's generated class names are
 * neither.
 */
const BLOCKING_LAYER_SELECTORS = [
    "section.vc-settings-tab",
    '[aria-modal="true"]'
] as const;

/** The first chat-specific match, or null when there is no chat area at all. */
function findChatAnchor(): Element | null {
    for (const selector of CHAT_SELECTORS) {
        const found = document.querySelector(selector);
        if (found) return found;
    }
    return null;
}

/** True when something full-screen is open over the app and the panel must hide. */
function isBlockingLayerOpen(): boolean {
    return BLOCKING_LAYER_SELECTORS.some(selector => document.querySelector(selector) != null);
}

export function mountPanel(): void {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);

    // Own the host's geometry entirely from JavaScript so positioning is not
    // split between inline styles and shadow CSS, which makes it hard to reason
    // about and unreliable in practice. The z-index value is MAX_SAFE_INT >> 1.
    host.style.cssText = "position:fixed;z-index:2147483000;top:0px;right:16px;";

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const mountPoint = document.createElement("div");
    shadow.appendChild(mountPoint);

    root = createRoot(mountPoint);
    root.render(<Panel />);

    // The host is fixed at z-index 2147483000 on document.body, so it sits above
    // Discord's full-screen settings/modal layers, which live inside #app-mount.
    // Nothing above it can cover it, so it has to take itself away.
    //
    // The rule is: SHOW ONLY when there is a real message list AND no
    // full-screen layer above it. Anything else — including "I cannot tell" —
    // hides. A panel that is briefly missing is a far smaller failure than one
    // covering the settings the user is trying to read, and the interval at the
    // bottom of mountPanel() re-checks every 500ms, so "briefly" is the worst
    // case.
    //
    // Three signals, checked in that order below.
    const applyLayerVisibility = () => {
        // Rule ZERO, and it runs before anything can show the panel: a
        // full-screen settings page or modal is open, so hide unconditionally.
        // Rules one and two below both INFER this state from the chat anchor;
        // two turns of inference-based rules failed, so this one asks directly.
        // It is checked first because this function is the only place that ever
        // sets display back to "" — nothing can show the panel past this point.
        if (isBlockingLayerOpen()) {
            host.style.display = "none";
            return;
        }

        // Rule one, and the reason this was reported twice: if the chat area is
        // not in the document there is nothing for the panel to sit on, so hide.
        // Opening Discord's settings replaces the message column, which leaves
        // observedAnchor detached — and a detached node has no ancestor that
        // will ever gain aria-hidden, so rule two below can never fire for it.
        //
        // The previous version failed toward SHOWING here, reasoning that a
        // wrong guess would hide the panel permanently because nothing was left
        // to bring it back. That reasoning was sound and the conclusion was
        // still wrong: the case it protected against is exactly the settings
        // screen, so the panel sat on top of it. What makes the safer rule safe
        // is the interval below, which keeps re-checking and shows the panel
        // again the moment a chat area exists.
        if (!observedAnchor?.isConnected) {
            host.style.display = "none";
            return;
        }

        // Rule two, and it is still needed after rule zero: Discord keeps the
        // app mounted behind its settings layer, so the chat selectors can still
        // match while settings is open. When a layer opens on top, Discord marks
        // the layers underneath it aria-hidden="true" — that is the signal used
        // here, rather than a class name, because it is semantically correct and
        // Discord's generated class names churn between builds. closest()
        // includes the anchor itself, which is correct.
        const layer = observedAnchor.closest("[aria-hidden]");
        const hidden = layer?.getAttribute("aria-hidden") === "true";
        host.style.display = hidden ? "none" : "";
    };

    // Anchor to the top-right of the chat area rather than the window, so the
    // panel moves correctly when the member list or sidebar is toggled.
    reposition = () => {
        // Anchor to the message column, not the chat region: the latter spans
        // the member list, so the panel would sit on top of it when open. The
        // list is chat-specific by construction — see CHAT_SELECTORS, and read
        // the note there before adding any fallback to it.
        const chat = findChatAnchor();
        // No chat area anywhere in the document: settings, a full-screen modal,
        // or a still-loading client. Hide and stop measuring against nothing.
        // Release the observers too: they are bound to a node that is on its way
        // out, and the interval below is what brings the panel back.
        if (!chat) {
            host.style.display = "none";
            chatObserver?.disconnect();
            chatObserver = null;
            ariaObserver?.disconnect();
            ariaObserver = null;
            observedAnchor = null;
            return;
        }

        // Discord replaces the message column on every channel switch, so an
        // observer bound at mount time silently stops firing. Re-bind whenever
        // the node identity changes; comparing identity keeps this from
        // looping when the observer's own callback lands here.
        if (chat !== observedAnchor) {
            chatObserver?.disconnect();
            observedAnchor = chat;
            chatObserver = new ResizeObserver(() => reposition?.());
            chatObserver.observe(chat);

            // Re-bound on the same trigger, by the same node-identity test, for
            // the same reason: the ancestor chain above the message column is
            // replaced along with it, so an observer bound once at mount time
            // would silently stop firing after the first channel switch.
            //
            // Every ancestor is observed, not just the nearest one carrying
            // aria-hidden today, because the attribute is ADDED when a layer
            // opens: an element with no aria-hidden right now is exactly the one
            // that has to be watched. One observer, many observe() calls.
            ariaObserver?.disconnect();
            ariaObserver = new MutationObserver(() => applyLayerVisibility());
            for (let node: Element | null = chat; node != null; node = node.parentElement) {
                ariaObserver.observe(node, { attributes: true, attributeFilter: ["aria-hidden"] });
            }
        }

        const box = chat?.getBoundingClientRect();

        // Anchor the right edge so the shell grows leftward when it expands
        // from its collapsed width to 272px on hover. Clamp to the viewport so
        // it can never be clipped, whatever the window size.
        const desiredRight = window.innerWidth - (box?.right ?? window.innerWidth) + 16;
        const right = Math.min(Math.max(desiredRight, 12), Math.max(12, window.innerWidth - 288));

        // Sit below Discord's channel header — anchoring to the chat container's
        // top puts the panel over the Search box and the header icons.
        const header =
            document.querySelector('section[class*="title"]')
            ?? document.querySelector('[class*="chatHeader"]')
            ?? document.querySelector('[class*="upperContainer"]');
        const headerBottom = header?.getBoundingClientRect().bottom;

        // Numeric fallback: Discord's header is ~48px tall, so offset from the
        // chat container's top if no header element can be found.
        const top = (headerBottom ?? ((box?.top ?? 48) + 48)) + 8;

        host.style.top = `${Math.max(8, top)}px`;
        host.style.right = `${right}px`;
        host.style.left = "auto";

        // Re-evaluated here too, not only from the MutationObserver: on a channel
        // switch the anchor changes and the observer is rebound, so the state has
        // to be read once against the new chain.
        applyLayerVisibility();
    };
    reposition();
    // Discord's chat container is not laid out on the first frame after mount,
    // so a single measurement can land against a stale or absent box.
    requestAnimationFrame(reposition);
    setTimeout(reposition, 500);
    window.addEventListener("resize", reposition);

    // Every other trigger here is bound to a node Discord may replace: the
    // ResizeObserver dies with the message column, and the MutationObserver
    // watches an ancestor chain that goes with it. When the settings screen
    // opens, both go quiet and nothing re-evaluates. This is the one trigger
    // that survives that, and it is what lets the visibility rule above hide by
    // default without the panel getting stuck hidden.
    visibilityTimer = setInterval(() => reposition?.(), 500);
}

export function unmountPanel(): void {
    if (reposition) window.removeEventListener("resize", reposition);
    if (visibilityTimer !== null) clearInterval(visibilityTimer);
    visibilityTimer = null;
    reposition = null;
    chatObserver?.disconnect();
    chatObserver = null;
    ariaObserver?.disconnect();
    ariaObserver = null;
    observedAnchor = null;
    root?.unmount();
    root = null;
    document.getElementById(HOST_ID)?.remove();
}
