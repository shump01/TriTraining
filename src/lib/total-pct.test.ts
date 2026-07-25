import { describe, expect, it } from "vitest";

import type { SeriesData, WeekRow } from "./plan-series";
import { applyTotalPctMode, balancedPct } from "./total-pct";

function week(overrides: Partial<WeekRow>): WeekRow {
  return {
    ms: Date.UTC(2026, 6, 20),
    dateStr: "2026-07-20",
    target: 10_000,
    actual: 10_000,
    phase: "past",
    pctOfTarget: 100,
    status: "onTrack",
    cumulativeActual: 10_000,
    cumulativeTarget: 10_000,
    manualMeters: null,
    effectiveSource: "STRAVA",
    paused: false,
    pauseReason: null,
    ...overrides,
  };
}

function series(key: SeriesData["key"], weeks: WeekRow[], summaryPct: number | null): SeriesData {
  return {
    key,
    label: key,
    color: "var(--brand)",
    unit: "km",
    startVol: null,
    weeks,
    summary: {
      started: true,
      finished: false,
      cumulativeActual: 0,
      cumulativeTarget: 0,
      pctOfTarget: summaryPct,
      status: "onTrack",
    },
  };
}

describe("balancedPct", () => {
  it("matches the spec example: run 100 + swim 100 + bike 0 → 67, whatever the distances", () => {
    expect(balancedPct([100, 100, 0])).toBe(67);
  });

  it("caps each discipline at 100 — overshooting one sport can't mask skipping another", () => {
    expect(balancedPct([200, 100, 0])).toBe(67);
    expect(balancedPct([500, 0])).toBe(50);
  });

  it("excludes nulls (no target / future) instead of counting them as zero", () => {
    expect(balancedPct([null, 50])).toBe(50);
    expect(balancedPct([80, null, 40])).toBe(60);
  });

  it("is null with nothing to average", () => {
    expect(balancedPct([])).toBeNull();
    expect(balancedPct([null, null])).toBeNull();
  });
});

describe("applyTotalPctMode", () => {
  const MS = Date.UTC(2026, 6, 20);
  // Bike is 80% of the week's meters and untouched; swim + run complete.
  const input = [
    series(
      "TOTAL",
      [week({ ms: MS, target: 100_000, actual: 20_000, pctOfTarget: 20, status: "behind" })],
      20,
    ),
    series("SWIM", [week({ ms: MS, target: 4_000, actual: 4_000, pctOfTarget: 100 })], 100),
    series(
      "BIKE",
      [week({ ms: MS, target: 80_000, actual: 0, pctOfTarget: 0, status: "behind" })],
      0,
    ),
    series("RUN", [week({ ms: MS, target: 16_000, actual: 16_000, pctOfTarget: 100 })], 100),
  ];

  it("distance mode returns the series untouched", () => {
    expect(applyTotalPctMode(input, "distance")).toBe(input);
  });

  it("balanced mode rewrites the TOTAL pct and re-bands its status; meters stay real", () => {
    const out = applyTotalPctMode(input, "balanced");
    const total = out.find((s) => s.key === "TOTAL")!;
    expect(total.weeks[0]!.pctOfTarget).toBe(67); // not 20
    expect(total.weeks[0]!.status).toBe("behind"); // 67% < 90% band
    expect(total.weeks[0]!.actual).toBe(20_000); // distances untouched
    expect(total.weeks[0]!.target).toBe(100_000);
    expect(total.summary.pctOfTarget).toBe(67);
    // Discipline series are never modified.
    expect(out.find((s) => s.key === "BIKE")).toBe(input.find((s) => s.key === "BIKE"));
  });

  it("bands a complete balanced week as on track, never 'ahead' (the cap)", () => {
    const done = [
      series("TOTAL", [week({ ms: MS, pctOfTarget: 150, status: "ahead" })], 150),
      series("SWIM", [week({ ms: MS, pctOfTarget: 180 })], 180),
      series("RUN", [week({ ms: MS, pctOfTarget: 120 })], 120),
    ];
    const total = applyTotalPctMode(done, "balanced").find((s) => s.key === "TOTAL")!;
    expect(total.weeks[0]!.pctOfTarget).toBe(100);
    expect(total.weeks[0]!.status).toBe("onTrack");
  });

  it("future weeks keep their null pct and upcoming status", () => {
    const withFuture = [
      series(
        "TOTAL",
        [
          week({}),
          week({
            ms: MS + 7 * 86_400_000,
            phase: "future",
            actual: null,
            pctOfTarget: null,
            status: null,
          }),
        ],
        100,
      ),
      series(
        "SWIM",
        [
          week({}),
          week({
            ms: MS + 7 * 86_400_000,
            phase: "future",
            actual: null,
            pctOfTarget: null,
            status: null,
          }),
        ],
        100,
      ),
      series(
        "RUN",
        [
          week({}),
          week({
            ms: MS + 7 * 86_400_000,
            phase: "future",
            actual: null,
            pctOfTarget: null,
            status: null,
          }),
        ],
        100,
      ),
    ];
    const total = applyTotalPctMode(withFuture, "balanced").find((s) => s.key === "TOTAL")!;
    expect(total.weeks[1]!.pctOfTarget).toBeNull();
    expect(total.weeks[1]!.status).toBeNull();
  });

  it("leaves single-sport plans (no TOTAL series) untouched", () => {
    const single = [series("RUN", [week({})], 100)];
    expect(applyTotalPctMode(single, "balanced")).toBe(single);
  });
});
