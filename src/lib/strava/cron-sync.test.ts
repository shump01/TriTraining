import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, syncMock } = vi.hoisted(() => ({
  findMany: vi.fn(),
  syncMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { stravaConnection: { findMany } },
}));
vi.mock("./sync", () => ({ syncStravaActivities: syncMock }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { syncAllStravaConnections } from "./cron-sync";

const NOW = new Date("2026-08-10T02:00:00.000Z");

const ok = (over: Record<string, unknown> = {}) => ({
  ok: true,
  activities: 3,
  weeksWritten: 2,
  rateLimited: false,
  ...over,
});

function connections(...userIds: string[]) {
  findMany.mockResolvedValue(userIds.map((userId) => ({ userId })));
}

beforeEach(() => {
  vi.clearAllMocks();
  syncMock.mockResolvedValue(ok());
});

describe("syncAllStravaConnections", () => {
  it("syncs every due connection", async () => {
    connections("u1", "u2", "u3");
    const result = await syncAllStravaConnections(NOW);
    expect(syncMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ considered: 3, synced: 3, skipped: 0, failures: 0 });
  });

  it("only considers athletes with a plan still in play", async () => {
    connections();
    await syncAllStravaConnections(NOW);
    const where = findMany.mock.calls[0]![0].where;
    // A week's grace past race day — the final week is still filling in.
    const cutoff = where.user.trainingPlans.some.eventDate.gte as Date;
    expect(NOW.getTime() - cutoff.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("skips athletes synced within the re-sync window", async () => {
    connections();
    await syncAllStravaConnections(NOW, { minResyncMs: 6 * 60 * 60 * 1000 });
    const or = findMany.mock.calls[0]![0].where.OR;
    expect(or[0]).toEqual({ lastSyncedAt: null });
    expect((or[1].lastSyncedAt.lt as Date).toISOString()).toBe("2026-08-09T20:00:00.000Z");
  });

  it("takes the stalest first so the tail can't starve", async () => {
    connections();
    await syncAllStravaConnections(NOW);
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual({ lastSyncedAt: { sort: "asc", nulls: "first" } });
    expect(args.take).toBe(50);
  });

  it("bounds the batch so one run can't spend the whole app quota", async () => {
    connections();
    await syncAllStravaConnections(NOW, { maxUsers: 5 });
    expect(findMany.mock.calls[0]![0].take).toBe(5);
  });

  it("counts a revoked connection as skipped, not failed", async () => {
    connections("u1", "u2");
    syncMock.mockResolvedValueOnce({ ok: false, reason: "not_connected" });
    const result = await syncAllStravaConnections(NOW);
    expect(result).toMatchObject({ synced: 1, skipped: 1, failures: 0 });
  });

  it("keeps going when one athlete throws", async () => {
    connections("u1", "u2", "u3");
    syncMock.mockRejectedValueOnce(new Error("network"));
    const result = await syncAllStravaConnections(NOW);
    // u1 blew up; u2 and u3 still got their sync.
    expect(syncMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ synced: 2, failures: 1 });
  });

  it("stops the whole batch on a rate limit", async () => {
    // The quota belongs to the application, so pressing on would just collect
    // 429s and leave the interactive path throttled too.
    connections("u1", "u2", "u3");
    syncMock.mockResolvedValueOnce(ok({ rateLimited: true }));
    const result = await syncAllStravaConnections(NOW);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ synced: 1, rateLimited: true });
  });

  it("reports nothing to do without calling Strava", async () => {
    connections();
    const result = await syncAllStravaConnections(NOW);
    expect(syncMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      considered: 0,
      synced: 0,
      skipped: 0,
      failures: 0,
      rateLimited: false,
    });
  });
});
