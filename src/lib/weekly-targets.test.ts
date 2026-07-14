import { describe, expect, it } from "vitest";

import {
  BLOCK_WEEKS,
  CAP_MULTIPLE,
  MAX_WEEKLY_INCREASE,
  TAPER_FLOOR,
  computeAdaptedFutureTargets,
  computeWeeklyTargets,
  firstWeekStartOnOrAfter,
  planStartWeek,
  startOfWeek,
  type WeeklyTargetInput,
} from "./weekly-targets";

/** A Monday, in UTC. (2026-01-05 is a Monday.) */
const MONDAY = new Date("2026-01-05T00:00:00.000Z");

function mondayPlusWeeks(weeks: number): Date {
  return new Date(MONDAY.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

function baseInput(overrides: Partial<WeeklyTargetInput> = {}): WeeklyTargetInput {
  return {
    startDate: MONDAY,
    eventDate: mondayPlusWeeks(10),
    startingWeeklyMeters: 10_000,
    eventDistanceMeters: 42_195,
    ...overrides,
  };
}

describe("firstWeekStartOnOrAfter", () => {
  it("defaults to Monday and returns the same day when given a Monday", () => {
    const result = firstWeekStartOnOrAfter(new Date("2026-01-05T00:00:00.000Z"));
    expect(result.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it.each([
    ["2026-01-04", "2026-01-05"], // Sunday  -> next day
    ["2026-01-06", "2026-01-12"], // Tuesday -> following Monday
    ["2026-01-03", "2026-01-05"], // Saturday -> +2 days
  ])("maps %s to Monday %s (default day)", (input, expected) => {
    const result = firstWeekStartOnOrAfter(new Date(`${input}T00:00:00.000Z`));
    expect(result.toISOString().slice(0, 10)).toBe(expected);
    expect(result.getUTCDay()).toBe(1);
  });

  it.each([
    // weekStartDay = 0 (Sunday)
    [0, "2026-01-05", "2026-01-11"], // Monday -> next Sunday
    [0, "2026-01-11", "2026-01-11"], // Sunday -> itself
    // weekStartDay = 4 (Thursday)
    [4, "2026-01-05", "2026-01-08"], // Monday -> Thursday of that week
    [4, "2026-01-08", "2026-01-08"], // Thursday -> itself
    [4, "2026-01-09", "2026-01-15"], // Friday -> next Thursday
  ])("with weekStartDay=%i maps %s to %s", (day, input, expected) => {
    const result = firstWeekStartOnOrAfter(new Date(`${input}T00:00:00.000Z`), day);
    expect(result.toISOString().slice(0, 10)).toBe(expected);
    expect(result.getUTCDay()).toBe(day);
  });

  it("normalizes a date with a time component to UTC midnight", () => {
    const result = firstWeekStartOnOrAfter(new Date("2026-01-06T15:30:00.000Z")); // Tue afternoon
    expect(result.toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });

  it("throws on an invalid Date", () => {
    expect(() => firstWeekStartOnOrAfter(new Date("nope"))).toThrow(/valid Date/);
  });
});

describe("startOfWeek", () => {
  it.each([
    ["2026-01-05", "2026-01-05"], // Monday -> itself
    ["2026-01-06", "2026-01-05"], // Tuesday -> back to Monday
    ["2026-01-11", "2026-01-05"], // Sunday -> back to Monday
    ["2026-01-12", "2026-01-12"], // next Monday
  ])("defaults to Monday: maps %s to week-start %s", (input, expected) => {
    const result = startOfWeek(new Date(`${input}T12:00:00.000Z`));
    expect(result.toISOString()).toBe(`${expected}T00:00:00.000Z`);
    expect(result.getUTCDay()).toBe(1);
  });

  it.each([
    // weekStartDay = 0 (Sunday): weeks run Sun..Sat
    [0, "2026-01-11", "2026-01-11"], // Sunday -> itself
    [0, "2026-01-12", "2026-01-11"], // Monday -> back to Sunday
    [0, "2026-01-17", "2026-01-11"], // Saturday -> back to Sunday
    // weekStartDay = 4 (Thursday): weeks run Thu..Wed
    [4, "2026-01-08", "2026-01-08"], // Thursday -> itself
    [4, "2026-01-07", "2026-01-01"], // Wednesday -> back to prior Thursday
    [4, "2026-01-10", "2026-01-08"], // Saturday -> back to Thursday
  ])("with weekStartDay=%i maps %s to %s", (day, input, expected) => {
    const result = startOfWeek(new Date(`${input}T12:00:00.000Z`), day);
    expect(result.toISOString()).toBe(`${expected}T00:00:00.000Z`);
    expect(result.getUTCDay()).toBe(day);
  });
});

describe("planStartWeek", () => {
  it("uses the stored startDate when present (a back-dated plan)", () => {
    const startDate = new Date("2025-12-01T00:00:00.000Z");
    const createdAt = new Date("2026-01-06T10:00:00.000Z"); // created weeks later
    expect(planStartWeek({ startDate, createdAt })).toBe(startDate);
  });

  it("falls back to the first Monday on/after createdAt when startDate is null (default day)", () => {
    const createdAt = new Date("2026-01-06T10:00:00.000Z"); // a Tuesday
    const result = planStartWeek({ startDate: null, createdAt });
    expect(result.toISOString()).toBe("2026-01-12T00:00:00.000Z"); // following Monday
  });

  it("honours a non-default weekStartDay in the createdAt fallback", () => {
    const createdAt = new Date("2026-01-06T10:00:00.000Z"); // a Tuesday
    const result = planStartWeek({ startDate: null, createdAt, weekStartDay: 0 });
    expect(result.toISOString()).toBe("2026-01-11T00:00:00.000Z"); // following Sunday
  });
});

describe("computeWeeklyTargets — input guards", () => {
  it("throws when startDate equals eventDate", () => {
    expect(() => computeWeeklyTargets(baseInput({ eventDate: MONDAY }))).toThrow(/strictly before/);
  });

  it("throws when startDate is after eventDate", () => {
    expect(() =>
      computeWeeklyTargets(baseInput({ startDate: mondayPlusWeeks(4), eventDate: MONDAY })),
    ).toThrow(/strictly before/);
  });

  it.each([0, -1, -1000, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws when startingWeeklyMeters is %s",
    (value) => {
      expect(() => computeWeeklyTargets(baseInput({ startingWeeklyMeters: value }))).toThrow(
        /startingWeeklyMeters/,
      );
    },
  );

  it.each([0, -1, -50, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws when eventDistanceMeters is %s",
    (value) => {
      expect(() => computeWeeklyTargets(baseInput({ eventDistanceMeters: value }))).toThrow(
        /eventDistanceMeters/,
      );
    },
  );

  it.each([0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws when capMultiple is %s",
    (value) => {
      expect(() => computeWeeklyTargets(baseInput({ capMultiple: value }))).toThrow(/capMultiple/);
    },
  );

  it("throws on an invalid Date", () => {
    expect(() => computeWeeklyTargets(baseInput({ eventDate: new Date("not-a-date") }))).toThrow(
      /valid Date/,
    );
  });
});

describe("computeWeeklyTargets — week generation", () => {
  it("produces a single entry when start and event are in the same week", () => {
    // Thursday of the same week as the Monday start.
    const result = computeWeeklyTargets(
      baseInput({ eventDate: new Date("2026-01-08T00:00:00.000Z") }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.targetMeters).toBe(10_000);
  });

  it("includes the week containing the event date", () => {
    // Event exactly 2 weeks after start (a Monday) => weeks at +0, +1, +2 = 3.
    const result = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(2) }));
    expect(result).toHaveLength(3);
  });

  it("counts the event's week when the event falls mid-week", () => {
    // Event on the Sunday of the 3rd week (start + 2 weeks + 6 days).
    const sunday = new Date(mondayPlusWeeks(2).getTime() + 6 * 24 * 60 * 60 * 1000);
    const result = computeWeeklyTargets(baseInput({ eventDate: sunday }));
    expect(result).toHaveLength(3);
  });

  it("emits consecutive Mondays at UTC midnight, starting at startDate", () => {
    const result = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(5) }));
    expect(result[0]?.weekStartDate.toISOString()).toBe(MONDAY.toISOString());
    for (let i = 0; i < result.length; i++) {
      const d = result[i]!.weekStartDate;
      expect(d.getUTCDay()).toBe(1); // Monday
      expect(d.getUTCHours()).toBe(0);
      expect(d.toISOString()).toBe(mondayPlusWeeks(i).toISOString());
    }
  });

  it("does not mutate the input startDate", () => {
    const startDate = new Date(MONDAY);
    const before = startDate.getTime();
    computeWeeklyTargets(baseInput({ startDate }));
    expect(startDate.getTime()).toBe(before);
  });
});

describe("computeWeeklyTargets — progression rules", () => {
  it("sets week 1 to the starting weekly volume", () => {
    const result = computeWeeklyTargets(baseInput({ startingWeeklyMeters: 8_000 }));
    expect(result[0]?.targetMeters).toBe(8_000);
  });

  it("never increases by more than 12% week-over-week (integer outputs)", () => {
    const result = computeWeeklyTargets(
      baseInput({ eventDate: mondayPlusWeeks(52), startingWeeklyMeters: 4_000 }),
    );
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]!.targetMeters;
      const curr = result[i]!.targetMeters;
      expect(curr).toBeLessThanOrEqual(prev * (1 + MAX_WEEKLY_INCREASE) + 1e-9);
    }
  });

  it("builds up except on de-load weeks, which step down", () => {
    const result = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(40) }));
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]!.targetMeters;
      const curr = result[i]!.targetMeters;
      if (i % BLOCK_WEEKS === BLOCK_WEEKS - 1) {
        // De-load week: a step down (or equal once pinned at the cap).
        expect(curr).toBeLessThanOrEqual(prev);
      } else {
        // Build week: non-decreasing.
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }
  });

  it("returns whole-meter (integer) targets", () => {
    const result = computeWeeklyTargets(
      baseInput({ eventDate: mondayPlusWeeks(30), startingWeeklyMeters: 9_999 }),
    );
    for (const t of result) {
      expect(Number.isInteger(t.targetMeters)).toBe(true);
    }
  });

  it("matches an exact hand-computed sample (12% build with a week-4 de-load)", () => {
    // Short plan => build steps run at the full 12%. Week 4 (index 3) de-loads
    // to week 2 (index 1), then the next block resumes from there.
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(6),
      startingWeeklyMeters: 10_000,
      eventDistanceMeters: 42_195, // cap = 147,682.5 — far above these values
    });
    expect(result.map((t) => t.targetMeters)).toEqual([
      10_000, 11_200, 12_544, 11_200, 12_544, 14_049, 15_734,
    ]);
  });
});

/** Growth rates for build weeks only (de-load weeks excluded). */
function buildStepRates(result: { targetMeters: number }[]): number[] {
  const rates: number[] = [];
  for (let i = 1; i < result.length; i++) {
    if (i % BLOCK_WEEKS === BLOCK_WEEKS - 1) continue; // skip de-load weeks
    rates.push(result[i]!.targetMeters / result[i - 1]!.targetMeters - 1);
  }
  return rates;
}

describe("computeWeeklyTargets — de-load weeks", () => {
  it("drops every 4th week to the level of its block's 2nd week", () => {
    const result = computeWeeklyTargets(
      baseInput({ eventDate: mondayPlusWeeks(15), startingWeeklyMeters: 8_000 }),
    );
    // 16 weeks => de-loads at indices 3, 7, 11, 15.
    for (let i = 3; i < result.length; i += BLOCK_WEEKS) {
      expect(result[i]!.targetMeters).toBe(result[i - 2]!.targetMeters);
      // ...and it is a genuine step down from the block's peak.
      expect(result[i]!.targetMeters).toBeLessThan(result[i - 1]!.targetMeters);
    }
  });

  it("matches the example shape within a block (build, build, de-load=2nd)", () => {
    const result = computeWeeklyTargets(
      baseInput({ eventDate: mondayPlusWeeks(3), startingWeeklyMeters: 10_000 }),
    );
    const [w1, w2, w3, w4] = result.map((t) => t.targetMeters);
    expect(w2!).toBeGreaterThan(w1!); // build
    expect(w3!).toBeGreaterThan(w2!); // build
    expect(w4!).toBe(w2!); // de-load to the 2nd week
  });
});

describe("computeWeeklyTargets — the 1.5× cap and evened ramp", () => {
  it("never exceeds 1.5× the event distance", () => {
    const eventDistanceMeters = 3_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters;
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(52),
      startingWeeklyMeters: 2_000,
      eventDistanceMeters,
    });
    for (const t of result) {
      expect(t.targetMeters).toBeLessThanOrEqual(cap);
    }
  });

  it("builds at an even rate (under 12%) and reaches the cap at the peak", () => {
    const eventDistanceMeters = 20_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters; // 30,000
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(7), // 8 weeks
      startingWeeklyMeters: 21_400,
      eventDistanceMeters,
    });
    const rates = buildStepRates(result);

    // Build steps are even and clearly below the 12% ceiling (here ~8.8%).
    expect(Math.max(...rates)).toBeLessThan(0.1);
    expect(Math.max(...rates)).toBeLessThanOrEqual(MAX_WEEKLY_INCREASE + 1e-9);
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.005);

    // The peak still reaches (just under) the cap despite the de-loads.
    const peak = Math.max(...result.map((t) => t.targetMeters));
    expect(peak).toBeLessThanOrEqual(cap);
    expect(peak).toBeGreaterThan(cap * 0.98);
  });

  it("uses a gentler build rate on a longer plan (slower where possible)", () => {
    const common = { startDate: MONDAY, startingWeeklyMeters: 2_500, eventDistanceMeters: 3_000 };
    const short = computeWeeklyTargets({ ...common, eventDate: mondayPlusWeeks(11) }); // 12 weeks
    const long = computeWeeklyTargets({ ...common, eventDate: mondayPlusWeeks(51) }); // 52 weeks

    const shortRate = Math.max(...buildStepRates(short));
    const longRate = Math.max(...buildStepRates(long));

    expect(longRate).toBeLessThan(shortRate);
    expect(longRate).toBeLessThan(0.04); // long plan ramps gently
    // Both still approach the cap at their peak.
    const cap = CAP_MULTIPLE * common.eventDistanceMeters;
    expect(Math.max(...long.map((t) => t.targetMeters))).toBeGreaterThan(cap * 0.97);
  });

  it("holds flat at the cap when the starting volume already meets/exceeds it", () => {
    const eventDistanceMeters = 10_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters; // 15,000
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(4),
      startingWeeklyMeters: 100_000, // above the cap
      eventDistanceMeters,
    });
    for (const t of result) {
      expect(t.targetMeters).toBe(Math.floor(cap));
    }
  });
});

describe("computeWeeklyTargets — configurable capMultiple", () => {
  it("defaults to CAP_MULTIPLE (1.5×) when capMultiple is omitted", () => {
    const eventDistanceMeters = 10_000;
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(4),
      startingWeeklyMeters: 100_000,
      eventDistanceMeters,
    });
    for (const t of result) {
      expect(t.targetMeters).toBe(Math.floor(CAP_MULTIPLE * eventDistanceMeters));
    }
  });

  it("respects a custom capMultiple instead of the default", () => {
    const eventDistanceMeters = 10_000;
    const capMultiple = 3;
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(4),
      startingWeeklyMeters: 100_000, // above every candidate cap
      eventDistanceMeters,
      capMultiple,
    });
    for (const t of result) {
      expect(t.targetMeters).toBe(Math.floor(capMultiple * eventDistanceMeters));
    }
  });

  it("a lower capMultiple yields a lower peak than the default", () => {
    const common = {
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(20),
      startingWeeklyMeters: 5_000,
      eventDistanceMeters: 10_000,
    };
    const tighter = computeWeeklyTargets({ ...common, capMultiple: 1.1 });
    const wider = computeWeeklyTargets({ ...common, capMultiple: 3 });

    const tighterPeak = Math.max(...tighter.map((t) => t.targetMeters));
    const widerPeak = Math.max(...wider.map((t) => t.targetMeters));
    expect(tighterPeak).toBeLessThan(widerPeak);
    expect(tighterPeak).toBeLessThanOrEqual(1.1 * common.eventDistanceMeters);
    expect(widerPeak).toBeLessThanOrEqual(3 * common.eventDistanceMeters);
  });
});

describe("computeWeeklyTargets — race-week taper", () => {
  it("defaults to no taper (omitting taperWeeks == taperWeeks: 0)", () => {
    const omitted = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(15) }));
    const zero = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(15), taperWeeks: 0 }));
    expect(zero.map((t) => t.targetMeters)).toEqual(omitted.map((t) => t.targetMeters));
  });

  it("moves the peak earlier and ramps the final weeks down to the floor", () => {
    // 12 weeks, 2-week taper => peak at index 9 (not a de-load week), taper at 10 & 11.
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(11),
      startingWeeklyMeters: 5_000,
      eventDistanceMeters: 10_000, // cap = 15,000
      taperWeeks: 2,
    });
    expect(result).toHaveLength(12);

    const peak = Math.max(...result.map((t) => t.targetMeters));
    // The peak lands on the last BUILD week (index 9), before the taper.
    expect(result[9]!.targetMeters).toBe(peak);
    // Taper weeks step down: ~75% then ~50% (the floor) of the peak.
    expect(result[10]!.targetMeters).toBe(Math.floor(peak * 0.75));
    expect(result[11]!.targetMeters).toBe(Math.floor(peak * TAPER_FLOOR));
    expect(result[11]!.targetMeters).toBeLessThan(result[10]!.targetMeters);
    expect(result[10]!.targetMeters).toBeLessThan(peak);
  });

  it("keeps a single-week taper's race week at the floor", () => {
    // 3 weeks, taperWeeks 2 clamps to 1 (needs >=2 build weeks): peak at index 1, taper at 2.
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(2),
      startingWeeklyMeters: 10_000,
      eventDistanceMeters: 1_000_000, // cap far above, so weeks just build
      taperWeeks: 2,
    });
    expect(result).toHaveLength(3);
    const peak = Math.max(...result.map((t) => t.targetMeters));
    expect(result[1]!.targetMeters).toBe(peak);
    expect(result[2]!.targetMeters).toBe(Math.floor(peak * TAPER_FLOOR));
  });

  it("clamps away the taper on plans too short to keep two build weeks", () => {
    // 2 weeks: effectiveTaper clamps to 0 — identical to no taper.
    const tapered = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(1),
      startingWeeklyMeters: 10_000,
      eventDistanceMeters: 1_000_000,
      taperWeeks: 2,
    });
    const none = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(1),
      startingWeeklyMeters: 10_000,
      eventDistanceMeters: 1_000_000,
      taperWeeks: 0,
    });
    expect(tapered.map((t) => t.targetMeters)).toEqual(none.map((t) => t.targetMeters));
    expect(tapered).toHaveLength(2);
  });

  it("still respects the 12% build ceiling and the cap with a taper", () => {
    const eventDistanceMeters = 10_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters;
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(25),
      startingWeeklyMeters: 4_000,
      eventDistanceMeters,
      taperWeeks: 3,
    });
    for (const t of result) expect(t.targetMeters).toBeLessThanOrEqual(cap);
    // The last 3 weeks strictly descend into race day.
    const tail = result.slice(-3).map((t) => t.targetMeters);
    expect(tail[0]!).toBeGreaterThan(tail[1]!);
    expect(tail[1]!).toBeGreaterThan(tail[2]!);
  });
});

describe("computeAdaptedFutureTargets", () => {
  // Completed week at +2, current week at +3 (event far off so the cap never bites).
  const lastCompletedWeekStart = mondayPlusWeeks(2);
  const currentWeekStart = mondayPlusWeeks(3);
  const common = {
    lastCompletedWeekStart,
    currentWeekStart,
    eventDate: mondayPlusWeeks(20),
    capMultiple: 1.5,
  };

  it("returns only current + future weeks (never the completed week or earlier)", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      disciplines: [
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: 10_000,
          lastCompletedTarget: 9_000,
        },
      ],
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.weekStartDate.getTime()).toBeGreaterThanOrEqual(currentWeekStart.getTime());
    }
    // The first future week is one growth step above the actual baseline.
    const firstFuture = rows.find((r) => r.weekStartDate.getTime() === currentWeekStart.getTime())!;
    expect(firstFuture.targetMeters).toBeGreaterThan(10_000);
  });

  it("adapts UP: a higher actual raises the ramp above what a lower actual gives", () => {
    const disc = (lastCompletedActual: number) => [
      {
        discipline: "RUN",
        eventDistanceMeters: 100_000,
        lastCompletedActual,
        lastCompletedTarget: 8_000,
      },
    ];
    const high = computeAdaptedFutureTargets({ ...common, disciplines: disc(12_000) });
    const low = computeAdaptedFutureTargets({ ...common, disciplines: disc(6_000) });
    const highFirst = high[0]!.targetMeters;
    const lowFirst = low[0]!.targetMeters;
    expect(highFirst).toBeGreaterThan(lowFirst);
  });

  it("adapts DOWN: an actual below the original target lowers the ramp", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      disciplines: [
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: 4_000, // well below target
          lastCompletedTarget: 12_000,
        },
      ],
    });
    // First future week ramps from 4,000, so it stays well under the old 12,000 target.
    expect(rows[0]!.targetMeters).toBeLessThan(12_000);
  });

  it("no-signal fallback: a 0/missing actual re-ramps from the original target instead of zero", () => {
    const zero = computeAdaptedFutureTargets({
      ...common,
      disciplines: [
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: 0,
          lastCompletedTarget: 9_000,
        },
      ],
    });
    const missing = computeAdaptedFutureTargets({
      ...common,
      disciplines: [
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: null,
          lastCompletedTarget: 9_000,
        },
      ],
    });
    // Both fall back to the 9,000 target as the baseline → identical, non-zero ramp.
    expect(zero[0]!.targetMeters).toBeGreaterThan(9_000);
    expect(zero.map((r) => r.targetMeters)).toEqual(missing.map((r) => r.targetMeters));
  });

  it("handles each discipline independently", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      disciplines: [
        {
          discipline: "SWIM",
          eventDistanceMeters: 4_000,
          lastCompletedActual: 2_000,
          lastCompletedTarget: 1_800,
        },
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: 10_000,
          lastCompletedTarget: 9_000,
        },
      ],
    });
    expect(new Set(rows.map((r) => r.discipline))).toEqual(new Set(["SWIM", "RUN"]));
    // SWIM stays capped to 1.5 x its (small) event distance.
    for (const r of rows.filter((r) => r.discipline === "SWIM")) {
      expect(r.targetMeters).toBeLessThanOrEqual(1.5 * 4_000);
    }
  });

  it("eases the ramp when a check-in reports fatigue (readinessFactor < 1)", () => {
    const disciplines = [
      {
        discipline: "RUN",
        eventDistanceMeters: 100_000,
        lastCompletedActual: 10_000,
        lastCompletedTarget: 9_000,
      },
    ];
    const normal = computeAdaptedFutureTargets({ ...common, disciplines });
    const eased = computeAdaptedFutureTargets({ ...common, readinessFactor: 0.8, disciplines });
    // The whole forward ramp starts lower after a fatigued week.
    expect(eased[0]!.targetMeters).toBeLessThan(normal[0]!.targetMeters);
    expect(eased[0]!.targetMeters).toBeGreaterThan(0);
  });

  it("carries the taper through the re-ramp (race week ends below the peak)", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      taperWeeks: 2,
      disciplines: [
        {
          discipline: "RUN",
          eventDistanceMeters: 100_000,
          lastCompletedActual: 10_000,
          lastCompletedTarget: 9_000,
        },
      ],
    });
    const vals = rows.map((r) => r.targetMeters);
    const peak = Math.max(...vals);
    // The re-ramp still tapers into race day: the last week is well under the peak.
    expect(vals.at(-1)!).toBeLessThan(peak);
    expect(vals.at(-1)!).toBeLessThanOrEqual(peak * 0.6);
  });
});
