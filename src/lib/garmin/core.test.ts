import { describe, expect, it } from "vitest";

import { aggregateActivitiesByWeek, buildActivityLoadRows } from "@/lib/strava/sync-core";

import {
  garminStartDateLocal,
  mapGarminSportType,
  toActivityHrInputs,
  toActivityInputs,
  type GarminActivityLike,
} from "./core";

function record(overrides: Partial<GarminActivityLike> = {}): GarminActivityLike {
  return {
    activityId: "1001",
    sportType: "RUNNING",
    startTimeUtc: new Date("2026-07-08T09:00:00.000Z"),
    offsetSeconds: 0,
    distanceMeters: 10_000,
    durationSeconds: 3_600,
    avgHr: 150,
    ...overrides,
  };
}

describe("mapGarminSportType", () => {
  it("maps the swim/bike/run family to Strava-compatible types", () => {
    expect(mapGarminSportType("LAP_SWIMMING")).toBe("Swim");
    expect(mapGarminSportType("OPEN_WATER_SWIMMING")).toBe("Swim");
    expect(mapGarminSportType("ROAD_BIKING")).toBe("Ride");
    expect(mapGarminSportType("INDOOR_CYCLING")).toBe("Ride");
    expect(mapGarminSportType("GRAVEL_CYCLING")).toBe("Ride");
    expect(mapGarminSportType("RUNNING")).toBe("Run");
    expect(mapGarminSportType("TREADMILL_RUNNING")).toBe("Run");
    expect(mapGarminSportType("TRAIL_RUNNING")).toBe("Run");
  });

  it("ignores untracked, multisport-structural, and unknown types", () => {
    expect(mapGarminSportType("WALKING")).toBeNull();
    expect(mapGarminSportType("YOGA")).toBeNull();
    // A triathlon's MULTI_SPORT parent and TRANSITION segments must never be
    // counted — the swim/bike/run legs arrive as their own summaries.
    expect(mapGarminSportType("MULTI_SPORT")).toBeNull();
    expect(mapGarminSportType("TRANSITION")).toBeNull();
    // Appendix A is portal-gated: future/unknown values degrade to "ignored".
    expect(mapGarminSportType("SOME_FUTURE_TYPE")).toBeNull();
    expect(mapGarminSportType(undefined)).toBeNull();
  });
});

describe("garminStartDateLocal", () => {
  it("shifts a late-UTC start into the athlete's next local day", () => {
    // 23:30 UTC Sunday + 2h east = 01:30 local Monday.
    expect(garminStartDateLocal(new Date("2026-07-05T23:30:00.000Z"), 7_200)).toBe(
      "2026-07-06T01:30:00.000Z",
    );
  });

  it("shifts an early-UTC start into the athlete's previous local day", () => {
    // 02:00 UTC Monday - 3h west = 23:00 local Sunday.
    expect(garminStartDateLocal(new Date("2026-07-06T02:00:00.000Z"), -10_800)).toBe(
      "2026-07-05T23:00:00.000Z",
    );
  });
});

describe("toActivityInputs → weekly aggregation", () => {
  it("buckets by the athlete's LOCAL week, not the UTC week", () => {
    // Sunday 23:30 UTC with a +2h offset is Monday local — it must land in the
    // week starting 2026-07-06, not the week before.
    const buckets = aggregateActivitiesByWeek(
      toActivityInputs([
        record({ startTimeUtc: new Date("2026-07-05T23:30:00.000Z"), offsetSeconds: 7_200 }),
      ]),
    );
    expect(buckets).toEqual([
      {
        discipline: "RUN",
        weekStartDate: new Date("2026-07-06T00:00:00.000Z"),
        meters: 10_000,
      },
    ]);
  });

  it("drops unmapped sport types during aggregation", () => {
    const buckets = aggregateActivitiesByWeek(
      toActivityInputs([
        record(),
        record({ activityId: "1002", sportType: "WALKING", distanceMeters: 5_000 }),
      ]),
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.meters).toBe(10_000);
  });
});

describe("toActivityHrInputs → training-load rows", () => {
  it("keeps HR-recorded activities with the Garmin activityId as externalId", () => {
    const rows = buildActivityLoadRows(toActivityHrInputs([record()]));
    expect(rows).toEqual([
      {
        externalId: "1001",
        date: new Date("2026-07-08T00:00:00.000Z"),
        discipline: "RUN",
        movingSeconds: 3_600,
        avgHr: 150,
      },
    ]);
  });

  it("drops HR-less activities from load but they still count toward actuals", () => {
    const hrLess = record({ avgHr: null });
    expect(buildActivityLoadRows(toActivityHrInputs([hrLess]))).toEqual([]);
    // The same activity still aggregates distance for the weekly actuals.
    expect(aggregateActivitiesByWeek(toActivityInputs([hrLess]))).toHaveLength(1);
  });

  it("dates the load row by the athlete's LOCAL calendar day", () => {
    const rows = buildActivityLoadRows(
      toActivityHrInputs([
        record({ startTimeUtc: new Date("2026-07-05T23:30:00.000Z"), offsetSeconds: 7_200 }),
      ]),
    );
    expect(rows[0]?.date).toEqual(new Date("2026-07-06T00:00:00.000Z"));
  });
});
