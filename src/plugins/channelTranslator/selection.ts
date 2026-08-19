import { protect, restore } from "./core/protect";
import { registry } from "./core/providers/registry";
import type { HttpTransport } from "./core/providers/types";
import { settings } from "./settings";
import { entryForMessage, scheduler, toggle, guildIdOf } from "./state";

const POPOVER_ID = "channel-translator-popover";

type TranslationNative = {
    fetchTranslation(url: string): Promise<{ status: number; body: string; retryAfterMs?: number }>;
};

const http: HttpTransport = url => {
    const native = (VencordNative as any)?.pluginHelpers?.ChannelTranslator as TranslationNative | undefined;
    if (!native) throw new Error("ChannelTranslator: native bridge unavailable");
    return native.fetchTranslation(url);
};

/**
 * Decide whether the clicked text is currently rendered translated. A cache
 * entry alone is not enough: with translation switched off the user is reading
 * the original, and reversing there translates the source language into itself.
 */
function reverseTargetFor(target: HTMLElement | null): string | null {
    const row = target?.closest('[id^="chat-messages-"]');
    if (!row) return null;

    // id shape: chat-messages-<channelId>-<messageId>
    const parts = row.id.split("-");
    const channelId = parts[2];
    const messageId = parts[3];
    if (!channelId || !messageId) return null;

    const entry = entryForMessage(messageId);
    if (!entry?.sourceLang) return null;
    if (entry.sourceLang === settings.store.targetLanguage) return null;

    // Case 1: the lower row in Both Language mode is always the translation.
    const inTranslatedRow = Boolean(target?.closest(".ct-translated-row"));

    // Case 2: in replace mode with translation on, the visible text IS the
    // translation.
    const replaced =
        toggle.isOn(guildIdOf(channelId)) && settings.store.mode === "replace";

    if (!inTranslatedRow && !replaced) return null;

    return entry.sourceLang;
}

async function translateSelection(event: MouseEvent): Promise<void> {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) return;

    // Only act inside message content, never in the composer or the sidebar.
    const target = event.target as HTMLElement | null;
    if (!target?.closest('[id^="chat-messages-"], [class*="messageContent"]')) return;

    showPopover(event.clientX, event.clientY, "…");

    const provider = registry.get(settings.store.provider)?.(http);
    if (!provider) return;

    try {
        // Always sl=auto. Asserting the source is an assumption we cannot
        // guarantee — the selection may be the original row, a mixed-language
        // fragment, or a region-subtagged code the endpoint rejects.
        const to = reverseTargetFor(target) ?? settings.store.targetLanguage;
        const translated = await scheduler.run(async () => {
            const { masked, tokens } = protect(text);
            const [result] = await provider.translate([masked], "auto", to);
            return restore(result.text, tokens);
        });
        showPopover(event.clientX, event.clientY, translated);
    } catch {
        showPopover(event.clientX, event.clientY, "Translation unavailable");
    }
}

function onDoubleClick(event: MouseEvent): void {
    void translateSelection(event);
}

/**
 * Triple-click does not re-fire dblclick — the browser fires click with
 * detail === 3 and expands the selection from a word to the whole block.
 * Without this, a triple-click would translate only the word the preceding
 * double-click selected.
 */
function onTripleClick(event: MouseEvent): void {
    if (event.detail !== 3) return;
    void translateSelection(event);
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
    document.getElementById(POPOVER_ID)?.remove();
}
