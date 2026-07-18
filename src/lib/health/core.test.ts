import { describe, expect, it } from "vitest";

import { buildActivityLoadRows } from "@/lib/strava/sync-core";

import { buildAppleHealthRows, toActivityHrInputs, type PlanRange } from "./core";

// Mondays (UTC midnight) around a fixed reference period.
const W1 = new Date("2026-06-08T00:00:00.000Z");
const W2 = new Date("2026-06-15T00:00:00.000Z");
const W3 = new Date("2026-06-22T00:00:00.000Z");
// The Sunday-start week containing Jun 9 (Tue) starts Jun 7.
const SUN_W1 = new Date("2026-06-07T00:00:00.000Z");

function range(overrides: Partial<PlanRange> = {}): PlanRange {
  return {
    id: "plan-1",
    weekStartDay: 1,
    startMs: W1.getTime(),
    endMs: W3.getTime(),
    disciplines: new Set(["SWIM", "BIKE", "RUN"]),
    ...overrides,
  };
}

const runTue = { sportType: "Run", distanceMeters: 10_000, startDateLocal: "2026-06-09T07:00:00" };
const runNextWeek = {
  sportType: "Run",
  distanceMeters: 8_000,
  startDateLocal: "2026-06-16T07:00:00",
};
const swimWed = {
  sportType: "Swim",
  distanceMeters: 2_000,
  startDateLocal: "2026-06-10T06:30:00",
};

describe("buildAppleHealthRows", () => {
  it("buckets workouts into the plan's weeks with APPLE_HEALTH source", () => {
    const rows = buildAppleHealthRows([range()], [runTue, runNextWeek, swimWed]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "APPLE_HEALTH")).toBe(true);
    const run1 = rows.find(
      (r) => r.discipline === "RUN" && r.weekStartDate.getTime() === W1.getTime(),
    );
    expect(run1?.actualMeters).toBe(10_000);
    const run2 = rows.find(
      (r) => r.discipline === "RUN" && r.weekStartDate.getTime() === W2.getTime(),
    );
    expect(run2?.actualMeters).toBe(8_000);
  });

  it("sums same-week workouts and ignores unmapped sport types", () => {
    const rows = buildAppleHealthRows(
      [range()],
      [
        runTue,
        { sportType: "Run", distanceMeters: 5_000, startDateLocal: "2026-06-11T18:00:00" },
        { sportType: "Yoga", distanceMeters: 1_000, startDateLocal: "2026-06-11T19:00:00" },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ discipline: "RUN", actualMeters: 15_000 });
  });

  it("filters weeks outside the plan range and sports the plan lacks", () => {
    const runOnly = range({
      disciplines: new Set(["RUN"]),
      startMs: W2.getTime(),
      endMs: W3.getTime(),
    });
    const rows = buildAppleHealthRows([runOnly], [runTue, runNextWeek, swimWed]);
    // runTue (W1) is before the range; swimWed is a sport the plan lacks.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ discipline: "RUN", actualMeters: 8_000 });
    expect(rows[0]?.weekStartDate.getTime()).toBe(W2.getTime());
  });

  it("fans one workout out to every plan whose range covers its week", () => {
    const a = range({ id: "plan-a" });
    const b = range({ id: "plan-b" });
    const rows = buildAppleHealthRows([a, b], [runTue]);
    expect(rows.map((r) => r.planId).sort()).toEqual(["plan-a", "plan-b"]);
  });

  it("buckets per plan week-start day (Sunday vs Monday plans)", () => {
    const monday = range({ id: "mon" });
    const sunday = range({
      id: "sun",
      weekStartDay: 0,
      startMs: SUN_W1.getTime(),
      endMs: W3.getTime(),
    });
    const rows = buildAppleHealthRows([monday, sunday], [runTue]);
    const mondayRow = rows.find((r) => r.planId === "mon");
    const sundayRow = rows.find((r) => r.planId === "sun");
    expect(mondayRow?.weekStartDate.getTime()).toBe(W1.getTime());
    expect(sundayRow?.weekStartDate.getTime()).toBe(SUN_W1.getTime());
  });

  it("returns no rows for an empty batch (ingest still clears old rows)", () => {
    expect(buildAppleHealthRows([range()], [])).toEqual([]);
  });
});

describe("toActivityHrInputs — the training-load side of a workout batch", () => {
  const full = {
    ...runTue,
    externalId: "hk-uuid-1",
    movingSeconds: 3600,
    avgHr: 152,
  };

  it("keeps only workouts carrying id + duration + HR, shaped for buildActivityLoadRows", () => {
    const inputs = toActivityHrInputs([
      full,
      runNextWeek, // legacy shape — distance only, no load fields
      { ...swimWed, externalId: "hk-uuid-2", movingSeconds: 2400 }, // no avgHr
      { ...swimWed, externalId: "hk-uuid-3", avgHr: 140 }, // no duration
      { ...runTue, movingSeconds: 1800, avgHr: 150 }, // no externalId
    ]);
    expect(inputs).toEqual([
      {
        id: "hk-uuid-1",
        sportType: "Run",
        startDateLocal: "2026-06-09T07:00:00",
        movingSeconds: 3600,
        avgHr: 152,
      },
    ]);
  });

  it("composes with buildActivityLoadRows into load rows keyed by the HK UUID", () => {
    // The whole point of the shape: the Strava path's builder applies the
    // remaining rules (sport mapping, positive values, local-day dating).
    const rows = buildActivityLoadRows(toActivityHrInputs([full]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "hk-uuid-1",
      discipline: "RUN",
      movingSeconds: 3600,
      avgHr: 152,
    });
    expect(rows[0]!.date.toISOString()).toBe("2026-06-09T00:00:00.000Z");
  });

  it("a legacy distance-only batch yields no load rows at all", () => {
    expect(toActivityHrInputs([runTue, runNextWeek, swimWed])).toEqual([]);
  });

  it("unmapped sports survive here but die in the shared builder", () => {
    const yoga = {
      sportType: "Yoga",
      distanceMeters: 0,
      startDateLocal: "2026-06-11T19:00:00",
      externalId: "hk-uuid-9",
      movingSeconds: 3600,
      avgHr: 120,
    };
    // Division of labor: this helper only checks the load fields exist…
    expect(toActivityHrInputs([yoga])).toHaveLength(1);
    // …and the shared builder applies the discipline mapping.
    expect(buildActivityLoadRows(toActivityHrInputs([yoga]))).toEqual([]);
  });
});
