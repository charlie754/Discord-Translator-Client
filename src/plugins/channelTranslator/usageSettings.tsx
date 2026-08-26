/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// plugin/usageSettings.tsx — the spend meter as the user sees it, rendered
// inside the plugin's own settings screen next to the key that causes the spend.
//
// Takes its UsageStore as a prop rather than importing ./settings. settings.ts
// has to import this file to place the component, so importing settings.ts back
// would close a module cycle around the one object in this plugin that must not
// be touched during module evaluation — the same class of failure the
// no-module-scope-settings guard exists for. Props keep the arrow one-way.
// Imported from the individual modules rather than the "@components" barrel:
// tsconfig maps "@components/*" and NOT the bare specifier, so the barrel does
// not typecheck from here.
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React } from "@webpack/common";

import {
    CREDIT_CHARACTERS_PER_MONTH,
    CREDIT_USD_PER_MONTH,
    creditRemainingUsd,
    creditUsedUsd,
    estimateUsd,
    formatCount,
    formatUsd,
    monthKey,
    PRICED_PROVIDER,
    reservedCharacters,
    UsageMeter,
    type UsageStore,
    USD_PER_MILLION_CHARACTERS
} from "./core/usage";

export interface UsageSettingsProps {
    store: UsageStore;
    /** The user's cap in characters; 0 means no cap. */
    cap: number;
}

/** Labels for the providers that bill. Keys match the ids in core/providers/registry.ts. */
const PROVIDER_LABEL: Readonly<Record<string, string>> = {
    "google-cloud": "Google Cloud Translation",
    deepl: "DeepL"
};

/**
 * The money line for the one provider whose price is verified.
 *
 * IT USED TO PRINT "estimated $0.00" FOR THE FIRST HALF-MILLION CHARACTERS, and
 * that is the single most misleading thing this panel could say. Google's
 * monthly USD 10 is a CREDIT, not a free tier: the characters are charged, the
 * credit is spent against the charge, the same credit is shared with Cloud
 * Translation - Advanced, and whatever is left of it on the last day of the
 * month is gone rather than carried forward. A user reading "$0.00" concludes
 * they used nothing, and GOOGLE_CLOUD_SETUP.md has a whole section correcting
 * exactly that reading.
 *
 * So the figure shown inside the credit is what has been CONSUMED of it, and
 * $0.00 is never printed as a cost. Past the credit the estimate resumes.
 */
function pricedNote(characters: number): string {
    const left = creditRemainingUsd(characters);
    const credit = formatUsd(CREDIT_USD_PER_MONTH);

    if (left > 0) {
        return (
            ` · ${formatUsd(creditUsedUsd(characters))} of this month's ${credit} credit spent, ` +
            `${formatUsd(left)} of it left — it does not roll over`
        );
    }
    return (
        ` · this month's ${credit} credit is spent in full and does not roll over · ` +
        `estimated ${formatUsd(estimateUsd(characters))} billed past it`
    );
}

function UsageSettings({ store, cap }: UsageSettingsProps) {
    // The meter reads through the store on every call, so a re-render is all it
    // takes to show a fresh number — there is no cached copy to invalidate.
    const meter = new UsageMeter(store);
    const [, tick] = React.useState(0);
    // Two-step, because this button destroys the only record of the month's
    // spend and a settings screen is a place people click while scrolling.
    const [armed, setArmed] = React.useState(false);

    const state = meter.snapshot();
    const total = meter.total();
    // There is deliberately no per-provider figure computed here any more. One
    // was — `const priced = state.characters[PRICED_PROVIDER]` — and it was
    // never rendered: the rows below already print that exact number, so it was
    // a second copy of a value on screen, kept alive by nothing. Removed rather
    // than rendered, because rendering it would have shown the same characters
    // twice under two headings.
    //
    // The month is READ FROM THE STATE, not from the clock. They can differ:
    // core/usage.ts refuses to roll a recorded month backwards when the system
    // clock does, so a machine whose date has jumped back shows the month it is
    // really still counting into.
    const clockMonth = monthKey(new Date());
    // Characters committed to the cap by requests that have not landed yet. The
    // meter cannot see them — they are not recorded until a reply arrives — but
    // the cap already holds them, so a headroom figure that ignored them would be
    // exactly the overstatement this screen used to print.
    const inFlight = reservedCharacters();
    const headroom = Math.max(0, cap - total - inFlight);

    const rows = Object.keys(PROVIDER_LABEL)
        .filter(id => id === PRICED_PROVIDER || (state.characters[id] ?? 0) > 0)
        .map(id => ({ id, label: PROVIDER_LABEL[id], chars: state.characters[id] ?? 0 }));

    return (
        <section style={{ marginBottom: 16 }}>
            <Heading tag="h5">Spend meter — {state.month}</Heading>

            {rows.map(row => (
                <Paragraph key={row.id}>
                    {row.label}: <strong>{formatCount(row.chars)}</strong> characters sent this month
                    {row.id === PRICED_PROVIDER
                        ? pricedNote(row.chars)
                        : " · characters only, no verified price table for this provider"}
                </Paragraph>
            ))}

            {state.month !== clockMonth && (
                <Paragraph>
                    This machine&apos;s clock says {clockMonth}, which is BEFORE the month being counted. The
                    count is kept rather than erased — a clock moving backwards must not delete a recorded
                    month or hand back a spent cap. Reset below if the earlier date is the correct one.
                </Paragraph>
            )}

            <Paragraph>
                Google charges for every character; the first {formatCount(CREDIT_CHARACTERS_PER_MONTH)} a
                month are covered by a {formatUsd(CREDIT_USD_PER_MONTH)} credit, not given away. That credit
                is shared with Cloud Translation - Advanced, it does not roll over, and past it the rate is
                USD {USD_PER_MILLION_CHARACTERS.toFixed(2)} per 1,000,000 characters. Exceeding the credit
                does not stop translation — it bills.
            </Paragraph>

            <Paragraph>
                <strong>This is an estimate and it will not match Google&apos;s invoice.</strong> It counts only
                what this plugin sent, so it cannot see anything else on the same billing account spending the
                same credit, and Google also charges for empty queries, which have no characters to count. The
                free &quot;Google (free)&quot; provider is not counted here at all — it has no bill.
            </Paragraph>

            <Paragraph>
                {cap > 0
                    // "N left before translation is refused" was stated as a fact and could not
                    // be one. It ignored anything already in the air, and it read as a per-character
                    // allowance when the cap refuses a message WHOLE — with 40 left, a 60-character
                    // message does not send 40 of itself, it does not send at all. Both are stated
                    // now, and `inFlight` is the reservation the cap actually holds, so the headroom
                    // below is the number the next message will really be compared against.
                    ? `Cap: ${formatCount(cap)} characters a month across paid providers. ` +
                      `About ${formatCount(headroom)} left` +
                      (inFlight > 0
                          ? `, with ${formatCount(inFlight)} characters in flight right now and not yet counted above. `
                          : ". ") +
                      "A message is refused whole once it would take you past the cap, rather than " +
                      "part-sent, so the last message before the cap can be refused while some " +
                      "headroom is still showing. This is an estimate for the same reason the " +
                      "figures above are."
                    : "Cap: off. Nothing here stops a request — set a monthly character cap below if you want one."}
            </Paragraph>

            <Button
                variant={armed ? "dangerPrimary" : "secondary"}
                size="small"
                onClick={() => {
                    if (!armed) {
                        setArmed(true);
                        return;
                    }
                    meter.reset();
                    setArmed(false);
                    tick(n => n + 1);
                }}
            >
                {armed ? "Click again to erase this month's count" : "Reset the counter"}
            </Button>
        </section>
    );
}

/**
 * Returned as an element, not called as a function.
 *
 * Vencord's ComponentSetting invokes `setting.component(props)` inside its own
 * render, so a component called directly would hang its hooks off
 * ComponentSetting's hook list. Handing back an element gives UsageSettings its
 * own component instance and its own hooks.
 */
export function renderUsageSettings(props: UsageSettingsProps): React.ReactNode {
    return <UsageSettings {...props} />;
}
