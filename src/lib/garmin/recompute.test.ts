import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, tx } = vi.hoisted(() => {
  const tx = {
    weeklyActual: { deleteMany: vi.fn(), createMany: vi.fn() },
    activityLoad: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      garminActivity: { findMany: vi.fn() },
      trainingPlan: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma }));

import { recomputeGarminDerivedRows } from "./recompute";

/** The single call's first argument, typed — throws if the mock wasn't called. */
function firstCallArg<T>(fn: { mock: { calls: unknown[][] } }): T {
  const arg = fn.mock.calls[0]?.[0];
  if (arg === undefined) throw new Error("mock was not called");
  return arg as T;
}

/**
 * The plan runs Mondays from 2026-07-06 to the event on 2026-09-06, and only
 * tracks RUN + BIKE (no swim) — so swim activities feed load but never actuals.
 */
const PLAN = {
  id: "plan-1",
  startDate: new Date("2026-07-06T00:00:00.000Z"),
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  eventDate: new Date("2026-09-06T00:00:00.000Z"),
  weekStartDay: 1,
  disciplines: [{ discipline: "RUN" }, { discipline: "BIKE" }],
};

const ACTIVITIES = [
  // Week-1 run with HR → weekly actual + load row.
  {
    activityId: "a1",
    sportType: "RUNNING",
    startTimeUtc: new Date("2026-07-08T09:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 10_000,
    durationSeconds: 3_600,
    avgHr: 150,
  },
  // Week-2 run WITHOUT HR → weekly actual only (no hrTSS without a heart rate).
  {
    activityId: "a2",
    sportType: "RUNNING",
    startTimeUtc: new Date("2026-07-15T09:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 5_000,
    durationSeconds: 1_800,
    avgHr: null,
  },
  // Swim with HR — not a plan discipline → load row only (load is whole-athlete).
  {
    activityId: "a3",
    sportType: "LAP_SWIMMING",
    startTimeUtc: new Date("2026-07-08T06:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 2_000,
    durationSeconds: 2_400,
    avgHr: 140,
  },
  // Untracked type → contributes to nothing.
  {
    activityId: "a4",
    sportType: "WALKING",
    startTimeUtc: new Date("2026-07-09T09:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 5_000,
    durationSeconds: 3_000,
    avgHr: 120,
  },
  // Bike before the plan's first week → outside the actuals range, load still counts.
  {
    activityId: "a5",
    sportType: "ROAD_BIKING",
    startTimeUtc: new Date("2026-06-01T10:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 40_000,
    durationSeconds: 5_400,
    avgHr: 130,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  prisma.garminActivity.findMany.mockResolvedValue(ACTIVITIES);
  prisma.trainingPlan.findMany.mockResolvedValue([PLAN]);
});

describe("recomputeGarminDerivedRows", () => {
  it("rebuilds GARMIN weekly actuals fanned to plan range and disciplines", async () => {
    const result = await recomputeGarminDerivedRows("user-1");

    expect(tx.weeklyActual.createMany).toHaveBeenCalledTimes(1);
    const { data } = firstCallArg<{ data: unknown[] }>(tx.weeklyActual.createMany);
    expect(data).toEqual(
      expect.arrayContaining([
        {
          planId: "plan-1",
          discipline: "RUN",
          weekStartDate: new Date("2026-07-06T00:00:00.000Z"),
          actualMeters: 10_000,
          source: "GARMIN",
        },
        {
          planId: "plan-1",
          discipline: "RUN",
          weekStartDate: new Date("2026-07-13T00:00:00.000Z"),
          actualMeters: 5_000,
          source: "GARMIN",
        },
      ]),
    );
    // The swim (untracked discipline), the walk, and the out-of-range bike
    // must not become weekly actuals.
    expect(data).toHaveLength(2);
    expect(result.weeksWritten).toBe(2);
  });

  it("rebuilds whole-athlete GARMIN load rows, HR-recorded only", async () => {
    const result = await recomputeGarminDerivedRows("user-1");

    expect(tx.activityLoad.createMany).toHaveBeenCalledTimes(1);
    const { data } = firstCallArg<{
      data: { externalId: string; source: string; userId: string }[];
    }>(tx.activityLoad.createMany);
    expect(data.map((r) => r.externalId).sort()).toEqual(["a1", "a3", "a5"]);
    expect(data.every((r) => r.source === "GARMIN")).toBe(true);
    expect(data.every((r) => r.userId === "user-1")).toBe(true);
    expect(result.loadRowsWritten).toBe(3);
  });

  it("replaces ONLY GARMIN-sourced rows — other writers' rows are untouched", async () => {
    await recomputeGarminDerivedRows("user-1");

    // Both deletes carry an explicit source scope; without it a recompute
    // would wipe MANUAL/STRAVA/APPLE_HEALTH rows — the double-count guard.
    expect(tx.weeklyActual.deleteMany).toHaveBeenCalledWith({
      where: { planId: { in: ["plan-1"] }, source: "GARMIN" },
    });
    expect(tx.activityLoad.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", source: "GARMIN" },
    });
  });

  it("still rebuilds load when the user has no plans (load is not plan-scoped)", async () => {
    prisma.trainingPlan.findMany.mockResolvedValue([]);

    const result = await recomputeGarminDerivedRows("user-1");

    expect(tx.weeklyActual.deleteMany).not.toHaveBeenCalled();
    expect(tx.weeklyActual.createMany).not.toHaveBeenCalled();
    expect(tx.activityLoad.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", source: "GARMIN" },
    });
    expect(result.weeksWritten).toBe(0);
    expect(result.loadRowsWritten).toBe(3);
  });

  it("writes nothing but still clears GARMIN rows when the store is empty", async () => {
    prisma.garminActivity.findMany.mockResolvedValue([]);

    const result = await recomputeGarminDerivedRows("user-1");

    // An empty store (e.g. after a reconnect) must clear stale derived rows.
    expect(tx.weeklyActual.deleteMany).toHaveBeenCalled();
    expect(tx.activityLoad.deleteMany).toHaveBeenCalled();
    expect(tx.weeklyActual.createMany).not.toHaveBeenCalled();
    expect(tx.activityLoad.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ activities: 0, weeksWritten: 0, loadRowsWritten: 0 });
  });
});
