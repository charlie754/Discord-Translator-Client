// plugin/panel/index.tsx
import { React, createRoot } from "@webpack/common";

import { Panel } from "./Panel";
import { PANEL_CSS } from "./styles";

const HOST_ID = "channel-translator-host";
let root: any = null;
let reposition: (() => void) | null = null;

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

    // Anchor to the top-right of the chat area rather than the window, so the
    // panel moves correctly when the member list or sidebar is toggled.
    reposition = () => {
        const chat = document.querySelector('[class*="chatContent"], main[class*="chatContent"]')
            ?? document.querySelector("main");
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
    };
    reposition();
    // Discord's chat container is not laid out on the first frame after mount,
    // so a single measurement can land against a stale or absent box.
    requestAnimationFrame(reposition);
    setTimeout(reposition, 500);
    window.addEventListener("resize", reposition);
}

export function unmountPanel(): void {
    if (reposition) window.removeEventListener("resize", reposition);
    reposition = null;
    root?.unmount();
    root = null;
    document.getElementById(HOST_ID)?.remove();
}
