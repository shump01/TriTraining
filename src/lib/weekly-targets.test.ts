import { describe, expect, it } from "vitest";

import {
  BLOCK_WEEKS,
  CAP_MULTIPLE,
  DETRAIN_PER_WEEK,
  MAX_PLAN_WEEKS,
  MAX_WEEKLY_INCREASE,
  MIN_RETURN_FACTOR,
  TAPER_FLOOR,
  computeAdaptedFutureTargets,
  computeWeeklyTargets,
  firstWeekStartOnOrAfter,
  planStartWeek,
  returnToTrainingFactor,
  startOfWeek,
  trainingPhaseForWeek,
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

  // Every week becomes array entries here and rows in the DB, so an unbounded
  // span is a resource bomb — see MAX_PLAN_WEEKS. The API bounds the dates in
  // validation.ts; this guard is the invariant for any other caller.
  it("throws instead of allocating when the span exceeds MAX_PLAN_WEEKS", () => {
    const tooLong = mondayPlusWeeks(MAX_PLAN_WEEKS + 1);
    expect(() => computeWeeklyTargets(baseInput({ eventDate: tooLong }))).toThrow(/maximum/);
  });

  it("accepts a span exactly at the limit", () => {
    // weekCount is inclusive of both ends, so the last allowed event date is
    // MAX_PLAN_WEEKS - 1 weeks after the start.
    const atLimit = mondayPlusWeeks(MAX_PLAN_WEEKS - 1);
    const rows = computeWeeklyTargets(baseInput({ eventDate: atLimit }));
    expect(rows).toHaveLength(MAX_PLAN_WEEKS);
  });

  it("does not blow up on an absurd epoch-ms date — it rejects it", () => {
    // The exact DoS payload: z.coerce.date() would accept this as epoch-ms.
    expect(() =>
      computeWeeklyTargets(baseInput({ eventDate: new Date(8_640_000_000_000_000) })),
    ).toThrow(/maximum/);
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

describe("computeAdaptedFutureTargets — the taper is never re-ramped", () => {
  // A real plan shape: 11 weeks, racing on week 11, with a 2-week taper. The
  // suite's other taper test re-ramps 17 weeks out, which never reaches the
  // clamp that made this go wrong — these sit in the last weeks on purpose.
  const eventDate = mondayPlusWeeks(10);
  const disciplines = [
    {
      discipline: "RUN",
      eventDistanceMeters: 100_000,
      lastCompletedActual: 40_000, // a big week, which is what pushes the ramp up
      lastCompletedTarget: 30_000,
    },
  ];
  const reramp = (currentWeek: number, taperWeeks = 2) =>
    computeAdaptedFutureTargets({
      disciplines,
      lastCompletedWeekStart: mondayPlusWeeks(currentWeek - 1),
      currentWeekStart: mondayPlusWeeks(currentWeek),
      eventDate,
      capMultiple: 1.5,
      taperWeeks,
    });

  it("leaves race week alone instead of rewriting it as a build", () => {
    // Regression: weekCount was re-derived from the sliding anchor, so a 2-week
    // taper clamped to 0 and race day came out as a +12% build off the peak.
    expect(reramp(10)).toEqual([]);
  });

  it("leaves the first taper week alone instead of making it the peak", () => {
    // Regression: this rewrote the week to the plan's all-time peak (+33%).
    expect(reramp(9)).toEqual([]);
  });

  it("stops re-ramping across the whole taper window, however long", () => {
    for (const taper of [1, 2, 3, 4]) {
      for (let weeksOut = 0; weeksOut < taper; weeksOut++) {
        const current = 10 - weeksOut; // 10 = race week
        expect(reramp(current, taper)).toEqual([]);
      }
    }
  });

  it("still re-ramps right up to the taper's edge, and lands the taper correctly", () => {
    // The last build week before a 2-week taper: this one MUST still adapt.
    const rows = reramp(8);
    expect(rows.length).toBeGreaterThan(0);

    const vals = rows.map((r) => r.targetMeters);
    const peak = Math.max(...vals);
    // Race day ends at the taper floor, not at the peak — the shape is intact.
    expect(vals.at(-1)!).toBeLessThanOrEqual(peak * TAPER_FLOOR + 1);
    // ...and it strictly descends into race day rather than building.
    expect(vals.at(-1)!).toBeLessThan(vals.at(-2)!);
  });

  it("a plan with no taper keeps adapting all the way to race day", () => {
    // taperWeeks: 0 means "peak on the event week" — the guard must not fire.
    const rows = reramp(10, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.targetMeters).toBeGreaterThan(0);
  });

  it("never lets a re-ramp exceed the volume the taper had planned", () => {
    // The property that actually matters: whatever week you open the plan on,
    // the re-ramp must not raise a taper week above what the plan intended.
    const original = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate,
      startingWeeklyMeters: 20_000,
      eventDistanceMeters: 100_000,
      capMultiple: 1.5,
      taperWeeks: 2,
    });
    const plannedFor = new Map(original.map((t) => [t.weekStartDate.getTime(), t.targetMeters]));

    for (let current = 1; current <= 10; current++) {
      for (const row of reramp(current)) {
        const planned = plannedFor.get(row.weekStartDate.getTime());
        if (planned == null) continue;
        const isTaperWeek = current >= 9;
        if (isTaperWeek) {
          expect(row.targetMeters).toBeLessThanOrEqual(planned);
        }
      }
    }
  });
});

describe("returnToTrainingFactor", () => {
  it("leaves the baseline untouched with no layoff", () => {
    expect(returnToTrainingFactor(0)).toBe(1);
    expect(returnToTrainingFactor(-2)).toBe(1);
    expect(returnToTrainingFactor(NaN)).toBe(1);
  });

  it("detrains the baseline by the documented amount per week off", () => {
    expect(returnToTrainingFactor(1)).toBeCloseTo(1 - DETRAIN_PER_WEEK, 6);
    expect(returnToTrainingFactor(3)).toBeCloseTo(1 - 3 * DETRAIN_PER_WEEK, 6);
  });

  it("never restarts below the floor, however long the layoff", () => {
    expect(returnToTrainingFactor(20)).toBe(MIN_RETURN_FACTOR);
    expect(returnToTrainingFactor(100)).toBe(MIN_RETURN_FACTOR);
  });

  it("is monotonic — a longer layoff never returns higher", () => {
    for (let w = 1; w < 10; w++) {
      expect(returnToTrainingFactor(w + 1)).toBeLessThanOrEqual(returnToTrainingFactor(w));
    }
  });
});

describe("computeAdaptedFutureTargets — returning from paused weeks", () => {
  const currentWeekStart = mondayPlusWeeks(3);
  const disciplines = [
    {
      discipline: "RUN",
      eventDistanceMeters: 100_000,
      lastCompletedActual: 10_000,
      lastCompletedTarget: 9_000,
    },
  ];
  const common = { currentWeekStart, eventDate: mondayPlusWeeks(20), capMultiple: 1.5 };

  it("restarts the first week back AT the detrained baseline (not a growth step above it)", () => {
    // Two weeks off: the baseline week is the last week trained, at +0.
    const rows = computeAdaptedFutureTargets({
      ...common,
      lastCompletedWeekStart: mondayPlusWeeks(0),
      pausedWeeks: 2,
      disciplines,
    });
    const first = rows.find((r) => r.weekStartDate.getTime() === currentWeekStart.getTime())!;
    // 10,000 actual × returnToTrainingFactor(2) = 8,000 — the week back IS the baseline.
    expect(first.targetMeters).toBe(Math.floor(10_000 * returnToTrainingFactor(2)));
  });

  it("comes back lower than it left off — and lower the longer the layoff", () => {
    const ramp = (pausedWeeks: number) =>
      computeAdaptedFutureTargets({
        ...common,
        lastCompletedWeekStart: mondayPlusWeeks(3 - pausedWeeks - 1),
        pausedWeeks,
        disciplines,
      })[0]!.targetMeters;

    // Without a pause the ramp continues UP from the 10,000 actual…
    const noPause = computeAdaptedFutureTargets({
      ...common,
      lastCompletedWeekStart: mondayPlusWeeks(2),
      disciplines,
    })[0]!.targetMeters;
    expect(noPause).toBeGreaterThan(10_000);

    // …whereas returning from time off restarts below it, and keeps dropping.
    expect(ramp(1)).toBeLessThan(10_000);
    expect(ramp(3)).toBeLessThan(ramp(1));
  });

  it("still rebuilds toward the cap after the reduced restart", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      lastCompletedWeekStart: mondayPlusWeeks(0),
      pausedWeeks: 3,
      disciplines,
    });
    const vals = rows.map((r) => r.targetMeters);
    // The return ramp climbs back up rather than staying flat at the reduced level.
    expect(vals.at(-1)!).toBeGreaterThan(vals[0]!);
    for (const v of vals) expect(v).toBeLessThanOrEqual(1.5 * 100_000);
  });

  it("stacks with a fatigued check-in (both eases apply)", () => {
    const args = { ...common, lastCompletedWeekStart: mondayPlusWeeks(1), pausedWeeks: 1 };
    const plain = computeAdaptedFutureTargets({ ...args, disciplines })[0]!.targetMeters;
    const eased = computeAdaptedFutureTargets({
      ...args,
      readinessFactor: 0.8,
      disciplines,
    })[0]!.targetMeters;
    expect(eased).toBeLessThan(plain);
  });

  it("returns nothing when the comeback lands in the race week itself", () => {
    // Anchoring at the current week would need a start strictly before the event.
    const rows = computeAdaptedFutureTargets({
      ...common,
      eventDate: currentWeekStart,
      lastCompletedWeekStart: mondayPlusWeeks(1),
      pausedWeeks: 1,
      disciplines,
    });
    expect(rows).toEqual([]);
  });
});

describe("computeAdaptedFutureTargets — the compliance floor", () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  // The scenario the floor exists for: an 18-week 70.3 bike leg — 40 km/wk
  // start, 90 km event, 1.5 cap, 2-week taper. Peak build week is index 15.
  const planInput = {
    startDate: MONDAY,
    eventDate: new Date(mondayPlusWeeks(17).getTime() + 5 * 24 * 60 * 60 * 1000),
    startingWeeklyMeters: 40_000,
    eventDistanceMeters: 90_000,
    capMultiple: 1.5,
    taperWeeks: 2,
  };

  /**
   * Live the plan week by week at a fixed compliance level, mirroring the real
   * weekly roll-forward: complete week i at `compliance × its current target`,
   * re-ramp, adopt the regenerated targets, repeat. Returns the final target
   * track, indexed by plan week.
   */
  function livePlan(compliance: number, withFloor: boolean): number[] {
    const originals = computeWeeklyTargets(planInput).map((t) => t.targetMeters);
    const track = [...originals];
    for (let i = 0; i < originals.length; i++) {
      const rows = computeAdaptedFutureTargets({
        disciplines: [
          {
            discipline: "BIKE",
            eventDistanceMeters: planInput.eventDistanceMeters,
            lastCompletedActual: Math.floor(track[i]! * compliance),
            lastCompletedTarget: track[i]!,
            originalBaselineTarget: withFloor ? originals[i]! : null,
          },
        ],
        lastCompletedWeekStart: mondayPlusWeeks(i),
        currentWeekStart: mondayPlusWeeks(i + 1),
        eventDate: planInput.eventDate,
        capMultiple: planInput.capMultiple,
        taperWeeks: planInput.taperWeeks,
      });
      if (rows.length === 0) break; // inside the taper — the ramp is over
      for (const r of rows) {
        const week = Math.round((r.weekStartDate.getTime() - MONDAY.getTime()) / WEEK_MS);
        track[week] = r.targetMeters;
      }
    }
    return track;
  }

  it("without the floor, steady 75% compliance decays the plan toward zero (the defect)", () => {
    const originals = computeWeeklyTargets(planInput).map((t) => t.targetMeters);
    const peakWeek = originals.length - 1 - 2; // last build week before the taper
    const decayed = livePlan(0.75, false);
    // The athlete reaches the peak week of a 90 km-leg plan being asked for
    // under 10 km. This assertion pins the failure mode the floor removes —
    // if it ever fails, the engine changed underneath the floor's rationale.
    expect(decayed[peakWeek]!).toBeLessThan(10_000);
  });

  it("with the floor, the same athlete's plan holds near the original curve", () => {
    const originals = computeWeeklyTargets(planInput).map((t) => t.targetMeters);
    const peakWeek = originals.length - 1 - 2;
    const floored = livePlan(0.75, true);
    // The ask tracks ~85% of the original intent instead of collapsing.
    expect(floored[peakWeek]!).toBeGreaterThanOrEqual(0.8 * originals[peakWeek]!);
    // And the floor is not a ratchet-up: the ask never exceeds the cap.
    for (const v of floored) expect(v).toBeLessThanOrEqual(1.5 * planInput.eventDistanceMeters);
  });

  it("a 90%-compliance athlete no longer flattens while reading 'on track'", () => {
    // 90% sits exactly at BEHIND_RATIO: the UI never says behind, and before
    // the floor the plan silently stopped progressing. Now it keeps building.
    const originals = computeWeeklyTargets(planInput).map((t) => t.targetMeters);
    const peakWeek = originals.length - 1 - 2;
    const floored = livePlan(0.9, true);
    expect(floored[peakWeek]!).toBeGreaterThanOrEqual(0.8 * originals[peakWeek]!);
  });

  const common = {
    lastCompletedWeekStart: mondayPlusWeeks(2),
    currentWeekStart: mondayPlusWeeks(3),
    eventDate: mondayPlusWeeks(20),
    capMultiple: 1.5,
  };
  const disc = (overrides: Record<string, unknown>) => [
    {
      discipline: "RUN",
      eventDistanceMeters: 100_000,
      lastCompletedActual: 6_000,
      lastCompletedTarget: 10_000,
      originalBaselineTarget: 10_000, // floor = 8,500
      ...overrides,
    },
  ];

  it("is inactive while the actual stays at or above the floor", () => {
    // 9,500 ≥ 8,500: actual-driven adaptation is untouched — byte-identical
    // output with and without the floor reference.
    const withFloor = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({ lastCompletedActual: 9_500 }),
    });
    const without = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({ lastCompletedActual: 9_500, originalBaselineTarget: null }),
    });
    expect(withFloor).toEqual(without);
  });

  it("clamps an under-floor actual up to the floor", () => {
    const rows = computeAdaptedFutureTargets({ ...common, disciplines: disc({}) });
    // Ramped from 8,500 (the floor), not from the 6,000 actual.
    expect(rows[0]!.targetMeters).toBeGreaterThan(8_500);
    const unfloored = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({ originalBaselineTarget: null }),
    });
    expect(unfloored[0]!.targetMeters).toBeLessThan(rows[0]!.targetMeters);
  });

  it("readiness easing still applies BELOW the floor (deliberate reductions win)", () => {
    const eased = computeAdaptedFutureTargets({
      ...common,
      readinessFactor: 0.8,
      disciplines: disc({}),
    });
    // 8,500 floored anchor × 0.8 ease = 6,800 baseline; the first regenerated
    // week (one growth step up, ≤ 12%) still sits under the 8,500 floor.
    expect(eased[0]!.targetMeters).toBeLessThan(8_500);
    expect(eased[0]!.targetMeters).toBeGreaterThanOrEqual(6_800);
  });

  it("the post-layoff detraining haircut also still applies below the floor", () => {
    const rows = computeAdaptedFutureTargets({
      ...common,
      lastCompletedWeekStart: mondayPlusWeeks(1),
      pausedWeeks: 2, // returnFactor 0.8
      disciplines: disc({}),
    });
    // Return path: the ramp restarts AT the current week with the detrained
    // baseline itself — 8,500 × 0.8 = 6,800, under the floor as intended.
    expect(rows[0]!.weekStartDate.getTime()).toBe(common.currentWeekStart.getTime());
    expect(rows[0]!.targetMeters).toBe(6_800);
  });

  it("heals an already-decayed plan GRADUALLY: decay stops, the ask climbs one ramp step", () => {
    // A plan the old behaviour ground down to a 2,920 ask while the original
    // curve intended ~99,000, and an athlete still doing 75% of the decayed
    // ask. Unfloored, the decay continues (re-anchor on 2,190). Floored, the
    // anchor is held at the last prescription — but NOT snapped to the
    // original curve: an athlete demonstrably riding ~2 km cannot be handed a
    // 84 km week. The heal is one growth step per roll-forward, forever
    // upward, until the floor band is reached.
    const decayedDisc = (originalBaselineTarget: number | null) =>
      disc({
        lastCompletedActual: 2_190,
        lastCompletedTarget: 2_920,
        originalBaselineTarget,
        eventDistanceMeters: 90_000,
      });
    const floored = computeAdaptedFutureTargets({ ...common, disciplines: decayedDisc(99_000) });
    const unfloored = computeAdaptedFutureTargets({ ...common, disciplines: decayedDisc(null) });
    // Unfloored: still decaying (2,190 × 1.12 = 2,452 < the 2,920 ask).
    expect(unfloored[0]!.targetMeters).toBeLessThan(2_920);
    // Floored: climbing, but by at most one ramp step over the last ask.
    expect(floored[0]!.targetMeters).toBeGreaterThan(2_920);
    expect(floored[0]!.targetMeters).toBeLessThanOrEqual(Math.floor(2_920 * 1.12));
  });

  it("never snaps back after a complied-with eased week (two-roll regression)", () => {
    // THE bug the first floor draft shipped: a comeback/eased week's ask is
    // deliberately below the floor; the athlete complies exactly; on the NEXT
    // roll their actual is below the floor and a naive clamp would erase the
    // whole ease — a +90% to 3× jump one week out of illness. The floor must
    // hold at the engine's own last prescription instead: the week after a
    // fully-complied eased week climbs by at most one ramp step.
    const easedAsk = 6_800; // e.g. 8,500 floored anchor × 0.8 readiness ease
    const rows = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({
        lastCompletedActual: easedAsk, // complied exactly
        lastCompletedTarget: easedAsk, // the engine's own eased prescription
        originalBaselineTarget: 10_000, // un-eased original: floor 8,500 > ask
      }),
    });
    expect(rows[0]!.targetMeters).toBeGreaterThan(easedAsk);
    expect(rows[0]!.targetMeters).toBeLessThanOrEqual(Math.floor(easedAsk * 1.12));
  });

  it("full comeback sequence: layoff, reduced return, then a normal ramp — no spike", () => {
    // Roll 1: return from 2 paused weeks — the ask restarts at the detrained
    // baseline (verified in the return-path test above: 6,800). Roll 2: the
    // athlete trains exactly that. The next ask must be a normal ramp step,
    // not a snap to the original curve's 10,000-based floor.
    const roll2 = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({
        lastCompletedActual: 6_800,
        lastCompletedTarget: 6_800,
        originalBaselineTarget: 10_000,
      }),
    });
    const step = roll2[0]!.targetMeters / 6_800;
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThanOrEqual(1.12);
  });

  it("never clamps DOWN: an over-performing actual above the floor drives the ramp unchanged", () => {
    const over = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({ lastCompletedActual: 15_000 }),
    });
    const control = computeAdaptedFutureTargets({
      ...common,
      disciplines: disc({ lastCompletedActual: 15_000, originalBaselineTarget: null }),
    });
    expect(over).toEqual(control);
    expect(over[0]!.targetMeters).toBeGreaterThan(15_000);
  });
});

describe("trainingPhaseForWeek", () => {
  const phases = (weekCount: number, taperWeeks: number) =>
    Array.from({ length: weekCount }, (_, i) => trainingPhaseForWeek(i, weekCount, taperWeeks));

  it("labels a 16-week taper-2 plan the way the builder shapes it", () => {
    // Peak = last build week (index 13); race week is the taper's final step
    // but reads RACE; de-loads at every 4th week; the first block is BASE.
    expect(phases(16, 2)).toEqual([
      "BASE", "BASE", "BASE", "RECOVERY",
      "BUILD", "BUILD", "BUILD", "RECOVERY",
      "BUILD", "BUILD", "BUILD", "RECOVERY",
      "BUILD", "PEAK", "TAPER", "RACE",
    ]);
  });

  it("keeps de-loads on the builder's cadence (every BLOCK_WEEKSth week)", () => {
    const p = phases(12, 0);
    for (let i = 0; i < 12; i++) {
      const isDeload = i % BLOCK_WEEKS === BLOCK_WEEKS - 1;
      if (isDeload && i !== 11) expect(p[i]).toBe("RECOVERY");
    }
  });

  it("with no taper the race week IS the peak — RACE wins the label", () => {
    const p = phases(10, 0);
    expect(p[9]).toBe("RACE");
    expect(p).not.toContain("PEAK");
    expect(p[8]).toBe("BUILD");
  });

  it("clamps an oversized taper the way computeWeeklyTargets does", () => {
    // 5 weeks, taper 10 → effective taper 3 (always two build weeks kept):
    // W1 BASE, W2 PEAK, W3-4 TAPER, W5 RACE.
    expect(phases(5, 10)).toEqual(["BASE", "PEAK", "TAPER", "TAPER", "RACE"]);
  });

  it("degenerate spans stay sane", () => {
    expect(phases(1, 2)).toEqual(["RACE"]);
    expect(phases(2, 2)).toEqual(["BASE", "RACE"]);
  });

  it("agrees with computeWeeklyTargets about which weeks de-load", () => {
    // Structural label vs the actual curve: every RECOVERY week's target must
    // equal its block's 2nd-week target (the builder's de-load rule).
    const targets = computeWeeklyTargets(baseInput({ eventDate: mondayPlusWeeks(15) }));
    const p = phases(targets.length, 0);
    p.forEach((phase, i) => {
      if (phase === "RECOVERY") {
        expect(targets[i]!.targetMeters).toBe(targets[i - 2]!.targetMeters);
      }
    });
    expect(p).toContain("RECOVERY");
  });
});
