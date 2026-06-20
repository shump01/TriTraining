import { describe, expect, it } from "vitest";

import {
  BLOCK_WEEKS,
  CAP_MULTIPLE,
  MAX_WEEKLY_INCREASE,
  computeWeeklyTargets,
  firstMondayOnOrAfter,
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

describe("firstMondayOnOrAfter", () => {
  it("returns the same day when given a Monday (at UTC midnight)", () => {
    const result = firstMondayOnOrAfter(new Date("2026-01-05T00:00:00.000Z"));
    expect(result.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it.each([
    ["2026-01-04", "2026-01-05"], // Sunday  -> next day
    ["2026-01-06", "2026-01-12"], // Tuesday -> following Monday
    ["2026-01-03", "2026-01-05"], // Saturday -> +2 days
  ])("maps %s to Monday %s", (input, expected) => {
    const result = firstMondayOnOrAfter(new Date(`${input}T00:00:00.000Z`));
    expect(result.toISOString().slice(0, 10)).toBe(expected);
    expect(result.getUTCDay()).toBe(1);
  });

  it("normalizes a date with a time component to UTC-midnight Monday", () => {
    const result = firstMondayOnOrAfter(new Date("2026-01-06T15:30:00.000Z")); // Tue afternoon
    expect(result.toISOString()).toBe("2026-01-12T00:00:00.000Z");
  });

  it("throws on an invalid Date", () => {
    expect(() => firstMondayOnOrAfter(new Date("nope"))).toThrow(/valid Date/);
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
      baseInput({ eventDate: mondayPlusWeeks(3), startingWeeklyMeters: 100_000 }),
    );
    const [w1, w2, w3, w4] = result.map((t) => t.targetMeters);
    expect(w2!).toBeGreaterThan(w1!); // build
    expect(w3!).toBeGreaterThan(w2!); // build
    expect(w4!).toBe(w2!); // de-load to the 2nd week
  });
});

describe("computeWeeklyTargets — the 3.5× cap and evened ramp", () => {
  it("never exceeds 3.5× the event distance", () => {
    const eventDistanceMeters = 3_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters;
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(52),
      startingWeeklyMeters: 5_000,
      eventDistanceMeters,
    });
    for (const t of result) {
      expect(t.targetMeters).toBeLessThanOrEqual(cap);
    }
  });

  it("builds at an even rate (under 12%) and reaches the cap at the peak", () => {
    const eventDistanceMeters = 20_000;
    const cap = CAP_MULTIPLE * eventDistanceMeters; // 70,000
    const result = computeWeeklyTargets({
      startDate: MONDAY,
      eventDate: mondayPlusWeeks(7), // 8 weeks
      startingWeeklyMeters: 50_000,
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
    const common = { startDate: MONDAY, startingWeeklyMeters: 5_000, eventDistanceMeters: 3_000 };
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
    const cap = CAP_MULTIPLE * eventDistanceMeters; // 35,000
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
