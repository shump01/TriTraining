import { describe, expect, it } from "vitest";

import { computeProgress, type ProgressWeekInput } from "./progress";

// Mondays.
const W = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const weeks: ProgressWeekInput[] = [
  { weekStartDate: W("2026-01-05"), target: 10000, actual: 10000 }, // past, on track
  { weekStartDate: W("2026-01-12"), target: 11000, actual: null }, // past, missed (0)
  { weekStartDate: W("2026-01-19"), target: 12000, actual: 14000 }, // past, ahead
  { weekStartDate: W("2026-01-26"), target: 13000, actual: 4000 }, // current
  { weekStartDate: W("2026-02-02"), target: 14000, actual: null }, // future
];
// "now" inside the 2026-01-26 week (Wednesday).
const NOW = new Date("2026-01-28T09:00:00.000Z");

describe("computeProgress", () => {
  it("classifies week phases relative to the current week", () => {
    const { weeks: rows } = computeProgress(weeks, NOW);
    expect(rows.map((r) => r.phase)).toEqual(["past", "past", "past", "current", "future"]);
  });

  it("treats a missed past week as 0 / behind (not blank)", () => {
    const { weeks: rows } = computeProgress(weeks, NOW);
    expect(rows[1]).toMatchObject({ actual: 0, pctOfTarget: 0, status: "behind" });
  });

  it("marks future weeks as target-only (null actual, no status)", () => {
    const { weeks: rows } = computeProgress(weeks, NOW);
    expect(rows[4]).toMatchObject({ actual: null, pctOfTarget: null, status: null });
  });

  it("computes per-week status (onTrack / ahead / behind)", () => {
    const { weeks: rows } = computeProgress(weeks, NOW);
    expect(rows[0]!.status).toBe("onTrack"); // 100%
    expect(rows[2]!.status).toBe("ahead"); // ~117%
    expect(rows[3]!.status).toBe("behind"); // current, 4000/13000 so far
  });

  it("accumulates target and actual across weeks", () => {
    const { weeks: rows } = computeProgress(weeks, NOW);
    // through the current week: targets 10+11+12+13=46k; actuals 10+0+14+4=28k
    expect(rows[3]).toMatchObject({ cumulativeTarget: 46000, cumulativeActual: 28000 });
    // future week adds its target but not actual
    expect(rows[4]!.cumulativeTarget).toBe(60000);
    expect(rows[4]!.cumulativeActual).toBe(28000);
  });

  it("summarizes to-date cumulative %, status, started/finished", () => {
    const { summary } = computeProgress(weeks, NOW);
    expect(summary).toMatchObject({
      started: true,
      finished: false,
      cumulativeTarget: 46000,
      cumulativeActual: 28000,
      pctOfTarget: 61, // 28000/46000
      status: "behind",
    });
  });

  it("reports not-started when the plan's first week is in the future", () => {
    const { summary, weeks: rows } = computeProgress(weeks, new Date("2025-12-01T00:00:00.000Z"));
    expect(summary.started).toBe(false);
    expect(summary.status).toBeNull();
    expect(summary.pctOfTarget).toBeNull();
    expect(rows.every((r) => r.phase === "future")).toBe(true);
  });

  it("reports finished once now is past the last week", () => {
    const { summary } = computeProgress(weeks, new Date("2026-03-01T00:00:00.000Z"));
    expect(summary.finished).toBe(true);
    expect(summary.cumulativeTarget).toBe(60000); // all weeks counted
  });
});
