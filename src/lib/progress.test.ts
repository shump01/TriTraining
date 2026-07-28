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

describe("computeProgress — paused weeks", () => {
  // 4 past weeks + a current week. Weeks 2 and 3 are marked as time off.
  // NOW (2026-02-04, a Wednesday) puts the current week at 2026-02-02.
  const NOW = new Date("2026-02-04T09:00:00.000Z");
  const wk = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  // An athlete who hit every week they actually trained, and marked two ill
  // weeks as time off.
  const season = (paused: boolean) => [
    { weekStartDate: wk("2026-01-05"), target: 10_000, actual: 10_000 },
    { weekStartDate: wk("2026-01-12"), target: 11_000, actual: null, paused },
    { weekStartDate: wk("2026-01-19"), target: 12_000, actual: null, paused },
    { weekStartDate: wk("2026-01-26"), target: 13_000, actual: 13_000 },
    { weekStartDate: wk("2026-02-02"), target: 14_000, actual: 14_000 },
  ];

  it("THE defect: two ill weeks no longer buy a season-long 'behind' pill", () => {
    // Unpaused, the blank weeks read as missed: 37,000/60,000 = 62% — an
    // athlete who hit every healthy week perfectly wears "behind" all season.
    const charged = computeProgress(season(false), NOW).summary;
    expect(charged.status).toBe("behind");

    // Paused, those weeks sit outside the ledger: 37,000/37,000 — the pill
    // finally agrees with the readiness panel that always excluded them.
    const excused = computeProgress(season(true), NOW).summary;
    expect(excused.cumulativeTarget).toBe(37_000);
    expect(excused.cumulativeActual).toBe(37_000);
    expect(excused.pctOfTarget).toBe(100);
    expect(excused.status).toBe("onTrack");
  });

  it("a synced activity during a paused week is not credited either", () => {
    // Nothing owed, nothing earned: a spun-easy 5k logged mid-illness must not
    // pad the season total that healthy weeks have to answer for.
    const weeks = [
      { weekStartDate: wk("2026-01-05"), target: 10_000, actual: 10_000 },
      { weekStartDate: wk("2026-01-12"), target: 11_000, actual: 5_000, paused: true },
      { weekStartDate: wk("2026-02-02"), target: 14_000, actual: 7_000 },
    ];
    const { summary } = computeProgress(weeks, NOW);
    expect(summary.cumulativeTarget).toBe(24_000);
    expect(summary.cumulativeActual).toBe(17_000);
  });

  it("a paused CURRENT week is excluded too", () => {
    const weeks = [
      { weekStartDate: wk("2026-01-26"), target: 13_000, actual: 13_000 },
      { weekStartDate: wk("2026-02-02"), target: 14_000, actual: null, paused: true },
    ];
    const { summary } = computeProgress(weeks, NOW);
    expect(summary.cumulativeTarget).toBe(13_000);
    expect(summary.pctOfTarget).toBe(100);
    expect(summary.status).toBe("onTrack");
  });

  it("per-week fields are unchanged for paused weeks (the row UI owns the Paused pill)", () => {
    const withPause = computeProgress(season(true), NOW).weeks[1]!;
    const withoutPause = computeProgress(season(false), NOW).weeks[1]!;
    expect(withPause.pctOfTarget).toBe(withoutPause.pctOfTarget);
    expect(withPause.status).toBe(withoutPause.status);
    expect(withPause.actual).toBe(withoutPause.actual);
  });

  it("an all-paused season has no percentage and a neutral status", () => {
    const weeks = [
      { weekStartDate: wk("2026-01-19"), target: 12_000, actual: null, paused: true },
      { weekStartDate: wk("2026-01-26"), target: 13_000, actual: null, paused: true },
    ];
    const { summary } = computeProgress(weeks, NOW);
    expect(summary.started).toBe(true);
    expect(summary.pctOfTarget).toBeNull();
    expect(summary.status).toBe("onTrack"); // classify(0, 0) — nothing to judge
  });

  it("future weeks are unaffected by the flag (still uncounted, still null)", () => {
    const { weeks: rows } = computeProgress(
      [
        { weekStartDate: wk("2026-02-02"), target: 14_000, actual: 7_000 },
        { weekStartDate: wk("2026-02-09"), target: 15_000, actual: null, paused: true },
      ],
      NOW,
    );
    expect(rows[1]!.phase).toBe("future");
    expect(rows[1]!.actual).toBeNull();
    expect(rows[1]!.cumulativeTarget).toBe(14_000);
  });
});
