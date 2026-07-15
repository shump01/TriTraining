import { describe, expect, it } from "vitest";

import {
  ATL_DAYS,
  CTL_DAYS,
  MAX_FORM_EASING,
  activityTss,
  buildLoadSeries,
  formLoadFactor,
  formStatus,
  summarizeLoad,
  type DailyTss,
} from "@/lib/training-load";

const DAY = 86_400_000;
const MONDAY = Date.UTC(2026, 0, 5); // a UTC midnight

describe("activityTss", () => {
  it("scores one hour at threshold as ~100 TSS", () => {
    expect(activityTss(3600, 150, 150)).toBeCloseTo(100, 6);
  });

  it("scales with duration (half the time → half the TSS at the same intensity)", () => {
    expect(activityTss(1800, 150, 150)).toBeCloseTo(50, 6);
  });

  it("scales with intensity squared (easy HR → much less than threshold)", () => {
    // avgHR 120 vs LTHR 150 → IF 0.8 → 0.64 × 100 = 64 for an hour.
    expect(activityTss(3600, 120, 150)).toBeCloseTo(64, 6);
  });

  it("clamps a spurious high avg HR so IF can't blow up", () => {
    // avgHR 250 vs 150 → IF would be 1.67; clamped to 1.15 → 132.25.
    expect(activityTss(3600, 250, 150)).toBeCloseTo(132.25, 6);
  });

  it("returns 0 for missing HR, threshold, or duration", () => {
    expect(activityTss(3600, 0, 150)).toBe(0);
    expect(activityTss(3600, 150, 0)).toBe(0);
    expect(activityTss(0, 150, 150)).toBe(0);
  });
});

describe("buildLoadSeries", () => {
  it("returns nothing with no data", () => {
    expect(buildLoadSeries([], MONDAY)).toEqual([]);
  });

  it("fills rest days with zero TSS so fatigue decays", () => {
    // One 100-TSS day, then 6 rest days.
    const series = buildLoadSeries([{ dateMs: MONDAY, tss: 100 }], MONDAY + 6 * DAY);
    expect(series).toHaveLength(7);
    // ATL (7-day) rises faster than CTL (42-day) on the load day...
    expect(series[0]!.atl).toBeGreaterThan(series[0]!.ctl);
    // ...then both decay across the rest days.
    expect(series.at(-1)!.atl).toBeLessThan(series[0]!.atl);
    expect(series.at(-1)!.ctl).toBeLessThan(series[0]!.ctl);
  });

  it("sums multiple activities on the same day", () => {
    const daily: DailyTss[] = [
      { dateMs: MONDAY, tss: 40 },
      { dateMs: MONDAY, tss: 60 },
    ];
    const series = buildLoadSeries(daily, MONDAY);
    expect(series).toHaveLength(1);
    expect(series[0]!.tss).toBe(100);
  });

  it("drives Form negative during a hard ramp, positive after rest", () => {
    const daily: DailyTss[] = [];
    for (let i = 0; i < 21; i++) daily.push({ dateMs: MONDAY + i * DAY, tss: 120 });
    const ramp = buildLoadSeries(daily, MONDAY + 20 * DAY);
    // Three hard weeks: fatigue outruns fitness → negative form.
    expect(ramp.at(-1)!.tsb).toBeLessThan(0);

    // Two weeks of rest after the ramp: fatigue drops below fitness → positive form.
    const rested = buildLoadSeries(daily, MONDAY + 34 * DAY);
    expect(rested.at(-1)!.tsb).toBeGreaterThan(0);
    // Fitness (CTL) is higher than fatigue (ATL) once rested.
    expect(rested.at(-1)!.ctl).toBeGreaterThan(rested.at(-1)!.atl);
  });

  it("CTL and ATL both trend toward a sustained daily load", () => {
    const daily: DailyTss[] = [];
    for (let i = 0; i < 120; i++) daily.push({ dateMs: MONDAY + i * DAY, tss: 80 });
    const series = buildLoadSeries(daily, MONDAY + 119 * DAY);
    // ATL (fast) converges close to the daily load; CTL (slow) climbs toward it.
    expect(series.at(-1)!.atl).toBeGreaterThan(75);
    expect(series.at(-1)!.ctl).toBeGreaterThan(60);
    expect(series.at(-1)!.ctl).toBeLessThan(series.at(-1)!.atl + 1);
  });

  it("uses the documented time constants", () => {
    expect(CTL_DAYS).toBe(42);
    expect(ATL_DAYS).toBe(7);
  });
});

describe("formStatus", () => {
  it("bands Form into readiness labels", () => {
    expect(formStatus(25).key).toBe("fresh");
    expect(formStatus(0).key).toBe("neutral");
    expect(formStatus(-20).key).toBe("productive");
    expect(formStatus(-40).key).toBe("overreaching");
  });
});

describe("formLoadFactor", () => {
  it("leaves the ramp untouched for fresh, balanced, or productively-fatigued Form", () => {
    expect(formLoadFactor(20)).toBe(1); // fresh
    expect(formLoadFactor(0)).toBe(1); // balanced
    expect(formLoadFactor(-25)).toBe(1); // productive — desirable stress, don't blunt
    expect(formLoadFactor(-30)).toBe(1); // exactly at the overreaching boundary
  });

  it("eases only once Form crosses into overreaching, deepening with fatigue", () => {
    // Below −30 it starts easing; monotonically stronger as TSB drops.
    expect(formLoadFactor(-35)).toBeLessThan(1);
    expect(formLoadFactor(-45)).toBeLessThan(formLoadFactor(-35));
  });

  it("saturates at the maximum easing for deep overreaching", () => {
    expect(formLoadFactor(-55)).toBeCloseTo(1 - MAX_FORM_EASING, 6);
    expect(formLoadFactor(-80)).toBeCloseTo(1 - MAX_FORM_EASING, 6); // clamped, no further
  });

  it("returns 1 for a non-finite TSB", () => {
    expect(formLoadFactor(NaN)).toBe(1);
    expect(formLoadFactor(Infinity)).toBe(1);
  });

  it("eases exactly when Form reads overreaching (factor < 1 ⟺ status)", () => {
    for (const tsb of [10, 0, -20, -30, -31, -50]) {
      const overreaching = formStatus(tsb).key === "overreaching";
      expect(formLoadFactor(tsb) < 1).toBe(overreaching);
    }
  });
});

describe("summarizeLoad", () => {
  it("returns null for an empty series", () => {
    expect(summarizeLoad([])).toBeNull();
  });

  it("reports rounded fitness / fatigue / form + last-7-day load", () => {
    const daily: DailyTss[] = [];
    for (let i = 0; i < 30; i++) daily.push({ dateMs: MONDAY + i * DAY, tss: 100 });
    const s = summarizeLoad(buildLoadSeries(daily, MONDAY + 29 * DAY))!;
    expect(Number.isInteger(s.fitness)).toBe(true);
    expect(Number.isInteger(s.form)).toBe(true);
    expect(s.form).toBe(s.fitness - s.fatigue);
    expect(s.weekLoad).toBe(700); // seven 100-TSS days
  });
});
