import {
  aggregateActivitiesByWeek,
  type ActivityHrInput,
  type ActivityInput,
  type Discipline,
} from "@/lib/strava/sync-core";

/**
 * Pure fan-out for Apple Health ingest — no DB, no framework. Mirrors the
 * bucketing/fan-out in strava/sync.ts, but writes APPLE_HEALTH rows. Kept
 * separate so it is unit-testable in isolation (same pattern as sync-core).
 */

/**
 * A normalized HealthKit workout as sent by the app. The load fields are
 * optional — older app builds send distance only, and a workout without HR
 * still counts toward weekly actuals.
 */
export interface HealthWorkoutInput extends ActivityInput {
  /** HealthKit workout UUID — the per-source idempotency key. */
  externalId?: string;
  movingSeconds?: number;
  avgHr?: number;
}

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
/**
 * The workouts that can be scored for training load: those carrying an id,
 * a duration and an average HR, shaped into the same ActivityHrInput the
 * Strava path feeds to buildActivityLoadRows (which applies the remaining
 * rules — sport mapping, positive values, local-day dating).
 */
export function toActivityHrInputs(workouts: HealthWorkoutInput[]): ActivityHrInput[] {
  return workouts
    .filter(
      (w): w is HealthWorkoutInput & { externalId: string; movingSeconds: number; avgHr: number } =>
        w.externalId != null && w.movingSeconds != null && w.avgHr != null,
    )
    .map((w) => ({
      id: w.externalId,
      sportType: w.sportType,
      startDateLocal: w.startDateLocal,
      movingSeconds: w.movingSeconds,
      avgHr: w.avgHr,
    }));
}

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
