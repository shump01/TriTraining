import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  planFindFirst,
  sessionFindMany,
  targetFindMany,
  deleteMany,
  createMany,
  transaction,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  planFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  targetFindMany: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    trainingPlan: { findFirst: planFindFirst },
    plannedSession: { findMany: sessionFindMany, deleteMany, createMany },
    weeklyTarget: { findMany: targetFindMany },
    $transaction: transaction,
  },
}));

import {
  InvalidSessionsError,
  NotFoundError,
  WeekOutOfRangeError,
  replaceWeekSessions,
  type WeekSessionInput,
} from "@/lib/training-plan";

const PLAN = {
  id: "plan-1",
  startDate: new Date("2026-07-06T00:00:00.000Z"), // a Monday
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  eventDate: new Date("2026-09-06T00:00:00.000Z"),
  weekStartDay: 1,
  disciplines: [{ discipline: "RUN" }, { discipline: "BIKE" }],
};

const WEEK = new Date("2026-07-20T00:00:00.000Z");

function runWeek(overrides: Partial<WeekSessionInput>[] = []): WeekSessionInput[] {
  const base: WeekSessionInput[] = [
    { discipline: "RUN", slot: 0, label: "Long run", share: 0.4, dayOffset: 6, done: false },
    { discipline: "RUN", slot: 1, label: "Tempo", share: 0.3, dayOffset: 1, done: false },
    { discipline: "RUN", slot: 2, label: "Easy", share: 0.3, dayOffset: 3, done: false },
  ];
  overrides.forEach((o, i) => Object.assign(base[i]!, o));
  return base;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "userA" } });
  planFindFirst.mockResolvedValue(PLAN);
  sessionFindMany.mockResolvedValue([]);
  // Default: only RUN has volume this week, so a RUN-only payload is complete.
  targetFindMany.mockResolvedValue([
    { discipline: "RUN", targetMeters: 40_000 },
    { discipline: "BIKE", targetMeters: 0 },
  ]);
});

describe("replaceWeekSessions", () => {
  it("a foreign plan 404s before any write", async () => {
    planFindFirst.mockResolvedValue(null);
    await expect(
      replaceWeekSessions({ planId: "not-mine", weekStartDate: WEEK, sessions: runWeek() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(planFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "not-mine", userId: "userA" } }),
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a week outside the plan's range", async () => {
    await expect(
      replaceWeekSessions({
        planId: PLAN.id,
        weekStartDate: new Date("2026-10-05T00:00:00.000Z"), // after the race
        sessions: runWeek(),
      }),
    ).rejects.toBeInstanceOf(WeekOutOfRangeError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects sessions on a discipline the plan doesn't include", async () => {
    await expect(
      replaceWeekSessions({
        planId: PLAN.id,
        weekStartDate: WEEK,
        sessions: [
          { discipline: "SWIM", slot: 0, label: "Endurance", share: 1, dayOffset: 2, done: false },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidSessionsError);
  });

  it("rejects duplicate slots and shares that don't cover the week", async () => {
    await expect(
      replaceWeekSessions({
        planId: PLAN.id,
        weekStartDate: WEEK,
        sessions: runWeek([{}, { slot: 0 }]), // two slot-0 RUN sessions
      }),
    ).rejects.toBeInstanceOf(InvalidSessionsError);

    await expect(
      replaceWeekSessions({
        planId: PLAN.id,
        weekStartDate: WEEK,
        sessions: runWeek([{ share: 0.1 }]), // sums to 0.7
      }),
    ).rejects.toBeInstanceOf(InvalidSessionsError);
  });

  it("rejects a payload missing a discipline that has volume this week", async () => {
    // BIKE has a positive target: a RUN-only payload would silently delete
    // every BIKE session in the week-scoped replace.
    targetFindMany.mockResolvedValue([
      { discipline: "RUN", targetMeters: 40_000 },
      { discipline: "BIKE", targetMeters: 90_000 },
    ]);
    await expect(
      replaceWeekSessions({ planId: PLAN.id, weekStartDate: WEEK, sessions: runWeek() }),
    ).rejects.toBeInstanceOf(InvalidSessionsError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("replaces the week transactionally, scoped to (plan, week)", async () => {
    await replaceWeekSessions({ planId: PLAN.id, weekStartDate: WEEK, sessions: runWeek() });

    expect(deleteMany).toHaveBeenCalledWith({
      where: { planId: PLAN.id, weekStartDate: WEEK },
    });
    const { data } = createMany.mock.calls[0]![0] as {
      data: { planId: string; weekStartDate: Date; completedAt: Date | null }[];
    };
    expect(data).toHaveLength(3);
    expect(data.every((r) => r.planId === PLAN.id)).toBe(true);
    expect(data.every((r) => r.weekStartDate.getTime() === WEEK.getTime())).toBe(true);
    expect(data.every((r) => r.completedAt === null)).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("a still-done session keeps its ORIGINAL completion timestamp across a move", async () => {
    const original = new Date("2026-07-21T07:30:00.000Z");
    sessionFindMany.mockResolvedValue([{ discipline: "RUN", slot: 1, completedAt: original }]);

    await replaceWeekSessions({
      planId: PLAN.id,
      weekStartDate: WEEK,
      sessions: runWeek([{}, { done: true, dayOffset: 4 }, { done: true }]),
    });

    const { data } = createMany.mock.calls[0]![0] as {
      data: { slot: number; completedAt: Date | null }[];
    };
    // Slot 1 was already done — timestamp preserved despite the day move.
    expect(data.find((r) => r.slot === 1)!.completedAt).toEqual(original);
    // Slot 2 is newly ticked — gets a fresh timestamp.
    expect(data.find((r) => r.slot === 2)!.completedAt).toBeInstanceOf(Date);
    expect(data.find((r) => r.slot === 2)!.completedAt).not.toEqual(original);
    // Slot 0 stays unticked.
    expect(data.find((r) => r.slot === 0)!.completedAt).toBeNull();
  });
});
