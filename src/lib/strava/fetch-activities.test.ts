import { afterEach, describe, expect, it, vi } from "vitest";

import { StravaApiError, fetchRecentActivities } from "./client";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function activity(i: number) {
  return { sport_type: "Run", distance: 1000 + i, start_date_local: "2026-01-06T07:00:00Z" };
}

const noSleep = async () => {};

describe("fetchRecentActivities", () => {
  it("paginates until a short page and returns all activities", async () => {
    const pages: Record<string, unknown[]> = {
      "1": [activity(1), activity(2)],
      "2": [activity(3), activity(4)],
      "3": [activity(5)], // short page → stop
    };
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const page = new URL(String(input)).searchParams.get("page")!;
      return jsonResponse(pages[page] ?? []);
    }) as typeof fetch;

    const { activities, rateLimited } = await fetchRecentActivities("tok", {
      perPage: 2,
      sleep: noSleep,
    });
    expect(activities).toHaveLength(5);
    expect(rateLimited).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 with backoff, then succeeds", async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls++;
      if (calls <= 2) return new Response("rate limited", { status: 429 });
      return jsonResponse([activity(1)]); // short page
    }) as typeof fetch;

    const sleep = vi.fn(noSleep);
    const { activities, rateLimited } = await fetchRecentActivities("tok", {
      perPage: 50,
      sleep,
    });
    expect(activities).toHaveLength(1);
    expect(rateLimited).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(2); // backed off twice before success
  });

  it("gives up gracefully after persistent 429 (rateLimited, no throw)", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 429 })) as typeof fetch;

    const { activities, rateLimited } = await fetchRecentActivities("tok", {
      maxRetriesPer429: 2,
      sleep: noSleep,
    });
    expect(activities).toEqual([]);
    expect(rateLimited).toBe(true); // did not throw
  });

  it("throws StravaApiError on non-429 HTTP errors", async () => {
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(fetchRecentActivities("tok", { sleep: noSleep })).rejects.toBeInstanceOf(
      StravaApiError,
    );
  });
});
