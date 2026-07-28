import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRateLimiterForTests,
  rateLimit,
  rateLimiterSize,
  sweepRateLimiter,
} from "@/lib/rate-limit";

const T0 = 1_800_000_000_000; // fixed epoch; the limiter reads Date.now()

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetRateLimiterForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to the limit inside one window, then blocks", () => {
    expect(rateLimit("k", 3, 60_000)).toMatchObject({ ok: true, remaining: 2 });
    expect(rateLimit("k", 3, 60_000)).toMatchObject({ ok: true, remaining: 1 });
    expect(rateLimit("k", 3, 60_000)).toMatchObject({ ok: true, remaining: 0 });

    const blocked = rateLimit("k", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it("keeps separate keys independent", () => {
    rateLimit("a", 1, 60_000);
    expect(rateLimit("a", 1, 60_000).ok).toBe(false);
    expect(rateLimit("b", 1, 60_000).ok).toBe(true);
  });

  it("starts a fresh window once the old one closes", () => {
    rateLimit("k", 1, 60_000);
    expect(rateLimit("k", 1, 60_000).ok).toBe(false);

    vi.setSystemTime(T0 + 60_001);
    expect(rateLimit("k", 1, 60_000).ok).toBe(true);
  });
});

describe("memory bounds", () => {
  it("drops buckets whose window has closed", () => {
    for (let i = 0; i < 50; i += 1) rateLimit(`key-${i}`, 5, 30_000);
    expect(rateLimiterSize()).toBe(50);

    // The sweep only runs once a minute, so step past both the window and the
    // sweep interval before poking it again.
    vi.setSystemTime(T0 + 90_000);
    rateLimit("something-else", 5, 30_000);

    // The 50 expired buckets are gone; only the new one is left.
    expect(rateLimiterSize()).toBe(1);
  });

  it("does not sweep on every call (the sweep is O(n))", () => {
    for (let i = 0; i < 10; i += 1) rateLimit(`key-${i}`, 5, 1_000);
    // Windows have closed, but we are still inside the sweep interval.
    vi.setSystemTime(T0 + 5_000);
    rateLimit("key-0", 5, 1_000);
    expect(rateLimiterSize()).toBe(10);
  });

  it("keeps live buckets — a sweep must never reset someone mid-window", () => {
    rateLimit("victim", 2, 300_000); // 5-minute window
    rateLimit("victim", 2, 300_000); // now at the limit
    expect(rateLimit("victim", 2, 300_000).ok).toBe(false);

    vi.setSystemTime(T0 + 61_000); // past the sweep interval, inside the window
    rateLimit("other", 2, 300_000); // triggers a sweep

    expect(rateLimit("victim", 2, 300_000).ok).toBe(false);
  });

  it("sweepRateLimiter accepts an explicit clock", () => {
    rateLimit("k", 5, 10_000);
    sweepRateLimiter(T0 + 5_000); // still live
    expect(rateLimiterSize()).toBe(1);
    sweepRateLimiter(T0 + 10_001); // expired
    expect(rateLimiterSize()).toBe(0);
  });
});
