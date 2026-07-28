import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionDeleteMany, vtDeleteMany } = vi.hoisted(() => ({
  sessionDeleteMany: vi.fn(),
  vtDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { deleteMany: sessionDeleteMany },
    verificationToken: { deleteMany: vtDeleteMany },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pruneExpiredAuthRows } from "@/lib/retention";

const NOW = new Date("2026-03-01T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  sessionDeleteMany.mockResolvedValue({ count: 0 });
  vtDeleteMany.mockResolvedValue({ count: 0 });
});

describe("pruneExpiredAuthRows", () => {
  it("deletes only rows that have already expired", async () => {
    await pruneExpiredAuthRows(NOW);

    // `lt` (not `lte`/`gt`): a row expiring exactly now is still live, and the
    // filter must never be inverted — that would delete every VALID session.
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { expires: { lt: NOW } } });
    expect(vtDeleteMany).toHaveBeenCalledWith({ where: { expires: { lt: NOW } } });
  });

  it("reports what it removed", async () => {
    sessionDeleteMany.mockResolvedValue({ count: 12 });
    vtDeleteMany.mockResolvedValue({ count: 3 });

    await expect(pruneExpiredAuthRows(NOW)).resolves.toEqual({
      sessions: 12,
      verificationTokens: 3,
    });
  });

  it("sweeps both tables even when one of them is already clean", async () => {
    vtDeleteMany.mockResolvedValue({ count: 7 });

    await expect(pruneExpiredAuthRows(NOW)).resolves.toEqual({
      sessions: 0,
      verificationTokens: 7,
    });
    expect(sessionDeleteMany).toHaveBeenCalledOnce();
  });

  it("defaults to the current time when no clock is passed", async () => {
    const before = Date.now();
    await pruneExpiredAuthRows();
    const call = sessionDeleteMany.mock.calls[0] as [{ where: { expires: { lt: Date } } }];
    const arg = call[0].where.expires.lt;
    expect(arg.getTime()).toBeGreaterThanOrEqual(before);
    expect(arg.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
