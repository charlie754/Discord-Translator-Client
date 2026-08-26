/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 IRP_HongKong
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { protect } from "../src/plugins/channelTranslator/core/protect";
import type { TranslationProvider } from "../src/plugins/channelTranslator/core/providers/types";
import { isPermanent, permanentError, Scheduler } from "../src/plugins/channelTranslator/core/scheduler";
import {
    CapNoticeGate,
    capRefusalMessage,
    CapReservations,
    CLICK_BURST_MS,
    ClickBurstGate,
    countBatch,
    countCodePoints,
    CREDIT_CHARACTERS_PER_MONTH,
    CREDIT_USD_PER_MONTH,
    creditRemainingUsd,
    creditUsedUsd,
    estimateUsd,
    formatUsd,
    grossUsd,
    isBilledProvider,
    isCapRefusal,
    isLaterMonth,
    isMonthKey,
    MAX_TRACKED_PERMANENT_FAILURES,
    meteredProvider,
    meterIfBilled,
    monthKey,
    parseUsage,
    PermanentFailureRegistry,
    reservedCharacters,
    TRANSPORT_REFUSED_STATUS,
    UsageMeter,
    type UsageStore,
    USD_PER_MILLION_CHARACTERS,
    wasSent
} from "../src/plugins/channelTranslator/core/usage";

/** The injected store, in memory. `peek` is the assertion surface for persistence. */
function memoryStore(initial = ""): UsageStore & { peek(): string; } {
    let value = initial;
    return {
        load: () => value,
        save: (json: string) => { value = json; },
        peek: () => value
    };
}

interface Recorder {
    provider: TranslationProvider;
    calls: string[][];
}

function fakeProvider(id: string): Recorder {
    const calls: string[][] = [];
    return {
        calls,
        provider: {
            id,
            label: id,
            needsKey: false,
            async translate(texts) {
                calls.push([...texts]);
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        }
    };
}

/**
 * Local-component Dates on purpose. monthKey reads the LOCAL calendar, so a UTC
 * literal like "2026-01-31T23:00:00Z" would land in a different month depending
 * on the machine's timezone and the test would pass or fail by geography.
 */
const AUGUST = () => new Date(2026, 7, 24, 12, 0, 0);
const SEPTEMBER = () => new Date(2026, 8, 1, 0, 30, 0);

describe("counting characters the way Google bills them", () => {
    it("counts code points, so CJK is not penalised three-to-one", () => {
        // Google: "Each character corresponds to a code point." Three Han
        // characters are three characters, not the nine bytes of their UTF-8.
        expect(countCodePoints("你好嗎")).toBe(3);
        expect(Buffer.byteLength("你好嗎", "utf8")).toBe(9);
    });

    it("counts an astral emoji as one character, not the two UTF-16 units String.length reports", () => {
        expect("😀".length).toBe(2);
        expect(countCodePoints("😀")).toBe(1);
        expect(countCodePoints("a😀b")).toBe(3);
    });

    it("counts whitespace, because Google charges for it", () => {
        // Verbatim: "You are charged for all characters that you include in a
        // Cloud Translation request, even untranslated characters. This
        // includes, for example, whitespace characters."
        expect(countCodePoints("a b")).toBe(3);
        expect(countCodePoints("   ")).toBe(3);
    });

    it("counts protect() sentinels, which are billed like any other character", () => {
        // Taken from core/protect.ts's real output rather than from a literal, so
        // this cannot quietly drift if the sentinel format changes. A masked token
        // is OPEN + index + CLOSE = three code points, and Google bills all three:
        // "even untranslated characters".
        const p = protect("see <@123456> now");
        expect(p.tokens).toEqual(["<@123456>"]);
        expect(p.masked).toBe("see 0 now");
        expect(countCodePoints(p.masked)).toBe(11);
        // "see  now" is 8 characters; the three extra ones are the sentinel token.
        expect(countCodePoints(p.masked) - countCodePoints("see  now")).toBe(3);
    });

    it("counts an empty string as zero characters", () => {
        expect(countCodePoints("")).toBe(0);
    });

    it("sums a batch", () => {
        expect(countBatch(["abc", "你好", ""])).toBe(5);
        expect(countBatch([])).toBe(0);
    });
});

describe("price estimate", () => {
    it("is zero inside the monthly credit", () => {
        expect(estimateUsd(0)).toBe(0);
        expect(estimateUsd(CREDIT_CHARACTERS_PER_MONTH)).toBe(0);
    });

    it("bills USD 20.00 per million past the credit", () => {
        expect(USD_PER_MILLION_CHARACTERS).toBe(20);
        expect(estimateUsd(CREDIT_CHARACTERS_PER_MONTH + 1_000_000)).toBeCloseTo(20, 10);
        expect(estimateUsd(CREDIT_CHARACTERS_PER_MONTH + 500_000)).toBeCloseTo(10, 10);
    });

    it("formats as dollars and cents", () => {
        expect(formatUsd(0)).toBe("$0.00");
        expect(formatUsd(estimateUsd(CREDIT_CHARACTERS_PER_MONTH + 123_456))).toBe("$2.47");
    });

    it("the credit covers 500,000 characters", () => {
        expect(CREDIT_CHARACTERS_PER_MONTH).toBe(500_000);
    });
});

/**
 * THE CREDIT IS NOT A FREE TIER, and the meter used to say it was: the panel
 * printed "estimated $0.00" for the first half-million characters, which is the
 * exact reading GOOGLE_CLOUD_SETUP.md exists to correct. The characters are
 * charged at the ordinary rate; a monthly USD 10 credit is applied against the
 * charge, shared with Cloud Translation - Advanced, and does not roll over.
 */
describe("the monthly credit is consumed, not free", () => {
    it("charges the list rate from the very first character", () => {
        // Gross cost is what Google bills before the credit is applied. It is
        // NOT zero inside the credit, and that is the whole point.
        expect(grossUsd(0)).toBe(0);
        expect(grossUsd(1_000_000)).toBeCloseTo(20, 10);
        expect(grossUsd(123_456)).toBeCloseTo(2.46912, 10);
        expect(grossUsd(-5)).toBe(0);
    });

    it("reports what has been consumed of the credit rather than a cost of zero", () => {
        expect(creditUsedUsd(0)).toBe(0);
        expect(formatUsd(creditUsedUsd(123_456))).toBe("$2.47");
        expect(creditUsedUsd(CREDIT_CHARACTERS_PER_MONTH)).toBeCloseTo(CREDIT_USD_PER_MONTH, 10);
    });

    it("never reports more of the credit consumed than the credit holds", () => {
        expect(creditUsedUsd(CREDIT_CHARACTERS_PER_MONTH * 10)).toBe(CREDIT_USD_PER_MONTH);
        expect(creditRemainingUsd(CREDIT_CHARACTERS_PER_MONTH * 10)).toBe(0);
    });

    it("counts down what is left of the credit, which does not roll over", () => {
        expect(creditRemainingUsd(0)).toBe(CREDIT_USD_PER_MONTH);
        expect(formatUsd(creditRemainingUsd(123_456))).toBe("$7.53");
        expect(creditRemainingUsd(CREDIT_CHARACTERS_PER_MONTH)).toBeCloseTo(0, 10);
    });

    it("used + remaining is always the whole credit", () => {
        for (const n of [0, 1, 9_999, 250_000, 499_999, 500_000, 500_001, 5_000_000]) {
            expect(creditUsedUsd(n) + creditRemainingUsd(n)).toBeCloseTo(CREDIT_USD_PER_MONTH, 10);
        }
    });

    it("the three constants cannot drift apart — 500,000 chars at $20/M IS the $10 credit", () => {
        // If someone edits one of the three, this is what fails. A panel showing
        // "$11.00 of a $10.00 credit spent" is the failure it prevents.
        expect(grossUsd(CREDIT_CHARACTERS_PER_MONTH)).toBeCloseTo(CREDIT_USD_PER_MONTH, 10);
        expect(CREDIT_USD_PER_MONTH).toBe(10);
    });

    it("the billed estimate resumes exactly where the credit runs out", () => {
        expect(estimateUsd(CREDIT_CHARACTERS_PER_MONTH)).toBe(0);
        expect(creditRemainingUsd(CREDIT_CHARACTERS_PER_MONTH)).toBeCloseTo(0, 10);
        expect(estimateUsd(CREDIT_CHARACTERS_PER_MONTH + 1_000_000)).toBeCloseTo(20, 10);
    });
});

describe("month key and rollover", () => {
    it("formats as YYYY-MM with a padded month", () => {
        expect(monthKey(new Date(2026, 0, 5))).toBe("2026-01");
        expect(monthKey(new Date(2026, 11, 31))).toBe("2026-12");
    });

    it("keeps counting inside one month", () => {
        const store = memoryStore();
        const meter = new UsageMeter(store, AUGUST);
        meter.record("google-cloud", ["abcde"]);
        meter.record("google-cloud", ["fghij"]);
        expect(meter.total()).toBe(10);
        expect(meter.snapshot().month).toBe("2026-08");
    });

    it("resets on rollover because the month is stored, not timed", () => {
        const store = memoryStore();
        let clock = AUGUST();
        const meter = new UsageMeter(store, () => clock);

        meter.record("google-cloud", ["a".repeat(1234)]);
        expect(meter.total()).toBe(1234);

        clock = SEPTEMBER();
        expect(meter.snapshot().month).toBe("2026-09");
        expect(meter.total()).toBe(0);
    });

    it("rolls over across a restart, not just while running", () => {
        // The persisted blob is August's. A brand-new meter — the shape a client
        // restart produces — reads it in September and must not inherit it.
        const augustBlob = JSON.stringify({ month: "2026-08", characters: { "google-cloud": 9999 } });
        const meter = new UsageMeter(memoryStore(augustBlob), SEPTEMBER);
        expect(meter.total()).toBe(0);
    });

    it("does not lose the count across a restart inside the same month", () => {
        const augustBlob = JSON.stringify({ month: "2026-08", characters: { "google-cloud": 9999 } });
        const meter = new UsageMeter(memoryStore(augustBlob), AUGUST);
        expect(meter.total()).toBe(9999);
    });

    it("persists through the injected store rather than any ambient storage", () => {
        const store = memoryStore();
        new UsageMeter(store, AUGUST).record("google-cloud", ["hello"]);
        expect(JSON.parse(store.peek())).toEqual({ month: "2026-08", characters: { "google-cloud": 5 } });
    });

    it("pads the year, because these keys are compared as strings", () => {
        expect(monthKey(new Date(2026, 0, 5))).toBe("2026-01");
        // A four-digit year is not something Date guarantees. An unpadded "999-12"
        // would sort AFTER "2026-01" and make a stale month look like a future one.
        const ancient = new Date(2026, 0, 5);
        ancient.setFullYear(999);
        expect(monthKey(ancient)).toBe("0999-01");
        expect(isLaterMonth("2026-01", monthKey(ancient))).toBe(true);
    });

    it("recognises a month key and refuses anything that is not orderable", () => {
        expect(isMonthKey("2026-08")).toBe(true);
        expect(isMonthKey("0001-01")).toBe(true);
        for (const bad of ["2026-8", "26-08", "August", "2026-08-01", "", null, undefined, 202608]) {
            expect(isMonthKey(bad), `accepted ${String(bad)}`).toBe(false);
        }
    });

    it("orders months lexicographically, across a year boundary too", () => {
        expect(isLaterMonth("2026-09", "2026-08")).toBe(true);
        expect(isLaterMonth("2026-08", "2026-09")).toBe(false);
        expect(isLaterMonth("2026-08", "2026-08")).toBe(false);
        expect(isLaterMonth("2027-01", "2026-12")).toBe(true);
        expect(isLaterMonth("2026-12", "2027-01")).toBe(false);
    });
});

/**
 * A CLOCK THAT MOVES BACKWARDS USED TO ERASE A RECORDED MONTH, permanently and
 * silently, and hand back the whole cap budget with it. The old rule compared
 * the stored month to the clock's month for EQUALITY, so September's record read
 * as "not this month" in August and was discarded on the spot — and the next
 * translation wrote an August blob over it.
 *
 * That is not an exotic scenario: an NTP correction, a VM resumed from a
 * snapshot, a dual-boot machine writing local time to the RTC, or a user fixing
 * a wrong date all move a clock backwards, and only one of them needs to cross a
 * month boundary.
 */
describe("a clock that moves backwards cannot erase a recorded month", () => {
    const SEPTEMBER_BLOB = JSON.stringify({
        month: "2026-09",
        characters: { "google-cloud": 400_000 }
    });

    it("keeps September's record when the clock falls back into August", () => {
        const state = parseUsage(SEPTEMBER_BLOB, "2026-08");
        expect(state.month).toBe("2026-09");
        expect(state.characters).toEqual({ "google-cloud": 400_000 });
    });

    it("keeps it across a YEAR boundary — January's record survives a fall back to December", () => {
        const january = JSON.stringify({ month: "2027-01", characters: { "google-cloud": 123 } });
        const state = parseUsage(january, "2026-12");
        expect(state.month).toBe("2027-01");
        expect(state.characters).toEqual({ "google-cloud": 123 });
    });

    it("does not destroy the record on the NEXT write either, which is where it became permanent", () => {
        // The read alone was recoverable — nothing had been saved yet. What made
        // it permanent was the following record() writing a fresh earlier month
        // over the later one.
        const store = memoryStore(SEPTEMBER_BLOB);
        let clock = new Date(2026, 8, 15, 12, 0, 0);
        const meter = new UsageMeter(store, () => clock);

        clock = AUGUST();
        meter.record("google-cloud", ["hello"]);

        expect(JSON.parse(store.peek())).toEqual({
            month: "2026-09",
            characters: { "google-cloud": 400_005 }
        });
        // And the clock going forward again finds it all still there.
        clock = new Date(2026, 8, 20, 12, 0, 0);
        expect(meter.total()).toBe(400_005);
    });

    it("does not hand back a cap the user has already spent", async () => {
        const paid = fakeProvider("google-cloud");
        const store = memoryStore(JSON.stringify({ month: "2026-09", characters: { "google-cloud": 10 } }));
        let clock = new Date(2026, 8, 15, 12, 0, 0);
        const meter = new UsageMeter(store, () => clock);
        const wrapped = meteredProvider(paid.provider, meter, {
            monthlyCharacterCap: 10,
            reservations: new CapReservations()
        });

        await expect(wrapped.translate(["x"], "auto", "en")).rejects.toThrow(/cap/i);

        // Turn the clock back a month. The budget must not reappear.
        clock = AUGUST();
        await expect(wrapped.translate(["x"], "auto", "en")).rejects.toThrow(/cap/i);
        expect(paid.calls).toHaveLength(0);
    });

    it("still rolls forward normally — this is one-way, not frozen", () => {
        const state = parseUsage(SEPTEMBER_BLOB, "2026-10");
        expect(state).toEqual({ month: "2026-10", characters: {} });
    });

    it("would notice the old equality rule (positive control)", () => {
        // The rule that shipped. Given the same inputs it discards the record,
        // which is what every assertion above now denies.
        const oldRule = (storedMonth: string, month: string) => storedMonth === month;
        expect(oldRule("2026-09", "2026-08")).toBe(false);
        expect(parseUsage(SEPTEMBER_BLOB, "2026-08").characters).not.toEqual({});
    });

    it("reset() is the deliberate way out of a month key that ran ahead", () => {
        // parseUsage refuses to go backwards on its own. A user who knows the
        // clock was wrong says so with the panel's two-click reset, which is
        // explicitly destructive and is the only thing allowed to do this.
        const store = memoryStore(SEPTEMBER_BLOB);
        new UsageMeter(store, AUGUST).reset();
        expect(JSON.parse(store.peek())).toEqual({ month: "2026-08", characters: {} });
        expect(new UsageMeter(store, AUGUST).total()).toBe(0);
    });
});

describe("parseUsage tolerates a damaged blob instead of throwing on the translate path", () => {
    it("treats an empty, corrupt or non-object blob as a fresh month", () => {
        for (const bad of ["", "not json", "null", "[]", "42", '"x"']) {
            expect(parseUsage(bad, "2026-08")).toEqual({ month: "2026-08", characters: {} });
        }
    });

    it("drops counts that are not finite non-negative numbers", () => {
        const blob = JSON.stringify({
            month: "2026-08",
            characters: { good: 10, negative: -5, text: "9", nan: null }
        });
        expect(parseUsage(blob, "2026-08").characters).toEqual({ good: 10 });
    });

    it("a NaN count cannot survive to poison the cap comparison", () => {
        // JSON has no NaN literal, so this is the shape a hand-edited or
        // half-written file produces. If it survived, used + n > cap would be
        // false forever and the cap would silently fail open.
        const meter = new UsageMeter(memoryStore('{"month":"2026-08","characters":{"a":null}}'), AUGUST);
        expect(Number.isFinite(meter.total())).toBe(true);
        expect(meter.total()).toBe(0);
    });
});

describe("which providers are metered", () => {
    it("meters the two the user pays for", () => {
        expect(isBilledProvider("google-cloud")).toBe(true);
        expect(isBilledProvider("deepl")).toBe(true);
    });

    it("does not meter the free keyless endpoint", () => {
        expect(isBilledProvider("google")).toBe(false);
    });

    it("hands the free provider back BY IDENTITY — the same object, not a wrapper", () => {
        const free = fakeProvider("google");
        const meter = new UsageMeter(memoryStore(), AUGUST);
        expect(meterIfBilled(free.provider, meter, { monthlyCharacterCap: 1 })).toBe(free.provider);
    });

    it("wraps a billed provider", () => {
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(), AUGUST);
        expect(meterIfBilled(paid.provider, meter)).not.toBe(paid.provider);
    });

    it("the free provider still translates, counts nothing, and ignores a cap of 1", async () => {
        const free = fakeProvider("google");
        const store = memoryStore();
        const meter = new UsageMeter(store, AUGUST);
        const wrapped = meterIfBilled(free.provider, meter, { monthlyCharacterCap: 1 });

        const out = await wrapped.translate(["a".repeat(5000)], "auto", "en");

        expect(out).toHaveLength(1);
        expect(free.calls).toHaveLength(1);
        expect(meter.total()).toBe(0);
        // Nothing was written at all — not a zero, not an empty month record.
        expect(store.peek()).toBe("");
    });
});

describe("the metered provider counts what is actually sent", () => {
    it("records the exact strings handed to the provider and passes them through untouched", async () => {
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const wrapped = meteredProvider(paid.provider, meter);

        const results = await wrapped.translate(["\u4f60\u597d\u55ce", "see 0 now"], "auto", "en");

        // One send per text, in order, each string byte-identical to what the
        // caller passed. The batching changed; the strings did not.
        expect(paid.calls).toEqual([["\u4f60\u597d\u55ce"], ["see 0 now"]]);
        // The caller still gets one flat array, in the original order.
        expect(results.map(r => r.text)).toEqual(["\u4f60\u597d\u55ce", "see 0 now"]);
        // 3 Han characters + "see " (4) + OPEN + "0" + CLOSE (3) + " now" (4) = 14.
        expect(meter.charactersFor("google-cloud")).toBe(3 + 11);
    });

    it("passes from and to through unchanged on every per-text send", async () => {
        const seen: Array<[string, string]> = [];
        const inner: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts, from, to) {
                seen.push([from, to]);
                return texts.map(text => ({ text, sourceLang: "ja", confidence: 0 }));
            }
        };
        await meteredProvider(inner, new UsageMeter(memoryStore(), AUGUST))
            .translate(["a", "b", "c"], "auto", "zh-TW");

        expect(seen).toEqual([["auto", "zh-TW"], ["auto", "zh-TW"], ["auto", "zh-TW"]]);
    });

    it("sends nothing at all for an empty batch, because Google charges for empty queries", async () => {
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(), AUGUST);

        await expect(meteredProvider(paid.provider, meter).translate([], "auto", "en")).resolves.toEqual([]);

        expect(paid.calls).toEqual([]);
        expect(meter.total()).toBe(0);
    });

    it("keeps id, label and needsKey so the wrapper is invisible to callers", () => {
        const inner: TranslationProvider = {
            id: "google-cloud",
            label: "Google Cloud Translation (your own key)",
            needsKey: true,
            translate: async () => []
        };
        const wrapped = meteredProvider(inner, new UsageMeter(memoryStore(), AUGUST));
        expect(wrapped.id).toBe(inner.id);
        expect(wrapped.label).toBe(inner.label);
        expect(wrapped.needsKey).toBe(true);
    });

    it("counts a text whose failure carries a real HTTP status: it was sent, so it was billed", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const exploding: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            translate: async () => { throw Object.assign(new Error("google-cloud: HTTP 500"), { status: 500 }); }
        };

        await expect(meteredProvider(exploding, meter).translate(["abcde"], "auto", "en"))
            .rejects.toThrow("HTTP 500");
        expect(meter.total()).toBe(5);
    });

    it("counts a status-less failure, because on a billed provider that is a 200 that would not parse", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const unparseable: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            translate: async () => { throw permanentError("google-cloud: HTTP 200 whose body was not JSON"); }
        };

        await expect(meteredProvider(unparseable, meter).translate(["abcde"], "auto", "en")).rejects.toThrow();
        // The charge is incurred when the 200 arrives, not when it parses. A
        // spend cap that under-counts trips late, which is overspend.
        expect(meter.total()).toBe(5);
    });

    it("COUNTS a status-0 failure, because status 0 is a timeout as often as a local refusal", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const zero: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            // Exactly what both billed providers throw when a transport answers
            // { status: 0, … } — and note what is NOT here: the transport's body.
            // The providers discard it, so this error cannot say whether it was
            // "blocked: <host>" (never sent), "translation request timed out"
            // (sent, 20s elapsed, almost certainly billed), a refused redirect
            // (sent), a blocked response origin (sent), or a fetch that threw.
            translate: async () => { throw Object.assign(new Error("google-cloud: HTTP 0"), { status: 0 }); }
        };

        await expect(meteredProvider(zero, meter).translate(["abcde"], "auto", "en")).rejects.toThrow();
        // It used to be 0. Under-counting hides real spend from the meter AND
        // from the cap, and a timeout is exactly what an expensive request does.
        expect(meter.total()).toBe(5);
    });

    it("counts only the texts that were reached when a batch dies part-way through", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const sent: string[] = [];
        const dyingOnSecond: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(...texts);
                if (texts[0] === "bb") throw Object.assign(new Error("HTTP 500"), { status: 500 });
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };

        await expect(meteredProvider(dyingOnSecond, meter).translate(["a", "bb", "cccccc"], "auto", "en"))
            .rejects.toThrow("HTTP 500");

        // "cccccc" was never reached, so it is never billed. The old meter
        // recorded all three up front and charged for all nine characters.
        expect(sent).toEqual(["a", "bb"]);
        expect(meter.total()).toBe(1 + 2);
    });

    it("a scheduler retry resumes at the text that failed instead of re-sending the batch", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const sent: string[] = [];
        let attempt = 0;
        const flaky: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(...texts);
                // Fails on the second text of the first attempt only.
                if (texts[0] === "bb" && attempt === 0) {
                    attempt++;
                    throw Object.assign(new Error("HTTP 503"), { status: 503 });
                }
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(flaky, meter);
        const scheduler = new Scheduler({
            concurrency: 1, maxRetries: 3, baseDelayMs: 1, breakerThreshold: 5,
            sleep: async () => undefined
        });

        const out = await scheduler.run(() => wrapped.translate(["a", "bb", "ccc"], "auto", "en"));

        // "a" came back on attempt 1, so attempt 2 does not buy it again. This
        // assertion, not the total below, is the one that fails if the memo goes.
        expect(sent).toEqual(["a", "bb", "bb", "ccc"]);
        // 1 + 2 + 2 + 3 = 8. Before the memo this was 9 for the same translation
        // — and before the per-text loop, 6 + 6 = 12.
        expect(meter.total()).toBe(8);
        // The caller still gets the whole batch, in its original order.
        expect(out.map(r => r.text)).toEqual(["a", "bb", "ccc"]);
    });

    /**
     * THE OVERSPEND, AT THE SIZE IT WAS MEASURED.
     *
     * A 20-line message whose LAST line 503s on every attempt, driven through the
     * real Scheduler with the shipped maxRetries of 3. This produced 80 HTTP
     * sends and 1,536 characters billed where a clean pass needs 20 and 384 — a
     * 4.0x multiplier on a provider the user pays for, because the closure
     * re-sent the whole line array on every attempt.
     *
     * Note what is pinned and what is NOT. The 19 lines that succeeded are pinned
     * at exactly one send each — 1.0x, the whole of the overspend. The line that
     * failed is sent once per attempt, because that is what a retry IS; an
     * overall 1.0x would mean not retrying at all.
     */
    it("does not re-bill the 19 lines that succeeded when the 20th keeps failing", async () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line number ${i + 1} of the message`);
        const doomed = lines[19];
        const cleanPass = countBatch(lines);
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const sent: string[] = [];
        const lastLineAlwaysFails: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(...texts);
                if (texts[0] === doomed) throw Object.assign(new Error("HTTP 503"), { status: 503 });
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(lastLineAlwaysFails, meter);
        const scheduler = new Scheduler({
            concurrency: 1, maxRetries: 3, baseDelayMs: 1, breakerThreshold: 5,
            sleep: async () => undefined
        });

        await expect(scheduler.run(() => wrapped.translate([...lines], "auto", "en")))
            .rejects.toThrow("HTTP 503");

        // 1.0x on every line that succeeded — each sent exactly once across all
        // four attempts.
        for (const line of lines.slice(0, 19)) {
            expect(sent.filter(t => t === line), `re-sent: ${line}`).toHaveLength(1);
        }
        // The failing line, once per attempt: maxRetries 3 means 4 attempts.
        expect(sent.filter(t => t === doomed)).toHaveLength(4);
        expect(sent).toHaveLength(23);
        expect(meter.total()).toBe(cleanPass + 3 * countCodePoints(doomed));

        // The measured numbers this replaces, so a regression is unmistakable
        // rather than a slightly larger total nobody notices.
        expect(sent.length).toBeLessThan(80);
        expect(meter.total()).toBeLessThan(4 * cleanPass);
    });

    /**
     * THE DECISION, STATED ONCE: every failure that reaches the meter counts.
     *
     * Not a shrug — the evidence changed. Status 0 was treated as proof that a
     * transport had refused the request locally, and it is not: all three
     * transports return status 0 for a blocked host (never sent), a REFUSED
     * REDIRECT and a BLOCKED RESPONSE ORIGIN (both after a reply arrived, so
     * already billed), a 20-second TIMEOUT (almost certainly billed), and a
     * fetch that threw (either). Both billed providers then discard the body
     * that would tell them apart. One of five classes is provably unsent and the
     * old rule discarded all five.
     *
     * The tie goes upward. Over-counting trips the user's own cap early, which
     * is free, visible and reversible from the panel; under-counting trips it
     * late, which is money on a real invoice that the cap existed to stop.
     */
    it("wasSent() counts every failure, including the status-0 classes that were billed", () => {
        expect(wasSent(Object.assign(new Error("google-cloud: HTTP 0"), { status: 0 }))).toBe(true);
        expect(wasSent(Object.assign(new Error("x"), { status: TRANSPORT_REFUSED_STATUS }))).toBe(true);
        expect(wasSent(Object.assign(new Error("x"), { status: 429 }))).toBe(true);
        expect(wasSent(Object.assign(new Error("x"), { status: 200 }))).toBe(true);
        expect(wasSent(new Error("no status at all"))).toBe(true);
        expect(wasSent(permanentError("200 that would not parse"))).toBe(true);
        expect(wasSent(undefined)).toBe(true);
        expect(wasSent(null)).toBe(true);
        expect(wasSent("a thrown string")).toBe(true);
    });

    it("the status the transports agree on is still pinned, it just no longer decides billing", () => {
        // Kept because native.ts, translationHost.js and translationBridge.ts all
        // return it; dropped as a billing signal because they return it for
        // post-send failures too.
        expect(TRANSPORT_REFUSED_STATUS).toBe(0);
    });

    it("keeps each provider's characters separate while capping on the total", async () => {
        const meter = new UsageMeter(memoryStore(), AUGUST);
        await meteredProvider(fakeProvider("google-cloud").provider, meter).translate(["abc"], "auto", "en");
        await meteredProvider(fakeProvider("deepl").provider, meter).translate(["de"], "auto", "en");

        expect(meter.charactersFor("google-cloud")).toBe(3);
        expect(meter.charactersFor("deepl")).toBe(2);
        expect(meter.total()).toBe(5);
    });
});

/**
 * The memo that stops the re-billing is the most dangerous thing in this file:
 * a stale hit would put someone else's translation on screen, which is far worse
 * than paying twice. These are the fences, asserted one at a time.
 */
describe("the retry memo cannot serve the wrong text", () => {
    it("does not survive a completed batch — the same call made twice really sends twice", async () => {
        const paid = fakeProvider("google-cloud");
        const wrapped = meteredProvider(paid.provider, new UsageMeter(memoryStore(), AUGUST));

        await wrapped.translate(["hello"], "auto", "en");
        await wrapped.translate(["hello"], "auto", "en");

        // A memo that outlived the call would show one send here.
        expect(paid.calls).toEqual([["hello"], ["hello"]]);
    });

    it("cannot hand a later message an earlier message's translation", async () => {
        const sent: string[] = [];
        let failing = true;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(...texts);
                if (failing && texts[0] === "second line of A") {
                    throw Object.assign(new Error("HTTP 503"), { status: 503 });
                }
                return texts.map(text => ({ text: `${text} -> translated`, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(provider, new UsageMeter(memoryStore(), AUGUST));

        // Message A dies part-way, leaving its first line memoised.
        await expect(wrapped.translate(["first line of A", "second line of A"], "auto", "en"))
            .rejects.toThrow("HTTP 503");

        // Message B is a different batch. Its one line must be SENT and answered
        // with its own translation, never with A's.
        failing = false;
        const out = await wrapped.translate(["only line of B"], "auto", "en");

        expect(out.map(r => r.text)).toEqual(["only line of B -> translated"]);
        expect(sent).toEqual(["first line of A", "second line of A", "only line of B"]);
    });

    it("treats a changed target language as a different batch", async () => {
        const sent: Array<[string, string]> = [];
        let failing = true;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts, _from, to) {
                sent.push([texts[0], to]);
                if (failing && texts[0] === "b") throw Object.assign(new Error("HTTP 503"), { status: 503 });
                return texts.map(text => ({ text: `${text}@${to}`, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(provider, new UsageMeter(memoryStore(), AUGUST));

        await expect(wrapped.translate(["a", "b"], "auto", "en")).rejects.toThrow("HTTP 503");
        failing = false;
        const out = await wrapped.translate(["a", "b"], "auto", "ja");

        // Nothing is answered in the language of the previous attempt.
        expect(out.map(r => r.text)).toEqual(["a@ja", "b@ja"]);
        expect(sent).toEqual([["a", "en"], ["b", "en"], ["a", "ja"], ["b", "ja"]]);
    });

    it("treats an edited line as a different batch", async () => {
        const sent: string[] = [];
        let failing = true;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(texts[0]);
                if (failing && texts[0] === "second") throw Object.assign(new Error("HTTP 503"), { status: 503 });
                return texts.map(text => ({ text: `${text}!`, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(provider, new UsageMeter(memoryStore(), AUGUST));

        await expect(wrapped.translate(["first", "second"], "auto", "en")).rejects.toThrow();
        failing = false;
        // "first" is unchanged but the message is not — the batch key is the
        // whole array, so nothing is carried over.
        const out = await wrapped.translate(["first", "second EDITED"], "auto", "en");

        expect(out.map(r => r.text)).toEqual(["first!", "second EDITED!"]);
        expect(sent).toEqual(["first", "second", "first", "second EDITED"]);
    });

    it("does not memoise a text whose send failed, however it failed", async () => {
        const sent: string[] = [];
        let failures = 2;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                sent.push(texts[0]);
                if (failures > 0) {
                    failures--;
                    throw Object.assign(new Error("HTTP 503"), { status: 503 });
                }
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(provider, new UsageMeter(memoryStore(), AUGUST));
        const scheduler = new Scheduler({
            concurrency: 1, maxRetries: 3, baseDelayMs: 1, breakerThreshold: 5,
            sleep: async () => undefined
        });

        await expect(scheduler.run(() => wrapped.translate(["only"], "auto", "en"))).resolves.toHaveLength(1);
        // Three sends, not one: a failure is never a result, so it is never
        // memoised and the retry really does try again.
        expect(sent).toEqual(["only", "only", "only"]);
    });
});

describe("the cap is a reservation, so concurrent batches cannot walk past it", () => {
    /** The shape state.ts produces: one wrapper per message over one shared store and ledger. */
    function fleet(store: UsageStore, reservations: CapReservations, cap: number, sent: string[]) {
        return () => {
            const provider: TranslationProvider = {
                id: "google-cloud",
                label: "x",
                needsKey: true,
                async translate(texts) {
                    // The await the old check-then-act let the other callers
                    // through. Without a yield here there is no race to lose.
                    await Promise.resolve();
                    sent.push(...texts);
                    return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
                }
            };
            return meteredProvider(provider, new UsageMeter(store, AUGUST), {
                monthlyCharacterCap: cap,
                reservations
            });
        };
    }

    it("refuses two of three concurrent 60-character batches under a cap of 100", async () => {
        const store = memoryStore();
        const reservations = new CapReservations();
        const sent: string[] = [];
        const make = fleet(store, reservations, 100, sent);
        const scheduler = new Scheduler({
            concurrency: 3, maxRetries: 3, baseDelayMs: 1, breakerThreshold: 99,
            sleep: async () => undefined
        });
        const body = "x".repeat(60);

        const outcomes = await Promise.allSettled([
            scheduler.run(() => make().translate([body], "auto", "en")),
            scheduler.run(() => make().translate([body], "auto", "en")),
            scheduler.run(() => make().translate([body], "auto", "en"))
        ]);

        // Measured before the reservation: all three succeeded and 180 characters
        // were recorded — 80% past the user's own cap.
        expect(new UsageMeter(store, AUGUST).total()).toBe(60);
        expect(new UsageMeter(store, AUGUST).total()).toBeLessThanOrEqual(100);
        expect(sent).toEqual([body]);
        expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);

        // Both refusals are the user's own cap speaking, not a provider error —
        // otherwise the message sends people to the Google Cloud console.
        for (const outcome of outcomes) {
            if (outcome.status === "rejected") expect(isCapRefusal(outcome.reason)).toBe(true);
        }
        // Nothing is still held once they have all finished.
        expect(reservations.outstanding).toBe(0);
    });

    it("says so when the refusal was caused by characters still in flight", async () => {
        const store = memoryStore();
        const reservations = new CapReservations();
        const make = fleet(store, reservations, 100, []);

        const [, second] = await Promise.allSettled([
            make().translate(["x".repeat(60)], "auto", "en"),
            make().translate(["x".repeat(60)], "auto", "en")
        ]);

        expect(second.status).toBe("rejected");
        const message = String((second as PromiseRejectedResult).reason.message);
        // Without this clause the arithmetic reads as "0 sent, 60 needed, cap
        // 100, refused" and sends the user hunting for a bug that is not there.
        expect(message).toContain("already in flight");
        expect(message).toContain("60");
    });

    it("holds nothing back when a message is refused, so the cap cannot drift closed", async () => {
        const reservations = new CapReservations();
        const paid = fakeProvider("google-cloud");
        const wrapped = meteredProvider(paid.provider, new UsageMeter(memoryStore(), AUGUST), {
            monthlyCharacterCap: 5,
            reservations
        });

        for (let i = 0; i < 20; i++) {
            await expect(wrapped.translate(["far too long for this cap"], "auto", "en")).rejects.toThrow();
        }

        expect(reservations.outstanding).toBe(0);
        // Twenty refusals have not eaten the budget.
        await expect(wrapped.translate(["ok"], "auto", "en")).resolves.toHaveLength(1);
    });

    it("releases the reservation when the send throws, not only when it succeeds", async () => {
        const store = memoryStore();
        const reservations = new CapReservations();
        let explode = true;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                await Promise.resolve();
                if (explode) throw Object.assign(new Error("google-cloud: HTTP 0"), { status: 0 });
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const make = () => meteredProvider(provider, new UsageMeter(store, AUGUST), {
            monthlyCharacterCap: 100,
            reservations
        });

        await expect(make().translate(["abcdefghij"], "auto", "en")).rejects.toThrow("HTTP 0");
        // A status-0 failure is counted now — it may have been a timeout on a
        // request that was delivered and billed …
        expect(new UsageMeter(store, AUGUST).total()).toBe(10);
        // … and nothing is still held. A leaked reservation here would strangle
        // the cap shut for the rest of the session, whether or not the send
        // counted: the two are separate, and this is the one being asserted.
        expect(reservations.outstanding).toBe(0);

        explode = false;
        await expect(make().translate(["abcdefghij"], "auto", "en")).resolves.toHaveLength(1);
        expect(new UsageMeter(store, AUGUST).total()).toBe(20);
        expect(reservations.outstanding).toBe(0);
    });

    it("gives back only the part that was never spent when a batch dies part-way", async () => {
        const store = memoryStore();
        const reservations = new CapReservations();
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                await Promise.resolve();
                if (texts[0] === "bbbb") throw Object.assign(new Error("HTTP 0"), { status: 0 });
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const wrapped = meteredProvider(provider, new UsageMeter(store, AUGUST), {
            monthlyCharacterCap: 100,
            reservations
        });

        await expect(wrapped.translate(["aa", "bbbb", "cccccc"], "auto", "en")).rejects.toThrow();

        // "aa" came back and "bbbb" failed at status 0, which is counted — it
        // may have been delivered. "cccccc" was never reached, so it is not
        // counted, which is what the per-text loop exists for. None of the
        // twelve reserved characters is still held.
        expect(new UsageMeter(store, AUGUST).total()).toBe(6);
        expect(reservations.outstanding).toBe(0);
    });

    it("checks a retry against what it will RE-SEND, not against the whole message again", async () => {
        const store = memoryStore();
        const reservations = new CapReservations();
        let failing = true;
        const provider: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                if (failing && texts[0] === "bbbbb") {
                    failing = false;
                    throw Object.assign(new Error("HTTP 503"), { status: 503 });
                }
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        // Cap 20 against a 15-character message. Attempt 1 spends 10 ("aaaaa"
        // plus the failed "bbbbb", which really was sent). Attempt 2 needs 10
        // more, which fits. Re-checking the whole 15 would make it 25 and refuse
        // the message's own retry.
        const wrapped = meteredProvider(provider, new UsageMeter(store, AUGUST), {
            monthlyCharacterCap: 20,
            reservations
        });
        const scheduler = new Scheduler({
            concurrency: 1, maxRetries: 3, baseDelayMs: 1, breakerThreshold: 5,
            sleep: async () => undefined
        });

        await expect(scheduler.run(() => wrapped.translate(["aaaaa", "bbbbb", "ccccc"], "auto", "en")))
            .resolves.toHaveLength(3);

        expect(new UsageMeter(store, AUGUST).total()).toBe(20);
        expect(reservations.outstanding).toBe(0);
    });

    it("reserves nothing at all when the cap is off", async () => {
        const reservations = new CapReservations();
        const paid = fakeProvider("google-cloud");
        const wrapped = meteredProvider(paid.provider, new UsageMeter(memoryStore(), AUGUST), {
            monthlyCharacterCap: 0,
            reservations
        });

        await wrapped.translate(["x".repeat(1_000)], "auto", "en");

        expect(paid.calls).toHaveLength(1);
        expect(reservations.outstanding).toBe(0);
    });

    it("uses the process-wide ledger when none is given, which is what production relies on", async () => {
        // state.ts builds a wrapper per message and passes no ledger, so the only
        // thing that can see across those wrappers is the module-level default.
        expect(reservedCharacters()).toBe(0);

        const store = memoryStore();
        const cap = 100;
        let release: (() => void) | undefined;
        const held = new Promise<void>(resolve => { release = resolve; });

        const slow: TranslationProvider = {
            id: "google-cloud",
            label: "x",
            needsKey: true,
            async translate(texts) {
                await held;
                return texts.map(text => ({ text, sourceLang: "en", confidence: 0 }));
            }
        };
        const first = meteredProvider(slow, new UsageMeter(store, AUGUST), { monthlyCharacterCap: cap })
            .translate(["x".repeat(60)], "auto", "en");

        // The first send is parked mid-flight, and the default ledger knows it.
        expect(reservedCharacters()).toBe(60);

        const second = meteredProvider(fakeProvider("google-cloud").provider,
            new UsageMeter(store, AUGUST), { monthlyCharacterCap: cap })
            .translate(["x".repeat(60)], "auto", "en");
        await expect(second).rejects.toThrow(/Monthly character cap reached/);

        release!();
        await first;
        // Back to zero, so this test cannot poison any that follow it.
        expect(reservedCharacters()).toBe(0);
        expect(new UsageMeter(store, AUGUST).total()).toBe(60);
    });

    it("CapReservations refuses without consuming budget and clamps a double release", () => {
        const reservations = new CapReservations();

        expect(reservations.tryReserve(60, 100, 0)).toBe(true);
        expect(reservations.outstanding).toBe(60);
        // Refused, and — the part that matters — nothing was taken.
        expect(reservations.tryReserve(60, 100, 0)).toBe(false);
        expect(reservations.outstanding).toBe(60);
        // Exactly on the cap is allowed; one past it is not.
        expect(reservations.tryReserve(40, 100, 0)).toBe(true);
        expect(reservations.tryReserve(1, 100, 0)).toBe(false);
        // Characters already recorded count too.
        expect(new CapReservations().tryReserve(10, 100, 91)).toBe(false);
        expect(new CapReservations().tryReserve(10, 100, 90)).toBe(true);

        reservations.release(1_000);
        expect(reservations.outstanding).toBe(0);
        reservations.release(1_000);
        expect(reservations.outstanding).toBe(0);
    });
});

describe("the cap is off by default", () => {
    it("sends a million characters when no cap option is given at all", async () => {
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const wrapped = meteredProvider(paid.provider, meter);

        await wrapped.translate(["x".repeat(1_000_000)], "auto", "en");

        expect(paid.calls).toHaveLength(1);
        expect(meter.total()).toBe(1_000_000);
    });

    it("treats 0 as off, which is the value the setting ships with", async () => {
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(), AUGUST);
        const wrapped = meteredProvider(paid.provider, meter, { monthlyCharacterCap: 0 });

        await wrapped.translate(["x".repeat(1_000_000)], "auto", "en");

        expect(paid.calls).toHaveLength(1);
    });

    it("does not break an existing user who already has characters recorded", async () => {
        const blob = JSON.stringify({ month: "2026-08", characters: { "google-cloud": 4_000_000 } });
        const paid = fakeProvider("google-cloud");
        const meter = new UsageMeter(memoryStore(blob), AUGUST);

        await meteredProvider(paid.provider, meter).translate(["still works"], "auto", "en");

        expect(paid.calls).toHaveLength(1);
    });
});

describe("the cap trips", () => {
    async function capped(cap: number, initial = "") {
        const paid = fakeProvider("google-cloud");
        const store = memoryStore(initial);
        const meter = new UsageMeter(store, AUGUST);
        return { paid, store, meter, wrapped: meteredProvider(paid.provider, meter, { monthlyCharacterCap: cap }) };
    }

    it("allows a batch that lands exactly on the cap and refuses the one after", async () => {
        const { paid, wrapped, meter } = await capped(10);

        await wrapped.translate(["abcdefghij"], "auto", "en");
        expect(meter.total()).toBe(10);
        expect(paid.calls).toHaveLength(1);

        await expect(wrapped.translate(["k"], "auto", "en")).rejects.toThrow(/Monthly character cap reached/);
        expect(paid.calls).toHaveLength(1);
    });

    it("never reaches the provider and never counts the characters it refused", async () => {
        const { paid, wrapped, meter } = await capped(10);
        await expect(wrapped.translate(["a".repeat(50)], "auto", "en")).rejects.toThrow();
        expect(paid.calls).toEqual([]);
        expect(meter.total()).toBe(0);
    });

    it("refuses the whole batch rather than sending part of it", async () => {
        const { paid, wrapped, meter } = await capped(10);
        await expect(wrapped.translate(["abcde", "fghijk"], "auto", "en")).rejects.toThrow();
        expect(paid.calls).toEqual([]);
        expect(meter.total()).toBe(0);
    });

    it("names the cap and says it is the user's own setting, not a Google error", async () => {
        const { wrapped } = await capped(1_000);
        const err = await wrapped.translate(["a".repeat(2_000)], "auto", "en").catch(e => e as Error);

        expect(err.message).toContain("1,000");
        expect(err.message).toContain("2,000");
        expect(err.message).toContain("2026-08");
        expect(err.message).toContain("ChannelTranslator's settings");
        expect(err.message).toContain("not an error from Google");
        expect(err.message).toContain("set it to 0");
    });

    it("is marked so the caller can tell it apart from a provider failure", async () => {
        const { wrapped } = await capped(1);
        const err = await wrapped.translate(["too long"], "auto", "en").catch(e => e);
        expect(isCapRefusal(err)).toBe(true);
        expect(isCapRefusal(new Error("HTTP 500"))).toBe(false);
        expect(isCapRefusal(undefined)).toBe(false);
        expect(isCapRefusal(null)).toBe(false);
    });

    it("is PERMANENT to the scheduler, so it is never retried", async () => {
        const { wrapped } = await capped(1);
        const err = await wrapped.translate(["too long"], "auto", "en").catch(e => e);
        expect(isPermanent(err)).toBe(true);
    });

    it("is not retried and does not open the breaker, driven through the real Scheduler", async () => {
        const { paid, wrapped } = await capped(1);
        let slept = 0;
        const scheduler = new Scheduler({
            concurrency: 1,
            maxRetries: 3,
            baseDelayMs: 1,
            breakerThreshold: 5,
            sleep: async () => { slept++; }
        });

        for (let i = 0; i < 8; i++) {
            await scheduler.run(() => wrapped.translate(["too long"], "auto", "en")).catch(() => undefined);
        }

        // Eight refusals, well past a breakerThreshold of five.
        expect(scheduler.state).toBe("closed");
        // maxRetries is 3, so an error the scheduler thought transient would have
        // slept 3 times per call — 24 sleeps — and hit the provider 32 times.
        expect(slept).toBe(0);
        expect(paid.calls).toEqual([]);
    });

    it("lets the free provider keep working while a paid one is capped", async () => {
        const store = memoryStore();
        const meter = new UsageMeter(store, AUGUST);
        const paid = fakeProvider("google-cloud");
        const free = fakeProvider("google");

        const cappedPaid = meterIfBilled(paid.provider, meter, { monthlyCharacterCap: 1 });
        const stillFree = meterIfBilled(free.provider, meter, { monthlyCharacterCap: 1 });

        await expect(cappedPaid.translate(["too long"], "auto", "en")).rejects.toThrow();
        await expect(stillFree.translate(["also long"], "auto", "en")).resolves.toHaveLength(1);
    });
});

describe("the cap releases", () => {
    it("releases when the user resets the counter", async () => {
        const paid = fakeProvider("google-cloud");
        const store = memoryStore();
        const meter = new UsageMeter(store, AUGUST);
        const wrapped = meteredProvider(paid.provider, meter, { monthlyCharacterCap: 10 });

        await wrapped.translate(["abcdefghij"], "auto", "en");
        await expect(wrapped.translate(["k"], "auto", "en")).rejects.toThrow();

        meter.reset();

        expect(meter.total()).toBe(0);
        await expect(wrapped.translate(["k"], "auto", "en")).resolves.toHaveLength(1);
        expect(paid.calls).toHaveLength(2);
    });

    it("reset writes through the store, so it survives a restart and is not just in memory", () => {
        const store = memoryStore(JSON.stringify({ month: "2026-08", characters: { "google-cloud": 500 } }));
        new UsageMeter(store, AUGUST).reset();
        expect(JSON.parse(store.peek())).toEqual({ month: "2026-08", characters: {} });
        expect(new UsageMeter(store, AUGUST).total()).toBe(0);
    });

    it("releases by itself when the month rolls over", async () => {
        const paid = fakeProvider("google-cloud");
        let clock = AUGUST();
        const meter = new UsageMeter(memoryStore(), () => clock);
        const wrapped = meteredProvider(paid.provider, meter, { monthlyCharacterCap: 10 });

        await wrapped.translate(["abcdefghij"], "auto", "en");
        await expect(wrapped.translate(["k"], "auto", "en")).rejects.toThrow();

        clock = SEPTEMBER();

        await expect(wrapped.translate(["k"], "auto", "en")).resolves.toHaveLength(1);
        expect(meter.total()).toBe(1);
        expect(meter.snapshot().month).toBe("2026-09");
    });
});

/**
 * The two rules above that live in settings.ts rather than in core/ — the cap
 * ships OFF, and the meter is shown next to the key that causes the spend.
 *
 * settings.ts cannot be imported here: it pulls @api/Settings, which needs a
 * running client. A source scan is the only thing that can fail when someone
 * changes the shipped default, and a default that silently became non-zero
 * would break translation for every existing user on their first busy month.
 */
describe("what settings.ts actually ships", () => {
    const SETTINGS = join(process.cwd(), "src", "plugins", "channelTranslator", "settings.ts");

    function source(): string {
        return readFileSync(SETTINGS, "utf8");
    }

    /** The text of one setting's object literal, from its key to its closing brace. */
    function block(name: string): string {
        const src = source();
        const start = src.indexOf(`${name}: {`);
        expect(start, `${name} was not found in ${SETTINGS}`).toBeGreaterThan(-1);
        const end = src.indexOf("\n    },", start);
        return src.slice(start, end === -1 ? src.length : end);
    }

    it("the file it claims to scan exists and is not empty", () => {
        expect(source().length).toBeGreaterThan(0);
    });

    it("ships the cap switched OFF — default 0", () => {
        expect(block("monthlyCharacterCap")).toMatch(/default:\s*0\s*,/);
    });

    it("would notice a non-zero default (positive control)", () => {
        const mutated = "monthlyCharacterCap: {\n        default: 100000,";
        expect(/default:\s*0\s*,/.test(mutated)).toBe(false);
    });

    it("persists the count in its own hidden setting", () => {
        const usage = block("usageBlob");
        expect(usage).toMatch(/hidden:\s*true/);
        expect(usage).toMatch(/default:\s*""/);
    });

    it("shows the meter next to the key that causes the spend", () => {
        const src = source();
        const key = src.indexOf("googleCloudApiKey: {");
        const meter = src.indexOf("usageSummary: {");
        const dms = src.indexOf("includeDMs: {");
        expect(key).toBeGreaterThan(-1);
        expect(meter).toBeGreaterThan(key);
        expect(meter).toBeLessThan(dms);
    });
});

/**
 * The poison-message loop, unit-testable because the thing that closes it lives
 * in core/ with the meter. state.ts itself cannot be imported here — it pulls
 * @api/MessageUpdater and @webpack/common, which need a running client — so the
 * wiring is asserted separately by test/meteredProviderChokepoint.test.ts.
 */
describe("PermanentFailureRegistry — the unmetered retry loop", () => {
    it("remembers a marked key and forgets nothing else", () => {
        const registry = new PermanentFailureRegistry();
        expect(registry.has("abc:en")).toBe(false);
        registry.mark("abc:en");
        expect(registry.has("abc:en")).toBe(true);
        expect(registry.has("abc:ja")).toBe(false);
        expect(registry.has("def:en")).toBe(false);
    });

    it("marking twice is not two entries", () => {
        const registry = new PermanentFailureRegistry();
        registry.mark("abc:en");
        registry.mark("abc:en");
        expect(registry.size).toBe(1);
    });

    it("clear() forgets everything, which is what a new provider or key must do", () => {
        const registry = new PermanentFailureRegistry();
        registry.mark("abc:en");
        registry.mark("def:en");
        registry.clear();
        expect(registry.size).toBe(0);
        expect(registry.has("abc:en")).toBe(false);
    });

    it("is bounded — it cannot grow without limit across a long session", () => {
        const registry = new PermanentFailureRegistry(3);
        registry.mark("a");
        registry.mark("b");
        registry.mark("c");
        registry.mark("d");

        expect(registry.size).toBe(3);
        // "a" is the oldest and is the one dropped.
        expect(registry.has("a")).toBe(false);
        expect(registry.has("b")).toBe(true);
        expect(registry.has("d")).toBe(true);
    });

    it("re-marking moves an entry to the back, so a message that keeps failing is not evicted first", () => {
        const registry = new PermanentFailureRegistry(2);
        registry.mark("a");
        registry.mark("b");
        registry.mark("a");
        registry.mark("c");

        expect(registry.has("b")).toBe(false);
        expect(registry.has("a")).toBe(true);
        expect(registry.has("c")).toBe(true);
    });

    it("defaults to the same bound as the translation cache, so the two cannot drift", () => {
        expect(MAX_TRACKED_PERMANENT_FAILURES).toBe(5_000);
        const registry = new PermanentFailureRegistry();
        for (let i = 0; i < MAX_TRACKED_PERMANENT_FAILURES + 10; i++) registry.mark(`k${i}`);
        expect(registry.size).toBe(MAX_TRACKED_PERMANENT_FAILURES);
    });

    it("would notice an unbounded registry (positive control)", () => {
        // If mark() ever stopped evicting, this is the shape that would fail.
        const registry = new PermanentFailureRegistry(2);
        registry.mark("a");
        registry.mark("b");
        registry.mark("c");
        expect(registry.size).not.toBe(3);
    });
});

describe("CapNoticeGate — one banner per cap-trip episode", () => {
    it("claims once and then refuses, however many messages trip the cap", () => {
        const gate = new CapNoticeGate();
        expect(gate.claim()).toBe(true);
        expect(gate.claim()).toBe(false);
        expect(gate.claim()).toBe(false);
    });

    it("reset() starts a new episode", () => {
        const gate = new CapNoticeGate();
        expect(gate.claim()).toBe(true);
        gate.reset();
        expect(gate.claim()).toBe(true);
    });

    it("exposes whether it is armed without spending the claim", () => {
        const gate = new CapNoticeGate();
        expect(gate.armed).toBe(true);
        expect(gate.armed).toBe(true);
        gate.claim();
        expect(gate.armed).toBe(false);
    });

    it("is needed because the refusal text cannot dedupe itself — `requested` differs per message", () => {
        // This is the exact reason warnProviderUnavailable's own
        // `reason === reasonShown` check never fires for a cap refusal.
        const first = capRefusalMessage(1_000, 900, 200, "2026-08");
        const second = capRefusalMessage(1_000, 900, 201, "2026-08");
        expect(first).not.toBe(second);

        const gate = new CapNoticeGate();
        const shown: string[] = [];
        for (const message of [first, second]) {
            if (gate.claim()) shown.push(message);
        }
        expect(shown).toEqual([first]);
    });
});

/**
 * ONE TRIPLE-CLICK USED TO BUY TWO TRANSLATIONS.
 *
 * A triple-click is not a separate event from a double-click: the browser fires
 * `dblclick` on the second click and then `click` with `detail === 3` on the
 * third, and selection.ts translates on both. So the gesture that selects a
 * whole line issued two requests to a paid provider, billed both, and threw the
 * first answer away when the second popover replaced it.
 *
 * It cannot be fixed by cancelling: nothing un-bills a request that has already
 * gone. The first click of the burst has to be HELD, and dropped if a later
 * click in the same gesture arrives.
 */
describe("ClickBurstGate — one gesture, one billed translation", () => {
    /** A wait the test drives by hand, so nothing here depends on a real timer. */
    function manualWait() {
        const waiting: Array<() => void> = [];
        return {
            wait: (_ms: number) => new Promise<void>(resolve => { waiting.push(resolve); }),
            release: () => { for (const resolve of waiting.splice(0)) resolve(); },
            get held() { return waiting.length; }
        };
    }

    it("drops the double-click's request when the third click of the same gesture arrives", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const doubleClick = gate.settle();     // dblclick: held, nothing sent yet
        expect(clock.held).toBe(1);
        gate.supersede();                      // the third click, translating now
        clock.release();

        expect(await doubleClick).toBe(false);
    });

    it("lets a plain double-click through when no third click follows", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const doubleClick = gate.settle();
        clock.release();

        expect(await doubleClick).toBe(true);
    });

    it("counts the sends: one gesture, one translation, and it is the one the user meant", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);
        const sent: string[] = [];

        // The gesture, in the order the browser fires it.
        const fromDoubleClick = (async () => {
            if (await gate.settle()) sent.push("word");
        })();
        gate.supersede();
        sent.push("whole line");   // the third click spends immediately
        clock.release();
        await fromDoubleClick;

        // The block, not the word the double-click had selected — and only it.
        expect(sent).toEqual(["whole line"]);
    });

    it("a later gesture supersedes an earlier one still waiting, rather than both sending", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const first = gate.settle();
        const second = gate.settle();
        clock.release();

        expect(await first).toBe(false);
        expect(await second).toBe(true);
    });

    it("abandon() drops a held click, so removing the handlers cannot spend afterwards", async () => {
        const clock = manualWait();
        const gate = new ClickBurstGate(CLICK_BURST_MS, clock.wait);

        const held = gate.settle();
        gate.abandon();
        clock.release();

        expect(await held).toBe(false);
    });

    it("waits the burst window it was given, and defaults to the multi-click interval", async () => {
        const asked: number[] = [];
        const gate = new ClickBurstGate(undefined, async ms => { asked.push(ms); });
        expect(await gate.settle()).toBe(true);
        expect(asked).toEqual([CLICK_BURST_MS]);
        expect(CLICK_BURST_MS).toBe(500);
    });

    it("would notice a gate that never drops anything (positive control)", async () => {
        // The shape of the bug: both clicks of one gesture translate.
        const alwaysSpends = { settle: async () => true, supersede: () => { /* nothing */ } };
        const sent: string[] = [];
        const fromDoubleClick = (async () => {
            if (await alwaysSpends.settle()) sent.push("word");
        })();
        alwaysSpends.supersede();
        sent.push("whole line");
        await fromDoubleClick;
        expect(sent).toHaveLength(2);
    });
});

/**
 * The rules that live in files needing a DOM and a running client: selection.ts
 * must route BOTH click handlers through the gate, and usageSettings.tsx must
 * not print the credit as if it were free. Neither file can be imported here —
 * selection.ts pulls @webpack/common and ./settings, usageSettings.tsx is JSX
 * over Vencord's own components — so this is a source scan, and every assertion
 * carries a positive control.
 */
describe("what the two plugin-level files actually ship", () => {
    const PLUGIN = join(process.cwd(), "src", "plugins", "channelTranslator");
    const SELECTION = join(PLUGIN, "selection.ts");
    const USAGE_SETTINGS = join(PLUGIN, "usageSettings.tsx");

    const read = (path: string) => readFileSync(path, "utf8");

    /** Code, not commentary: every line whose first non-space characters are not a comment. */
    function codeOnly(source: string): string {
        return source
            .split("\n")
            .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
            .join("\n");
    }

    it("the files it claims to scan exist and are not empty", () => {
        for (const file of [SELECTION, USAGE_SETTINGS]) {
            expect(read(file).length, `empty: ${file}`).toBeGreaterThan(0);
        }
    });

    it("codeOnly() strips comments and keeps code (positive control)", () => {
        expect(codeOnly("// clickBurst.supersede();\nclickBurst.abandon();")).not.toContain("supersede");
        expect(codeOnly(" * clickBurst.supersede();\nreal();")).toContain("real();");
    });

    it("selection.ts routes both click handlers through the burst gate", () => {
        const code = codeOnly(read(SELECTION));
        expect(code).toMatch(/import\s*\{[^}]*\bClickBurstGate\b[^}]*\}\s*from/);
        expect(code).toContain("new ClickBurstGate(");
        // The third click supersedes before it spends …
        expect(code).toContain("clickBurst.supersede();");
        // … and the request path holds.
        expect(code).toContain("clickBurst.settle()");
    });

    it("the hold is on the request path and NOT on the free ones", () => {
        // Showing a held original costs nothing. Delaying it by half a second to
        // protect a bill that is not being incurred would be a regression in the
        // one interaction the UI advertises.
        const code = codeOnly(read(SELECTION));
        const held = code.indexOf("action.kind === \"showHeldOriginal\"");
        const refuse = code.indexOf("action.kind === \"refuse\"");
        const hold = code.indexOf("clickBurst.settle()");
        const provider = code.indexOf("translationProvider()");
        expect(held).toBeGreaterThan(-1);
        expect(refuse).toBeGreaterThan(-1);
        expect(hold).toBeGreaterThan(-1);
        expect(provider).toBeGreaterThan(-1);
        expect(hold).toBeGreaterThan(held);
        expect(hold).toBeGreaterThan(refuse);
        expect(hold).toBeLessThan(provider);
    });

    it("removing the handlers abandons anything still held", () => {
        const code = codeOnly(read(SELECTION));
        const remove = code.indexOf("export function removeSelectionHandler");
        expect(remove).toBeGreaterThan(-1);
        expect(code.slice(remove)).toContain("clickBurst.abandon();");
    });

    it("the meter never prints the credit as a zero cost", () => {
        const code = codeOnly(read(USAGE_SETTINGS));
        // The line that shipped printed "estimated $0.00" for the first
        // half-million characters — the free-tier reading the setup guide has a
        // whole section correcting.
        expect(code).not.toMatch(/estimated \$\{formatUsd\(estimateUsd\(row\.chars\)\)\}/);
        expect(code).toContain("creditUsedUsd(");
        expect(code).toContain("creditRemainingUsd(");
    });

    it("it says the credit is spent and does not roll over", () => {
        const code = codeOnly(read(USAGE_SETTINGS));
        expect(code).toMatch(/does not roll over/);
        expect(code).toMatch(/credit spent|credit is spent/);
    });

    it("would notice the old zero-cost line (positive control)", () => {
        const shipped = " · estimated ${formatUsd(estimateUsd(row.chars))}";
        expect(/estimated \$\{formatUsd\(estimateUsd\(row\.chars\)\)\}/.test(shipped)).toBe(true);
    });

    it("the panel reads its month from the meter, not from the clock", () => {
        // core/usage.ts refuses to roll a recorded month backwards when the
        // system clock does, so the two can disagree and the panel must show the
        // month it is really counting into.
        const code = codeOnly(read(USAGE_SETTINGS));
        expect(code).toContain("state.month");
        expect(code).toContain("monthKey(new Date())");
    });
});
