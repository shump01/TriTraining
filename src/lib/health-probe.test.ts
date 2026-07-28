import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PROBE_TTL_MS, __resetHealthProbeForTests, probeDatabase } from "@/lib/health-probe";

const T0 = 1_800_000_000_000;

/** A query that only settles when we say so — for the concurrency tests. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetHealthProbeForTests();
  queryRaw.mockReset();
  queryRaw.mockResolvedValue([{ "?column?": 1 }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("probeDatabase", () => {
  it("reports healthy when the query succeeds", async () => {
    await expect(probeDatabase()).resolves.toMatchObject({ healthy: true });
  });

  it("reports unhealthy instead of throwing when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("ECONNREFUSED"));
    // Resolving is the contract: the route awaits this and must answer 503,
    // not fall through to a 500 that says nothing about the database.
    await expect(probeDatabase()).resolves.toMatchObject({ healthy: false });
  });

  it("serves a cached result inside the TTL — one query, not two", async () => {
    await probeDatabase();
    await probeDatabase(T0 + PROBE_TTL_MS - 1);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("re-probes once the TTL has passed", async () => {
    await probeDatabase();
    await probeDatabase(T0 + PROBE_TTL_MS);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent misses onto a single query", async () => {
    const gate = deferred();
    queryRaw.mockReturnValue(gate.promise);

    // Twenty callers arrive before the first query has come back.
    const inFlight = Array.from({ length: 20 }, () => probeDatabase());
    expect(queryRaw).toHaveBeenCalledOnce();

    gate.resolve();
    const results = await Promise.all(inFlight);

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(results.every((r) => r.healthy)).toBe(true);
  });

  it("caches an unhealthy result too, so a downed database is not hammered", async () => {
    queryRaw.mockRejectedValue(new Error("down"));

    await probeDatabase();
    await probeDatabase(T0 + 1);

    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("recovers after a failure once the TTL expires", async () => {
    queryRaw.mockRejectedValueOnce(new Error("blip"));
    await expect(probeDatabase()).resolves.toMatchObject({ healthy: false });

    await expect(probeDatabase(T0 + PROBE_TTL_MS)).resolves.toMatchObject({ healthy: true });
  });

  it("does not wedge after a failure — the in-flight slot is released", async () => {
    queryRaw.mockRejectedValue(new Error("down"));
    await probeDatabase();

    queryRaw.mockResolvedValue([{ ok: 1 }]);
    await expect(probeDatabase(T0 + PROBE_TTL_MS)).resolves.toMatchObject({ healthy: true });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
