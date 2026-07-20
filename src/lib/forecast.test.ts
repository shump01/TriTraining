import { describe, expect, it } from "vitest";

import {
  DEFAULT_TSS_PER_METER,
  buildRaceForecast,
  deriveTssPerMeter,
  estimateWeekTss,
  raceDayVerdict,
  type ForecastWeek,
  type WeekSample,
} from "./forecast";
import { buildLoadSeries } from "./training-load";

const DAY_MS = 86_400_000;
// Monday 2026-07-20 (UTC midnight) is "today"; race Sunday 2026-08-30.
const TODAY = Date.UTC(2026, 6, 20);
const NOW = TODAY + 9 * 3_600_000; // 09:00 — must round down to TODAY
const RACE_DAY = Date.UTC(2026, 7, 30);

/** Steady history: `days` days of `tss`/day ending on `endMs` (inclusive). */
function history(days: number, tss: number, endMs: number = TODAY) {
  return Array.from({ length: days }, (_, i) => ({
    dateMs: endMs - (days - 1 - i) * DAY_MS,
    tss,
  }));
}

function week(weekStartMs: number, runMeters: number, paused = false): ForecastWeek {
  return { weekStartMs, targets: [{ discipline: "RUN", targetMeters: runMeters }], paused };
}

/** Six plan weeks Monday-aligned from TODAY through the race week. */
function planWeeks(runMetersPerWeek: number): ForecastWeek[] {
  return Array.from({ length: 6 }, (_, i) => week(TODAY + i * 7 * DAY_MS, runMetersPerWeek));
}

describe("deriveTssPerMeter", () => {
  const sample = (tss: number, meters = 40_000): WeekSample => ({
    discipline: "RUN",
    meters,
    tss,
  });

  it("derives the athlete's own rate given enough weeks", () => {
    const { rates, derived } = deriveTssPerMeter([sample(200), sample(200)]);
    expect(rates.RUN).toBeCloseTo(400 / 80_000, 6);
    expect(derived.RUN).toBe(true);
    // Untouched disciplines keep the default, marked underived.
    expect(rates.BIKE).toBe(DEFAULT_TSS_PER_METER.BIKE);
    expect(derived.BIKE).toBe(false);
  });

  it("falls back to the default below the minimum-weeks threshold", () => {
    const { rates, derived } = deriveTssPerMeter([sample(200)]);
    expect(rates.RUN).toBe(DEFAULT_TSS_PER_METER.RUN);
    expect(derived.RUN).toBe(false);
  });

  it("ignores zero-meter and zero-tss weeks", () => {
    const { derived } = deriveTssPerMeter([
      sample(200),
      { discipline: "RUN", meters: 0, tss: 300 },
      { discipline: "RUN", meters: 30_000, tss: 0 },
    ]);
    expect(derived.RUN).toBe(false); // only one usable week
  });

  it("clamps a garbage-data rate to a sane multiple of the default", () => {
    // Absurdly high: 10,000 TSS over 1km/week (mislabeled activities).
    const { rates } = deriveTssPerMeter([sample(10_000, 1_000), sample(10_000, 1_000)]);
    expect(rates.RUN).toBe(DEFAULT_TSS_PER_METER.RUN * 4);
  });
});

describe("estimateWeekTss", () => {
  it("sums targets × rate and zeroes paused weeks", () => {
    const rates = { ...DEFAULT_TSS_PER_METER, RUN: 0.005 };
    expect(estimateWeekTss(week(TODAY, 40_000), rates)).toBeCloseTo(200);
    expect(estimateWeekTss(week(TODAY, 40_000, true), rates)).toBe(0);
  });
});

describe("raceDayVerdict bands", () => {
  it("maps TSB to the PMC race bands", () => {
    expect(raceDayVerdict(30).key).toBe("detrained");
    expect(raceDayVerdict(15).key).toBe("primed");
    expect(raceDayVerdict(5).key).toBe("sharp");
    expect(raceDayVerdict(-5).key).toBe("carrying");
    expect(raceDayVerdict(-20).key).toBe("fatigued");
  });
});

describe("buildRaceForecast", () => {
  it("returns null without history or with a past race", () => {
    expect(
      buildRaceForecast({
        history: [],
        nowMs: NOW,
        raceDayMs: RACE_DAY,
        weeks: planWeeks(40_000),
        rates: DEFAULT_TSS_PER_METER,
      }),
    ).toBeNull();
    expect(
      buildRaceForecast({
        history: history(30, 60),
        nowMs: NOW,
        raceDayMs: TODAY,
        weeks: [],
        rates: DEFAULT_TSS_PER_METER,
      }),
    ).toBeNull();
  });

  it("projects daily points from tomorrow through race day exactly", () => {
    const f = buildRaceForecast({
      history: history(30, 60),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks: planWeeks(40_000),
      rates: DEFAULT_TSS_PER_METER,
    });
    expect(f).not.toBeNull();
    expect(f!.anchor.dateMs).toBe(TODAY);
    expect(f!.projection[0]?.dateMs).toBe(TODAY + DAY_MS);
    expect(f!.projection.at(-1)?.dateMs).toBe(RACE_DAY);
    expect(f!.projection).toHaveLength((RACE_DAY - TODAY) / DAY_MS);
  });

  it("matches the PMC fold exactly — projection is the same math as history", () => {
    // Constant 60 TSS/day history + weeks estimated at exactly 60 TSS/day must
    // continue the same series buildLoadSeries produces — including race day
    // as a zero-load decay day (race morning has no training behind it). The
    // current week nets its banked Monday (60 banked of 420 → 60/day remains).
    const rates = { ...DEFAULT_TSS_PER_METER, RUN: 1 };
    const weeks = Array.from({ length: 6 }, (_, i) => ({
      weekStartMs: TODAY + i * 7 * DAY_MS,
      targets: [{ discipline: "RUN" as const, targetMeters: 420 }], // 60/day
      paused: false,
    }));
    const f = buildRaceForecast({
      history: history(30, 60),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks,
      rates,
    });
    const trainingDays = (RACE_DAY - DAY_MS - TODAY) / DAY_MS; // through race eve
    const reference = buildLoadSeries(
      history(30 + trainingDays, 60, RACE_DAY - DAY_MS),
      RACE_DAY, // fold extends over the zero-load race day
    );
    expect(f!.projection.at(-1)!.ctl).toBeCloseTo(reference.at(-1)!.ctl, 6);
    expect(f!.projection.at(-1)!.tsb).toBeCloseTo(reference.at(-1)!.tsb, 6);
  });

  it("race day itself carries no estimated training dose", () => {
    const f = buildRaceForecast({
      history: history(30, 60),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks: planWeeks(40_000),
      rates: DEFAULT_TSS_PER_METER,
    });
    expect(f!.projection.at(-1)!.dateMs).toBe(RACE_DAY);
    expect(f!.projection.at(-1)!.tss).toBe(0);
  });

  it("nets the current week's banked volume — a done week projects no extra load", () => {
    // Monday's history (300 TSS) already exceeds the week's estimate
    // (40km run ≈ 230 TSS), so Tue…Sun of the current week must project 0 —
    // while the NEXT week still projects its full estimate.
    const f = buildRaceForecast({
      history: history(30, 300),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks: planWeeks(40_000),
      rates: DEFAULT_TSS_PER_METER,
    });
    const weekTss = 40_000 * DEFAULT_TSS_PER_METER.RUN;
    expect(f!.projection[0]!.tss).toBe(0); // Tuesday of the current week
    expect(f!.projection[6]!.tss).toBeCloseTo(weekTss / 7, 6); // next Monday
  });

  it("a taper raises race-day Form above today's", () => {
    const heavy = history(60, 80);
    const weeks = [
      ...Array.from({ length: 4 }, (_, i) => week(TODAY + i * 7 * DAY_MS, 60_000)),
      week(TODAY + 28 * DAY_MS, 30_000), // taper
      week(TODAY + 35 * DAY_MS, 15_000), // race week
    ];
    const f = buildRaceForecast({
      history: heavy,
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks,
      rates: DEFAULT_TSS_PER_METER,
    });
    expect(f!.raceDay.form).toBeGreaterThan(Math.round(f!.anchor.tsb));
    // The taper trades some fitness away: race-day CTL below the pre-taper peak.
    expect(f!.raceDay.fitness).toBeLessThan(f!.peakFitness);
    // The verdict is banded on the SAME rounded Form the card displays.
    expect(f!.verdict.key).toBe(raceDayVerdict(f!.raceDay.form).key);
  });

  it("paused weeks decay load instead of accruing it", () => {
    const base = {
      history: history(30, 60),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      rates: DEFAULT_TSS_PER_METER,
    };
    const training = buildRaceForecast({ ...base, weeks: planWeeks(40_000) });
    const pausedAll = buildRaceForecast({
      ...base,
      weeks: planWeeks(40_000).map((w) => ({ ...w, paused: true })),
    });
    expect(pausedAll!.raceDay.fitness).toBeLessThan(training!.raceDay.fitness);
    // Full rest to race day = maximum freshness.
    expect(pausedAll!.raceDay.form).toBeGreaterThan(training!.raceDay.form);
  });

  it("only estimates days strictly after today — lived days stay real", () => {
    // Current week has a huge target, but today is Monday: only Tue…Sun of it
    // may be estimated. The anchor must equal the pure-history fold at today.
    const f = buildRaceForecast({
      history: history(30, 60),
      nowMs: NOW,
      raceDayMs: RACE_DAY,
      weeks: planWeeks(1_000_000),
      rates: DEFAULT_TSS_PER_METER,
    });
    const pastOnly = buildLoadSeries(history(30, 60), NOW);
    expect(f!.anchor.ctl).toBeCloseTo(pastOnly.at(-1)!.ctl, 6);
    expect(f!.anchor.tsb).toBeCloseTo(pastOnly.at(-1)!.tsb, 6);
  });
});
