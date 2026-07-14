import { describe, expect, it } from "vitest";

import { effectiveActualKey, resolveEffectiveActuals, type ActualRow } from "./actuals";

const WEEK = new Date("2026-01-05T00:00:00.000Z");
const WEEK2 = new Date("2026-01-12T00:00:00.000Z");

function key(discipline: string, week: Date) {
  return effectiveActualKey(discipline, week);
}

describe("resolveEffectiveActuals — MANUAL overrides STRAVA", () => {
  it("uses STRAVA when only STRAVA exists", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 13000, source: "STRAVA" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 13000,
      source: "STRAVA",
    });
  });

  it("uses MANUAL when only MANUAL exists", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9000, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 9000,
      source: "MANUAL",
    });
  });

  it("prefers MANUAL over STRAVA regardless of input order", () => {
    const stravaFirst: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 13000, source: "STRAVA" },
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9000, source: "MANUAL" },
    ];
    const manualFirst: ActualRow[] = [...stravaFirst].reverse();
    expect(resolveEffectiveActuals(stravaFirst).get(key("RUN", WEEK))).toEqual({
      meters: 9000,
      source: "MANUAL",
    });
    expect(resolveEffectiveActuals(manualFirst).get(key("RUN", WEEK))).toEqual({
      meters: 9000,
      source: "MANUAL",
    });
  });

  it("keeps disciplines and weeks independent", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 13000, source: "STRAVA" },
      { discipline: "BIKE", weekStartDate: WEEK, actualMeters: 40000, source: "STRAVA" },
      { discipline: "RUN", weekStartDate: WEEK2, actualMeters: 5000, source: "MANUAL" },
    ];
    const map = resolveEffectiveActuals(rows);
    expect(map.get(key("RUN", WEEK))?.meters).toBe(13000);
    expect(map.get(key("BIKE", WEEK))?.meters).toBe(40000);
    expect(map.get(key("RUN", WEEK2))).toEqual({ meters: 5000, source: "MANUAL" });
    expect(map.size).toBe(3);
  });

  it("treats a zero manual entry as an override", () => {
    const rows: ActualRow[] = [
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 2000, source: "STRAVA" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 0, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("SWIM", WEEK))).toEqual({
      meters: 0,
      source: "MANUAL",
    });
  });
});

describe("resolveEffectiveActuals — APPLE_HEALTH precedence", () => {
  it("uses APPLE_HEALTH when it is the only source", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 12000, source: "APPLE_HEALTH" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 12000,
      source: "APPLE_HEALTH",
    });
  });

  it("prefers STRAVA over APPLE_HEALTH regardless of input order", () => {
    const healthFirst: ActualRow[] = [
      { discipline: "BIKE", weekStartDate: WEEK, actualMeters: 61000, source: "APPLE_HEALTH" },
      { discipline: "BIKE", weekStartDate: WEEK, actualMeters: 60000, source: "STRAVA" },
    ];
    const stravaFirst: ActualRow[] = [...healthFirst].reverse();
    for (const rows of [healthFirst, stravaFirst]) {
      expect(resolveEffectiveActuals(rows).get(key("BIKE", WEEK))).toEqual({
        meters: 60000,
        source: "STRAVA",
      });
    }
  });

  it("prefers MANUAL over both auto sources", () => {
    const rows: ActualRow[] = [
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3000, source: "APPLE_HEALTH" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3100, source: "STRAVA" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 2500, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("SWIM", WEEK))).toEqual({
      meters: 2500,
      source: "MANUAL",
    });
  });

  it("never sums sources for the same week", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 10000, source: "APPLE_HEALTH" },
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 10000, source: "STRAVA" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))?.meters).toBe(10000);
  });
});
