import {
  aggregateActivitiesByWeek,
  type ActivityInput,
  type Discipline,
} from "@/lib/strava/sync-core";

/**
 * Pure fan-out for Apple Health ingest — no DB, no framework. Mirrors the
 * bucketing/fan-out in strava/sync.ts, but writes APPLE_HEALTH rows. Kept
 * separate so it is unit-testable in isolation (same pattern as sync-core).
 */

export interface PlanRange {
  id: string;
  weekStartDay: number;
  /** Start of week 1 (ms). */
  startMs: number;
  /** Start of the event week (ms). */
  endMs: number;
  /** Only the sports the plan includes get rows. */
  disciplines: Set<string>;
}

export interface AppleHealthRow {
  planId: string;
  discipline: Discipline;
  weekStartDate: Date;
  actualMeters: number;
  source: "APPLE_HEALTH";
}

/**
 * Bucket workouts into weeks once per distinct week-start day, then fan each
 * plan's day-aligned buckets out to the weeks its range covers.
 */
export function buildAppleHealthRows(
  planRanges: PlanRange[],
  workouts: ActivityInput[],
): AppleHealthRow[] {
  const bucketsByDay = new Map<number, ReturnType<typeof aggregateActivitiesByWeek>>();
  for (const day of new Set(planRanges.map((r) => r.weekStartDay))) {
    bucketsByDay.set(day, aggregateActivitiesByWeek(workouts, day));
  }

  return planRanges.flatMap((r) =>
    (bucketsByDay.get(r.weekStartDay) ?? [])
      .filter((bucket) => {
        const weekMs = bucket.weekStartDate.getTime();
        return weekMs >= r.startMs && weekMs <= r.endMs && r.disciplines.has(bucket.discipline);
      })
      .map((bucket) => ({
        planId: r.id,
        discipline: bucket.discipline,
        weekStartDate: bucket.weekStartDate,
        actualMeters: bucket.meters,
        source: "APPLE_HEALTH" as const,
      })),
  );
}
