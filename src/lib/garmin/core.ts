import type { ActivityHrInput, ActivityInput } from "@/lib/strava/sync-core";

/**
 * Pure normalization for Garmin activity data — no DB, no network.
 *
 * Garmin summaries are normalized into the provider-neutral shapes that
 * [sync-core](src/lib/strava/sync-core.ts) already aggregates for Strava and
 * Apple Health, so the weekly bucketing and training-load builders are reused
 * unchanged. That means mapping Garmin's UPPER_SNAKE `activityType` taxonomy
 * onto the Strava-style sport types sync-core understands ("Swim"/"Ride"/"Run")
 * and deriving the athlete's local start time from Garmin's UTC instant +
 * offset (sync-core's `startDateLocal` convention: local wall-clock time
 * encoded as if it were UTC).
 */

/**
 * Garmin activityType → Strava-compatible sport type. The full taxonomy
 * (Appendix A of the Activity API spec) is portal-gated, so this covers the
 * swim/bike/run family documented publicly and is deliberately lenient:
 * anything unmapped — WALKING, YOGA, MULTI_SPORT parents, TRANSITION segments,
 * e-bike rides, … — returns null and is ignored, exactly how the Strava mapper
 * treats untracked types. Unknown future values degrade to "ignored", never to
 * a crash or a miscount.
 */
const GARMIN_SPORT_MAP: Record<string, "Swim" | "Ride" | "Run"> = {
  LAP_SWIMMING: "Swim",
  OPEN_WATER_SWIMMING: "Swim",
  SWIMMING: "Swim",
  CYCLING: "Ride",
  ROAD_BIKING: "Ride",
  MOUNTAIN_BIKING: "Ride",
  GRAVEL_CYCLING: "Ride",
  CYCLOCROSS: "Ride",
  TRACK_CYCLING: "Ride",
  INDOOR_CYCLING: "Ride",
  VIRTUAL_RIDE: "Ride",
  RUNNING: "Run",
  STREET_RUNNING: "Run",
  TRAIL_RUNNING: "Run",
  TRACK_RUNNING: "Run",
  TREADMILL_RUNNING: "Run",
  INDOOR_RUNNING: "Run",
  VIRTUAL_RUN: "Run",
  ULTRA_RUN: "Run",
};

export function mapGarminSportType(
  activityType: string | undefined,
): "Swim" | "Ride" | "Run" | null {
  if (!activityType) return null;
  return GARMIN_SPORT_MAP[activityType] ?? null;
}

/** The fields normalization needs — a subset of the GarminActivity row. */
export interface GarminActivityLike {
  /** Garmin Connect activity id — the per-source idempotency key. */
  activityId: string;
  /** Garmin activityType, e.g. LAP_SWIMMING. */
  sportType: string;
  /** UTC start instant (startTimeInSeconds). */
  startTimeUtc: Date;
  /** startTimeOffsetInSeconds — shifts UTC to the athlete's local time. */
  offsetSeconds: number;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
}

/**
 * The athlete's local start time in sync-core's `startDateLocal` convention:
 * an ISO string whose UTC fields ARE the local wall-clock values (what Strava's
 * `start_date_local` carries). Determines which training week — and which
 * calendar day, for load — the activity lands on.
 */
export function garminStartDateLocal(startTimeUtc: Date, offsetSeconds: number): string {
  return new Date(startTimeUtc.getTime() + offsetSeconds * 1000).toISOString();
}

/** Normalize stored Garmin activities for weekly-distance aggregation. */
export function toActivityInputs(records: GarminActivityLike[]): ActivityInput[] {
  return records.map((r) => ({
    sportType: mapGarminSportType(r.sportType) ?? undefined,
    distanceMeters: r.distanceMeters,
    startDateLocal: garminStartDateLocal(r.startTimeUtc, r.offsetSeconds),
  }));
}

/**
 * Normalize stored Garmin activities for training load. HR-less activities
 * still pass through here — buildActivityLoadRows drops them (no hrTSS without
 * a heart rate), keeping the filtering rules in one place.
 */
export function toActivityHrInputs(records: GarminActivityLike[]): ActivityHrInput[] {
  return records.map((r) => ({
    id: r.activityId,
    sportType: mapGarminSportType(r.sportType) ?? undefined,
    startDateLocal: garminStartDateLocal(r.startTimeUtc, r.offsetSeconds),
    movingSeconds: r.durationSeconds,
    avgHr: r.avgHr,
  }));
}
