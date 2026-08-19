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
 * once, and every channel in it follows. DMs are never on — translating a DM
 * would ship someone's private message to a third party.
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
