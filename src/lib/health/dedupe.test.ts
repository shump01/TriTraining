import { describe, expect, it } from "vitest";

import type { HealthWorkoutInput } from "./core";
import { dedupeHealthWorkouts } from "./dedupe";

/** A ride at 10:00 local on 2026-08-09, defaults matching a real Garmin entry. */
function ride(over: Partial<HealthWorkoutInput> = {}): HealthWorkoutInput {
  return {
    sportType: "Ride",
    distanceMeters: 81_470,
    startDateLocal: "2026-08-09T10:00:00.000Z",
    externalId: "a",
    movingSeconds: 3600,
    ...over,
  };
}

const meters = (ws: HealthWorkoutInput[]) => ws.map((w) => w.distanceMeters).sort((a, b) => a - b);

describe("dedupeHealthWorkouts", () => {
  it("collapses the same ride written by two apps, keeping the fuller copy", () => {
    // The reported bug: a Garmin bike computer uploads to Strava, and Garmin
    // Connect AND Strava each write the ride into Apple Health.
    const out = dedupeHealthWorkouts([
      ride({ externalId: "garmin", distanceMeters: 81_470, movingSeconds: 3600 }),
      ride({
        externalId: "strava",
        distanceMeters: 81_412,
        startDateLocal: "2026-08-09T10:00:05.000Z",
        movingSeconds: 3550,
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]!.distanceMeters).toBe(81_470);
    expect(out[0]!.externalId).toBe("garmin");
  });

  it("collapses three copies of one session, not just two", () => {
    const out = dedupeHealthWorkouts([
      ride({ externalId: "a", distanceMeters: 81_000 }),
      ride({ externalId: "b", distanceMeters: 81_470, startDateLocal: "2026-08-09T10:00:03.000Z" }),
      ride({ externalId: "c", distanceMeters: 81_100, startDateLocal: "2026-08-09T10:00:07.000Z" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.externalId).toBe("b");
  });

  it("keeps genuinely back-to-back sessions in the same sport", () => {
    // A track session recorded as two efforts: the second starts exactly as the
    // first ends. Merging these would silently delete real training.
    const out = dedupeHealthWorkouts([
      ride({
        externalId: "first",
        startDateLocal: "2026-08-09T10:00:00.000Z",
        movingSeconds: 1200,
      }),
      ride({
        externalId: "second",
        startDateLocal: "2026-08-09T10:20:00.000Z",
        movingSeconds: 1200,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps sessions that merely touch at the boundary", () => {
    // 30s of overlap out of a 20-minute effort is sloppy boundaries, not a
    // duplicate — well under the half-of-the-shorter rule.
    const out = dedupeHealthWorkouts([
      ride({
        externalId: "first",
        startDateLocal: "2026-08-09T10:00:00.000Z",
        movingSeconds: 1230,
      }),
      ride({
        externalId: "second",
        startDateLocal: "2026-08-09T10:20:00.000Z",
        movingSeconds: 1200,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never merges across disciplines — a brick is two sessions", () => {
    // Bike and run legs can overlap at the transition; they are not duplicates.
    const out = dedupeHealthWorkouts([
      ride({ sportType: "Ride", externalId: "bike", movingSeconds: 3600 }),
      ride({
        sportType: "Run",
        externalId: "run",
        distanceMeters: 5_000,
        startDateLocal: "2026-08-09T10:55:00.000Z",
        movingSeconds: 1500,
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("falls back to start proximity when a duration is missing", () => {
    // Older app builds send distance only, so no interval can be built.
    const out = dedupeHealthWorkouts([
      ride({ externalId: "a", movingSeconds: undefined, distanceMeters: 81_470 }),
      ride({
        externalId: "b",
        movingSeconds: undefined,
        distanceMeters: 81_412,
        startDateLocal: "2026-08-09T10:00:30.000Z",
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.distanceMeters).toBe(81_470);
  });

  it("does not merge distant starts when durations are missing", () => {
    const out = dedupeHealthWorkouts([
      ride({ externalId: "a", movingSeconds: undefined }),
      ride({
        externalId: "b",
        movingSeconds: undefined,
        startDateLocal: "2026-08-09T14:00:00.000Z",
      }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("passes through untracked sports without letting them absorb tracked ones", () => {
    const out = dedupeHealthWorkouts([
      ride({ sportType: "Other", externalId: "walk", distanceMeters: 3_000 }),
      ride({ sportType: "Ride", externalId: "bike" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps workouts whose timestamp can't be parsed rather than guessing", () => {
    // No clock position means no evidence of duplication; dropping one would
    // delete training on a hunch.
    const out = dedupeHealthWorkouts([
      ride({ externalId: "a", startDateLocal: "not-a-date" }),
      ride({ externalId: "b", startDateLocal: "not-a-date" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("is deterministic when copies tie on distance and duration", () => {
    // Ingest is an idempotent full replace; a representative that flip-flopped
    // between syncs would make the same week's total oscillate.
    const a = ride({ externalId: "zzz" });
    const b = ride({ externalId: "aaa", startDateLocal: "2026-08-09T10:00:02.000Z" });
    expect(dedupeHealthWorkouts([a, b])[0]!.externalId).toBe("aaa");
    expect(dedupeHealthWorkouts([b, a])[0]!.externalId).toBe("aaa");
  });

  it("leaves a clean batch completely untouched", () => {
    const batch = [
      ride({ externalId: "mon", startDateLocal: "2026-08-03T10:00:00.000Z" }),
      ride({ externalId: "wed", startDateLocal: "2026-08-05T10:00:00.000Z" }),
      ride({ externalId: "sat", startDateLocal: "2026-08-08T10:00:00.000Z" }),
    ];
    expect(dedupeHealthWorkouts(batch)).toHaveLength(3);
  });

  it("halves the week when every ride is doubled (the reported symptom)", () => {
    // 2026-06-29 in the live data: APPLE_HEALTH 7,645 m against STRAVA 3,822 m.
    const batch = [
      ride({ externalId: "g1", distanceMeters: 3_822, startDateLocal: "2026-06-30T10:00:00.000Z" }),
      ride({ externalId: "s1", distanceMeters: 3_822, startDateLocal: "2026-06-30T10:00:04.000Z" }),
    ];
    const out = dedupeHealthWorkouts(batch);
    expect(meters(out)).toEqual([3_822]);
  });

  it("handles an empty batch", () => {
    expect(dedupeHealthWorkouts([])).toEqual([]);
  });
});
