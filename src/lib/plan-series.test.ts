import { describe, expect, it } from "vitest";

import { toPublicSeries, type SeriesData, type WeekRow } from "./plan-series";

function week(overrides: Partial<WeekRow>): WeekRow {
  return {
    ms: Date.UTC(2026, 6, 20),
    dateStr: "2026-07-20",
    target: 40_000,
    actual: 38_000,
    phase: "past",
    pctOfTarget: 95,
    status: "onTrack",
    cumulativeActual: 38_000,
    cumulativeTarget: 40_000,
    manualMeters: null,
    effectiveSource: "STRAVA",
    paused: false,
    pauseReason: null,
    ...overrides,
  };
}

function series(weeks: WeekRow[]): SeriesData {
  return {
    key: "RUN",
    label: "Run",
    color: "var(--run)",
    unit: "km",
    startVol: 20_000,
    weeks,
    summary: {
      started: true,
      finished: false,
      cumulativeActual: 38_000,
      cumulativeTarget: 40_000,
      pctOfTarget: 95,
      status: "onTrack",
    },
  };
}

describe("toPublicSeries", () => {
  it("strips the pause reason (special-category health data) but keeps the paused flag", () => {
    const input = [
      series([
        week({ paused: true, pauseReason: "ILLNESS", actual: null, status: null }),
        week({ paused: true, pauseReason: "INJURY", actual: null, status: null }),
        week({}), // a normal week
      ]),
    ];

    const out = toPublicSeries(input);

    // The reason never reaches the public props…
    expect(out[0]!.weeks.every((w) => w.pauseReason === null)).toBe(true);
    // …but the boolean the shared view actually renders survives.
    expect(out[0]!.weeks[0]!.paused).toBe(true);
    expect(out[0]!.weeks[1]!.paused).toBe(true);
    expect(out[0]!.weeks[2]!.paused).toBe(false);
  });

  it("strips the fields the public view never renders: sync source and manual overrides", () => {
    // Which apps someone syncs from, and which weeks they corrected by hand,
    // are nobody else's business — and the shared page shows neither.
    const input = [series([week({ effectiveSource: "STRAVA", manualMeters: 12_000 })])];
    const out = toPublicSeries(input);
    expect(out[0]!.weeks[0]!.effectiveSource).toBeNull();
    expect(out[0]!.weeks[0]!.manualMeters).toBeNull();
  });

  it("leaves the fields the public view DOES render untouched", () => {
    const input = [series([week({ target: 51_000, actual: 49_500, pctOfTarget: 97 })])];
    const out = toPublicSeries(input);
    const w = out[0]!.weeks[0]!;
    expect(w).toMatchObject({ target: 51_000, actual: 49_500, pctOfTarget: 97, status: "onTrack" });
    expect(out[0]!.summary).toEqual(input[0]!.summary);
  });

  it("does not mutate the input series (owner-facing data keeps everything)", () => {
    const input = [series([week({ paused: true, pauseReason: "TRAVEL", manualMeters: 8_000 })])];
    toPublicSeries(input);
    expect(input[0]!.weeks[0]!.pauseReason).toBe("TRAVEL");
    expect(input[0]!.weeks[0]!.manualMeters).toBe(8_000);
    expect(input[0]!.weeks[0]!.effectiveSource).toBe("STRAVA");
  });
});
