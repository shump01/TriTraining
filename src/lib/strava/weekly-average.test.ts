import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getValidStravaAccessToken, fetchRecentActivities } = vi.hoisted(() => ({
  getValidStravaAccessToken: vi.fn(),
  fetchRecentActivities: vi.fn(),
}));

vi.mock("./connection", () => ({ getValidStravaAccessToken }));
vi.mock("./client", () => ({ fetchRecentActivities }));

import { getRecentWeeklyAverages } from "./weekly-average";

const MONDAY = new Date("2026-06-29T00:00:00.000Z"); // this week's Monday

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z")); // Wednesday of that week
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRecentWeeklyAverages", () => {
  it("returns connected: false when there is no usable Strava connection", async () => {
    getValidStravaAccessToken.mockResolvedValue(null);

    const result = await getRecentWeeklyAverages("user-1");

    expect(result).toEqual({
      connected: false,
      weeks: 4,
      averages: { SWIM: 0, BIKE: 0, RUN: 0 },
    });
    expect(fetchRecentActivities).not.toHaveBeenCalled();
  });

  it("averages distance per discipline over the trailing completed weeks", async () => {
    getValidStravaAccessToken.mockResolvedValue("token-123");
    const weekAgo = (n: number) => new Date(MONDAY.getTime() - n * 7 * 24 * 60 * 60 * 1000);
    fetchRecentActivities.mockResolvedValue({
      rateLimited: false,
      activities: [
        // 4 completed weeks of RUN, 10km each -> average 10,000 m/week.
        ...[1, 2, 3, 4].map((n) => ({
          sportType: "Run",
          distanceMeters: 10_000,
          startDateLocal: weekAgo(n).toISOString(),
        })),
        // A single BIKE week.
        { sportType: "Ride", distanceMeters: 40_000, startDateLocal: weekAgo(1).toISOString() },
      ],
    });

    const result = await getRecentWeeklyAverages("user-1");

    expect(result.connected).toBe(true);
    expect(result.weeks).toBe(4);
    expect(result.averages.RUN).toBe(10_000);
    expect(result.averages.BIKE).toBe(10_000); // 40,000 / 4 weeks
    expect(result.averages.SWIM).toBe(0);
  });

  it("excludes the current, still-in-progress week from the average", async () => {
    getValidStravaAccessToken.mockResolvedValue("token-123");
    fetchRecentActivities.mockResolvedValue({
      rateLimited: false,
      activities: [
        // This week (in progress) — should not count.
        { sportType: "Run", distanceMeters: 999_000, startDateLocal: MONDAY.toISOString() },
      ],
    });

    const result = await getRecentWeeklyAverages("user-1");

    expect(result.averages.RUN).toBe(0);
  });

  it("degrades gracefully (connected: true, zero averages) when the Strava API call fails", async () => {
    getValidStravaAccessToken.mockResolvedValue("token-123");
    fetchRecentActivities.mockRejectedValue(new Error("boom"));

    const result = await getRecentWeeklyAverages("user-1");

    expect(result).toEqual({
      connected: true,
      weeks: 4,
      averages: { SWIM: 0, BIKE: 0, RUN: 0 },
    });
  });

  it("supports a custom trailing-week count", async () => {
    getValidStravaAccessToken.mockResolvedValue("token-123");
    const weekAgo = (n: number) => new Date(MONDAY.getTime() - n * 7 * 24 * 60 * 60 * 1000);
    fetchRecentActivities.mockResolvedValue({
      rateLimited: false,
      activities: [
        { sportType: "Swim", distanceMeters: 2_000, startDateLocal: weekAgo(1).toISOString() },
      ],
    });

    const result = await getRecentWeeklyAverages("user-1", 2);

    expect(result.weeks).toBe(2);
    expect(result.averages.SWIM).toBe(1_000); // 2,000 / 2 weeks
  });
});
