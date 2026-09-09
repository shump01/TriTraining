import { describe, expect, it } from "vitest";

import {
  buildMemberDisciplineStats,
  buildMemberWeekStats,
  rankByWeekPct,
  type PlanForStats,
} from "./group-stats";

const MONDAY = new Date("2026-01-05T00:00:00.000Z"); // week +0
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const mondayPlus = (w: number) => new Date(MONDAY.getTime() + w * WEEK_MS);

// "now" inside week +1 (Wednesday) → current week = 2026-01-12.
const NOW = new Date("2026-01-14T09:00:00.000Z");

function plan(overrides: Partial<PlanForStats> = {}): PlanForStats {
  return {
    weekStartDay: 1,
    weeklyTargets: [
      { discipline: "RUN", weekStartDate: mondayPlus(0), targetMeters: 10000 },
      { discipline: "RUN", weekStartDate: mondayPlus(1), targetMeters: 12000 },
      { discipline: "RUN", weekStartDate: mondayPlus(2), targetMeters: 14000 },
      { discipline: "SWIM", weekStartDate: mondayPlus(0), targetMeters: 2000 },
      { discipline: "SWIM", weekStartDate: mondayPlus(1), targetMeters: 2500 },
      { discipline: "SWIM", weekStartDate: mondayPlus(2), targetMeters: 3000 },
    ],
    weeklyActuals: [
      // Current week (2026-01-12): RUN 6,000 of 12,000 = 50%.
      { discipline: "RUN", weekStartDate: mondayPlus(1), actualMeters: 6000, source: "MANUAL" },
    ],
    weeklyPauses: [],
    ...overrides,
  };
}

describe("buildMemberDisciplineStats", () => {
  it("returns the current week's % of target per discipline", () => {
    const stats = buildMemberDisciplineStats(plan(), NOW);
    const run = stats.find((s) => s.key === "RUN");
    const swim = stats.find((s) => s.key === "SWIM");
    expect(run?.pct).toBe(50); // 6,000 / 12,000
    // SWIM has no actual for the current week → counts as 0 of 2,500 = 0%.
    expect(swim?.pct).toBe(0);
    expect(run?.label).toBe("Run");
  });

  it("only returns disciplines the plan includes", () => {
    const runOnly = buildMemberDisciplineStats(
      plan({
        weeklyTargets: [
          { discipline: "RUN", weekStartDate: mondayPlus(0), targetMeters: 10000 },
          { discipline: "RUN", weekStartDate: mondayPlus(1), targetMeters: 12000 },
        ],
        weeklyActuals: [],
      }),
      NOW,
    );
    expect(runOnly.map((s) => s.key)).toEqual(["RUN"]);
  });

  it("gives a null pct when there is no current week (plan already finished)", () => {
    // now is well past the last week → no week is 'current'.
    const stats = buildMemberDisciplineStats(plan(), new Date("2026-03-01T00:00:00.000Z"));
    for (const s of stats) expect(s.pct).toBeNull();
  });

  it("respects a non-default week-start day", () => {
    // Sunday weeks: the week containing NOW starts 2026-01-11 (Sunday).
    const sundayPlan: PlanForStats = {
      weekStartDay: 0,
      weeklyTargets: [
        {
          discipline: "RUN",
          weekStartDate: new Date("2026-01-04T00:00:00.000Z"),
          targetMeters: 10000,
        },
        {
          discipline: "RUN",
          weekStartDate: new Date("2026-01-11T00:00:00.000Z"),
          targetMeters: 12000,
        },
        {
          discipline: "RUN",
          weekStartDate: new Date("2026-01-18T00:00:00.000Z"),
          targetMeters: 14000,
        },
      ],
      weeklyActuals: [
        {
          discipline: "RUN",
          weekStartDate: new Date("2026-01-11T00:00:00.000Z"),
          actualMeters: 3000,
          source: "STRAVA",
        },
      ],
      weeklyPauses: [],
    };
    const stats = buildMemberDisciplineStats(sundayPlan, NOW);
    expect(stats.find((s) => s.key === "RUN")?.pct).toBe(25); // 3,000 / 12,000
  });

  it("a paused current week still shares the same per-week % (no group-visible change)", () => {
    // The pause feeds the engine's cumulative exclusion, but the shared stat is
    // the CURRENT week's own %, which stays as-is — a pause must not change
    // what the group sees (the reason never leaves the owner at all).
    const stats = buildMemberDisciplineStats(
      plan({ weeklyPauses: [{ weekStartDate: mondayPlus(1) }] }),
      NOW,
    );
    expect(stats.find((s) => s.key === "RUN")?.pct).toBe(50);
  });
});

describe("buildMemberWeekStats", () => {
  const actuals = (rows: [string, number, number][]) =>
    rows.map(([discipline, week, meters]) => ({
      discipline,
      weekStartDate: mondayPlus(week),
      actualMeters: meters,
      source: "MANUAL" as const,
    }));

  it("reports this week, last week, and the on-target streak from the combined series", () => {
    const stats = buildMemberWeekStats(
      plan({
        weeklyActuals: actuals([
          ["RUN", 0, 10000],
          ["SWIM", 0, 2000], // last week: 12,000 of 12,000 → 100%, on target
          ["RUN", 1, 6000],
          ["SWIM", 1, 1250], // this week: 7,250 of 14,500 → 50%
        ]),
      }),
      NOW,
    );
    expect(stats.lastWeekPct).toBe(100);
    expect(stats.weekPct).toBe(50);
    expect(stats.streak).toBe(1);
  });

  it("treats a paused last week as no score and breaks the streak", () => {
    const stats = buildMemberWeekStats(
      plan({
        weeklyActuals: actuals([["RUN", 0, 10000], ["SWIM", 0, 2000]]),
        weeklyPauses: [{ weekStartDate: mondayPlus(0) }],
      }),
      NOW,
    );
    expect(stats.lastWeekPct).toBeNull();
    expect(stats.streak).toBe(0);
  });

  it("has no standing without a current week", () => {
    const stats = buildMemberWeekStats(plan(), new Date("2026-03-01T00:00:00.000Z"));
    expect(stats.weekPct).toBeNull();
  });
});

describe("rankByWeekPct", () => {
  it("ranks by percent, shares ranks on ties, and leaves plan-less members unranked", () => {
    const members = [
      { name: "a", weekPct: 80 },
      { name: "b", weekPct: 95 },
      { name: "c", weekPct: 95 },
      { name: "d", weekPct: null },
      { name: "e", weekPct: 20 },
    ];
    const ranks = rankByWeekPct(members);
    expect(members.map((m) => ranks.get(m))).toEqual([3, 1, 1, null, 4]);
  });
});
