import { describe, expect, it } from "vitest";

import { effectiveActualKey, resolveEffectiveActuals, type ActualRow } from "./actuals";

const WEEK = new Date("2026-01-05T00:00:00.000Z");
const WEEK2 = new Date("2026-01-12T00:00:00.000Z");

function key(discipline: string, week: Date) {
  return effectiveActualKey(discipline, week);
}

describe("resolveEffectiveActuals — MANUAL adds on top of auto", () => {
  it("uses STRAVA when only STRAVA exists", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 13000, source: "STRAVA" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 13000,
      source: "STRAVA",
    });
  });

  it("uses MANUAL alone when there is no auto source", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9000, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 9000,
      source: "MANUAL",
    });
  });

  it("adds MANUAL on top of STRAVA regardless of input order, keeping the auto source label", () => {
    const stravaFirst: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 13000, source: "STRAVA" },
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9000, source: "MANUAL" },
    ];
    const manualFirst: ActualRow[] = [...stravaFirst].reverse();
    for (const rows of [stravaFirst, manualFirst]) {
      expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
        meters: 22000, // 13000 synced + 9000 manual
        source: "STRAVA",
      });
    }
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

  it("a zero manual entry adds nothing to the auto total", () => {
    const rows: ActualRow[] = [
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 2000, source: "STRAVA" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 0, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("SWIM", WEEK))).toEqual({
      meters: 2000,
      source: "STRAVA",
    });
  });
});

describe("resolveEffectiveActuals — auto sources never sum among themselves", () => {
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

  it("adds MANUAL on top of the best auto source (STRAVA), not on top of the sum", () => {
    const rows: ActualRow[] = [
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3000, source: "APPLE_HEALTH" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3100, source: "STRAVA" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 2500, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("SWIM", WEEK))).toEqual({
      meters: 5600, // best auto 3100 (Strava, not 3100+3000) + 2500 manual
      source: "STRAVA",
    });
  });

  it("never sums two AUTO sources for the same week", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 10000, source: "APPLE_HEALTH" },
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 10000, source: "STRAVA" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))?.meters).toBe(10000);
  });
});

describe("resolveEffectiveActuals — GARMIN precedence", () => {
  it("uses GARMIN when it is the only source", () => {
    const rows: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 11000, source: "GARMIN" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
      meters: 11000,
      source: "GARMIN",
    });
  });

  it("prefers STRAVA over GARMIN regardless of input order", () => {
    const garminFirst: ActualRow[] = [
      { discipline: "BIKE", weekStartDate: WEEK, actualMeters: 62000, source: "GARMIN" },
      { discipline: "BIKE", weekStartDate: WEEK, actualMeters: 60000, source: "STRAVA" },
    ];
    const stravaFirst: ActualRow[] = [...garminFirst].reverse();
    for (const rows of [garminFirst, stravaFirst]) {
      expect(resolveEffectiveActuals(rows).get(key("BIKE", WEEK))).toEqual({
        meters: 60000,
        source: "STRAVA",
      });
    }
  });

  it("prefers GARMIN over APPLE_HEALTH regardless of input order", () => {
    const healthFirst: ActualRow[] = [
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9500, source: "APPLE_HEALTH" },
      { discipline: "RUN", weekStartDate: WEEK, actualMeters: 9800, source: "GARMIN" },
    ];
    const garminFirst: ActualRow[] = [...healthFirst].reverse();
    for (const rows of [healthFirst, garminFirst]) {
      expect(resolveEffectiveActuals(rows).get(key("RUN", WEEK))).toEqual({
        meters: 9800,
        source: "GARMIN",
      });
    }
  });

  it("adds MANUAL on top of the best of three auto sources", () => {
    const rows: ActualRow[] = [
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3000, source: "APPLE_HEALTH" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3050, source: "GARMIN" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 3100, source: "STRAVA" },
      { discipline: "SWIM", weekStartDate: WEEK, actualMeters: 2500, source: "MANUAL" },
    ];
    expect(resolveEffectiveActuals(rows).get(key("SWIM", WEEK))).toEqual({
      meters: 5600, // best auto 3100 (Strava) + 2500 manual
      source: "STRAVA",
    });
  });
});
