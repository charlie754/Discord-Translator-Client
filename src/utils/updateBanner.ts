/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type BannerKind = "update" | "failure" | "safe";

export interface BannerAction {
    label: string;
    onClick: () => void | Promise<void>;
}

export interface BannerOptions {
    kind: BannerKind;
    /**
     * "top" (default) is a full-width bar, used by the browser extension. "corner" is a card
     * in the bottom-right, used on desktop, where a top bar would cover Discord's own title
     * bar and its minimise/maximise/close buttons.
     */
    placement?: "top" | "corner";
    message: string;
    detail?: string;
    updateAction?: BannerAction;
    actions?: BannerAction[];
    onDismiss?: () => void;
}

interface BannerHandle {
    element: HTMLDivElement;
    detail: HTMLSpanElement;
    updateButton: HTMLButtonElement | null;
}

const BANNER_ID = "discord-translator-update-banner";
const STYLE_ID = "discord-translator-update-banner-style";

// Button looks live in a stylesheet rather than inline styles because inline styles cannot
// express :focus-visible. With an always-on outline (the first version) a keyboard user could
// not tell which button had focus: the focused screenshot was pixel-identical to the unfocused one.
const BUTTON_CSS = `
#${BANNER_ID} button {
    border: 1px solid rgba(255, 255, 255, .85);
    border-radius: 3px;
    padding: 4px 9px;
    background: rgba(0, 0, 0, .18);
    color: #fff;
    font: inherit;
    cursor: pointer;
    outline: none;
}
#${BANNER_ID} button:hover { background: rgba(0, 0, 0, .32); }
#${BANNER_ID} button:focus-visible {
    outline: 3px solid #fff;
    outline-offset: 2px;
    background: rgba(0, 0, 0, .45);
}`;

let current: BannerHandle | null = null;
let pending: BannerOptions | null = null;
let waitingForBody = false;

export function showBanner(options: BannerOptions): void {
    pending = options;
    if (!document.body) {
        waitForBody();
        return;
    }

    mountPending();
}

export function updateBanner(options: Pick<BannerOptions, "detail" | "updateAction">): void {
    if (pending) {
        pending = { ...pending, ...options };
    }

    if (!current) return;
    current.detail.textContent = options.detail ?? "";
    if (options.updateAction) {
        current.updateButton = replaceButton(current.element, current.updateButton, options.updateAction);
    }
}

export function openLink(url: string): void {
    window.open(url, "_blank", "noopener,noreferrer");
}

function waitForBody(): void {
    if (waitingForBody) return;
    waitingForBody = true;

    const mount = () => {
        waitingForBody = false;
        if (document.body) mountPending();
    };
    document.addEventListener("DOMContentLoaded", mount, { once: true });
}

function mountPending(): void {
    if (!pending || !document.body) return;

    const options = pending;
    pending = null;
    current?.element.remove();
    ensureStyle();

    const element = document.createElement("div");
    element.id = BANNER_ID;
    element.setAttribute("role", options.kind === "update" ? "status" : "alert");
    Object.assign(element.style, {
        position: "fixed",
        boxSizing: "border-box",
        zIndex: "2147483647",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 10px",
        padding: "10px 14px",
        background: "#5865F2",
        color: "#fff",
        font: "14px system-ui, sans-serif",
        lineHeight: "1.4"
    }, options.placement === "corner"
        ? { right: "16px", bottom: "16px", maxWidth: "380px", borderRadius: "8px", boxShadow: "0 8px 24px rgba(0, 0, 0, .35)" }
        : { top: "0", left: "0", width: "100%" });

    // flex-basis 280px: on a wide bar everything stays on one row; when the row is too narrow
    // (a phone-width window, or the desktop card) the message takes the first row on its own
    // instead of being squeezed into a thin column beside the buttons.
    const message = document.createElement("span");
    message.textContent = options.message;
    message.style.flex = "1 1 280px";
    element.append(message);

    const detail = document.createElement("span");
    detail.textContent = options.detail ?? "";
    detail.style.flex = "0 1 auto";
    element.append(detail);

    const buttons = document.createElement("span");
    buttons.style.display = "inline-flex";
    buttons.style.gap = "8px";
    buttons.style.flex = "0 0 auto";
    buttons.style.marginLeft = "auto";
    element.append(buttons);

    let updateButton: HTMLButtonElement | null = null;
    if (options.updateAction) {
        updateButton = makeButton(options.updateAction);
        buttons.append(updateButton);
    }
    for (const action of options.actions ?? []) buttons.append(makeButton(action));

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.title = "Dismiss";
    close.addEventListener("click", () => {
        options.onDismiss?.();
        element.remove();
        current = null;
    });
    buttons.append(close);

    document.documentElement.append(element);
    current = { element, detail, updateButton };
}

function makeButton(action: BannerAction): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => void action.onClick());
    return button;
}

function replaceButton(element: HTMLDivElement, oldButton: HTMLButtonElement | null, action: BannerAction): HTMLButtonElement {
    const button = makeButton(action);
    if (oldButton) {
        oldButton.replaceWith(button);
    } else {
        element.querySelector("span:last-child")?.prepend(button);
    }
    return button;
}

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = BUTTON_CSS;
    document.documentElement.append(style);
}
