import { describe, expect, it } from "vitest";

import {
  activitiesAfterSeconds,
  aggregateActivitiesByWeek,
  buildActivityLoadRows,
  mapSportTypeToDiscipline,
  type ActivityHrInput,
} from "./sync-core";

describe("buildActivityLoadRows", () => {
  const base: ActivityHrInput = {
    id: "1",
    sportType: "Run",
    startDateLocal: "2026-01-05T07:30:00Z",
    movingSeconds: 3600,
    avgHr: 150,
  };

  it("keeps HR-recorded, mapped activities and dates them by their local day", () => {
    const rows = buildActivityLoadRows([base]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stravaActivityId: "1",
      discipline: "RUN",
      movingSeconds: 3600,
      avgHr: 150,
    });
    // Local day 2026-01-05 → UTC midnight.
    expect(rows[0]!.date.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("drops activities without heart rate (can't compute hrTSS)", () => {
    expect(buildActivityLoadRows([{ ...base, avgHr: null }])).toEqual([]);
    expect(buildActivityLoadRows([{ ...base, avgHr: 0 }])).toEqual([]);
  });

  it("drops unmapped sports, zero duration, and missing ids", () => {
    expect(buildActivityLoadRows([{ ...base, sportType: "WeightTraining" }])).toEqual([]);
    expect(buildActivityLoadRows([{ ...base, movingSeconds: 0 }])).toEqual([]);
    expect(buildActivityLoadRows([{ ...base, id: "" }])).toEqual([]);
  });

  it("maps ride/virtual variants to the right discipline", () => {
    expect(buildActivityLoadRows([{ ...base, sportType: "VirtualRide" }])[0]?.discipline).toBe(
      "BIKE",
    );
    expect(buildActivityLoadRows([{ ...base, sportType: "Swim" }])[0]?.discipline).toBe("SWIM");
  });
});

describe("activitiesAfterSeconds", () => {
  const NOW_MS = Date.UTC(2026, 5, 20); // 2026-06-20

  it("returns just before the earliest week for a past/current plan", () => {
    const earliest = Date.UTC(2026, 5, 1); // 2026-06-01, before now
    expect(activitiesAfterSeconds(earliest, NOW_MS)).toBe(Math.floor(earliest / 1000) - 1);
  });

  it("clamps a future plan start to now (Strava 400s on a future `after`)", () => {
    const earliest = Date.UTC(2026, 5, 22); // 2026-06-22, after now
    expect(activitiesAfterSeconds(earliest, NOW_MS)).toBe(Math.floor(NOW_MS / 1000));
  });
});

describe("mapSportTypeToDiscipline", () => {
  it.each([
    ["Swim", "SWIM"],
    ["Ride", "BIKE"],
    ["VirtualRide", "BIKE"],
    ["Run", "RUN"],
    ["VirtualRun", "RUN"],
  ])("maps %s -> %s", (input, expected) => {
    expect(mapSportTypeToDiscipline(input)).toBe(expected);
  });

  it.each(["Walk", "Hike", "Workout", "WeightTraining", "AlpineSki", undefined, ""])(
    "ignores %s",
    (input) => {
      expect(mapSportTypeToDiscipline(input as string | undefined)).toBeNull();
    },
  );
});

describe("aggregateActivitiesByWeek", () => {
  // 2026-01-05 is a Monday. Activities on Tue 6th and Sun 11th are the same week.
  it("sums distance per discipline within the same Monday week", () => {
    const result = aggregateActivitiesByWeek([
      { sportType: "Run", distanceMeters: 5000, startDateLocal: "2026-01-06T07:00:00Z" },
      { sportType: "Run", distanceMeters: 8000, startDateLocal: "2026-01-11T07:00:00Z" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      discipline: "RUN",
      meters: 13000,
    });
    expect(result[0]!.weekStartDate.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("separates different weeks and different disciplines", () => {
    const result = aggregateActivitiesByWeek([
      { sportType: "Run", distanceMeters: 5000, startDateLocal: "2026-01-06T07:00:00Z" }, // wk Jan5 RUN
      { sportType: "Ride", distanceMeters: 40000, startDateLocal: "2026-01-07T07:00:00Z" }, // wk Jan5 BIKE
      { sportType: "Run", distanceMeters: 6000, startDateLocal: "2026-01-13T07:00:00Z" }, // wk Jan12 RUN
    ]);
    const byKey = new Map(
      result.map((r) => [
        `${r.discipline}|${r.weekStartDate.toISOString().slice(0, 10)}`,
        r.meters,
      ]),
    );
    expect(byKey.get("RUN|2026-01-05")).toBe(5000);
    expect(byKey.get("BIKE|2026-01-05")).toBe(40000);
    expect(byKey.get("RUN|2026-01-12")).toBe(6000);
    expect(result).toHaveLength(3);
  });

  it("ignores unmapped types and non-positive/invalid distances", () => {
    const result = aggregateActivitiesByWeek([
      { sportType: "Walk", distanceMeters: 3000, startDateLocal: "2026-01-06T07:00:00Z" },
      { sportType: "Run", distanceMeters: 0, startDateLocal: "2026-01-06T07:00:00Z" },
      { sportType: "Run", distanceMeters: -10, startDateLocal: "2026-01-06T07:00:00Z" },
      { sportType: "Run", distanceMeters: 4000, startDateLocal: "not-a-date" },
    ]);
    expect(result).toEqual([]);
  });

  it("floors fractional meter totals", () => {
    const result = aggregateActivitiesByWeek([
      { sportType: "Swim", distanceMeters: 1500.4, startDateLocal: "2026-01-06T07:00:00Z" },
      { sportType: "Swim", distanceMeters: 1000.9, startDateLocal: "2026-01-07T07:00:00Z" },
    ]);
    expect(result[0]!.meters).toBe(2501); // 2501.3 floored
  });

  it("buckets on a custom weekStartDay (Sunday): Sun 11th and Mon 12th are one week", () => {
    // With Sunday weeks, Sun 2026-01-11 and Mon 2026-01-12 fall in the same week
    // (they would be split across two weeks under the default Monday grid).
    const result = aggregateActivitiesByWeek(
      [
        { sportType: "Run", distanceMeters: 5000, startDateLocal: "2026-01-11T07:00:00Z" },
        { sportType: "Run", distanceMeters: 6000, startDateLocal: "2026-01-12T07:00:00Z" },
      ],
      0, // Sunday
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.meters).toBe(11000);
    expect(result[0]!.weekStartDate.toISOString()).toBe("2026-01-11T00:00:00.000Z");
    expect(result[0]!.weekStartDate.getUTCDay()).toBe(0);
  });
});
