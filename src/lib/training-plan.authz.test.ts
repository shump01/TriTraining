import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session and the database BEFORE importing the data layer, so we can
// assert exactly how queries are scoped without touching a real DB. The mock
// fns are created via vi.hoisted so they exist when the hoisted vi.mock
// factories run.
const { authMock, findFirst, deleteMany, upsert } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    trainingPlan: { findFirst, deleteMany },
    weeklyActual: { upsert },
  },
}));

import { Discipline } from "@/generated/prisma/client";
import {
  NotFoundError,
  UnauthorizedError,
  deleteTrainingPlan,
  getTrainingPlan,
  recordManualActual,
  requireUserId,
} from "@/lib/training-plan";

// A plan belonging to someone else; "userA" is the logged-in session user.
const FOREIGN_PLAN = "plan-owned-by-userB";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("training-plan authorization (scoped to the session user)", () => {
  it("requireUserId throws when there is no session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("reads are filtered by the session userId, so a foreign plan returns null", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });
    findFirst.mockResolvedValue(null); // no row matches {id, userId: userA}

    const result = await getTrainingPlan(FOREIGN_PLAN);

    expect(result).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_PLAN, userId: "userA" } }),
    );
  });

  it("getTrainingPlan refuses without a session", async () => {
    authMock.mockResolvedValue(null);
    await expect(getTrainingPlan(FOREIGN_PLAN)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("deleteTrainingPlan only deletes rows owned by the session user", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });
    deleteMany.mockResolvedValue({ count: 0 }); // foreign plan → nothing deleted

    const deleted = await deleteTrainingPlan(FOREIGN_PLAN);

    expect(deleted).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: FOREIGN_PLAN, userId: "userA" } });
  });

  it("recordManualActual rejects (404) a plan the session user does not own", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });
    findFirst.mockResolvedValue(null); // plan not found under userA

    await expect(
      recordManualActual({
        planId: FOREIGN_PLAN,
        discipline: Discipline.RUN,
        weekStartDate: new Date("2026-01-05T00:00:00.000Z"),
        actualMeters: 1000,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_PLAN, userId: "userA" } }),
    );
    // Crucially, no write happens for a plan the user doesn't own.
    expect(upsert).not.toHaveBeenCalled();
  });
});
