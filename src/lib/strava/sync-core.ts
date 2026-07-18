import { DEFAULT_WEEK_START_DAY, startOfWeek } from "@/lib/weekly-targets";

/**
 * Pure mapping + bucketing logic for activity sync — no DB, no network, no
 * framework. Easy to unit-test in isolation.
 */

export const DISCIPLINES = ["SWIM", "BIKE", "RUN"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/**
 * The `after` value (epoch seconds) to pass to Strava's activities endpoint:
 * just before the earliest plan week, but never in the future. Strava rejects a
 * future `after` with HTTP 400, and there are no future activities to fetch, so
 * we clamp to "now" (which yields an empty result for a not-yet-started plan).
 */
export function activitiesAfterSeconds(earliestWeekMs: number, nowMs: number = Date.now()): number {
  return Math.min(Math.floor(earliestWeekMs / 1000) - 1, Math.floor(nowMs / 1000));
}

/**
 * Map a Strava sport/activity type to our Discipline. Anything we don't track
 * (Walk, Hike, Workout, WeightTraining, …) returns null and is ignored.
 */
export function mapSportTypeToDiscipline(sportType: string | undefined): Discipline | null {
  switch (sportType) {
    case "Swim":
      return "SWIM";
    case "Ride":
    case "VirtualRide":
      return "BIKE";
    case "Run":
    case "VirtualRun":
      return "RUN";
    default:
      return null;
  }
}

/** A normalized activity (the only fields sync cares about). */
export interface ActivityInput {
  /** Strava `sport_type` (preferred) or legacy `type`. */
  sportType: string | undefined;
  /** Distance in meters. */
  distanceMeters: number;
  /** Local start (Strava `start_date_local`) — determines the training week. */
  startDateLocal: string;
}

export interface WeeklyActualBucket {
  discipline: Discipline;
  weekStartDate: Date; // UTC-midnight Monday
  meters: number; // floored sum
}

/**
 * Bucket activities into weeks (starting on `weekStartDay`, 0=Sun..6=Sat,
 * default Monday) and total the distance per (discipline, week). Unmapped types
 * and non-positive/invalid distances are skipped. Totals are floored to whole
 * meters.
 */
export function aggregateActivitiesByWeek(
  activities: ActivityInput[],
  weekStartDay: number = DEFAULT_WEEK_START_DAY,
): WeeklyActualBucket[] {
  const sums = new Map<string, { discipline: Discipline; weekMs: number; meters: number }>();

  for (const activity of activities) {
    const discipline = mapSportTypeToDiscipline(activity.sportType);
    if (!discipline) continue;
    if (!Number.isFinite(activity.distanceMeters) || activity.distanceMeters <= 0) continue;

    const parsed = new Date(activity.startDateLocal);
    if (Number.isNaN(parsed.getTime())) continue;
    const weekMs = startOfWeek(parsed, weekStartDay).getTime();

    const key = `${discipline}|${weekMs}`;
    const existing = sums.get(key);
    if (existing) {
      existing.meters += activity.distanceMeters;
    } else {
      sums.set(key, { discipline, weekMs, meters: activity.distanceMeters });
    }
  }

  return [...sums.values()].map((v) => ({
    discipline: v.discipline,
    weekStartDate: new Date(v.weekMs),
    meters: Math.floor(v.meters),
  }));
}

/** An activity with the fields training load needs (heart rate + duration). */
export interface ActivityHrInput {
  /** Source-specific activity id (Strava activity id / HealthKit workout UUID). */
  id: string;
  sportType: string | undefined;
  startDateLocal: string;
  movingSeconds: number;
  avgHr: number | null;
}

export interface ActivityLoadRow {
  /** The per-source idempotency key — whatever `ActivityHrInput.id` carried. */
  externalId: string;
  date: Date; // UTC-midnight of the activity's LOCAL calendar day
  discipline: Discipline;
  movingSeconds: number;
  avgHr: number;
}

/**
 * Build per-activity training-load rows from synced activities. Keeps only
 * mapped disciplines that recorded HR and moving time — activities without a
 * heart rate can't be scored (hrTSS) and are dropped. The date is the activity's
 * LOCAL calendar day (from start_date_local), so load lands on the day trained.
 */
export function buildActivityLoadRows(activities: ActivityHrInput[]): ActivityLoadRow[] {
  const rows: ActivityLoadRow[] = [];
  for (const a of activities) {
    const discipline = mapSportTypeToDiscipline(a.sportType);
    if (!discipline) continue;
    if (!a.id) continue;
    if (!(a.movingSeconds > 0)) continue;
    if (a.avgHr == null || !(a.avgHr > 0)) continue;

    const parsed = new Date(a.startDateLocal);
    if (Number.isNaN(parsed.getTime())) continue;
    const date = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
    );

    rows.push({
      externalId: a.id,
      date,
      discipline,
      movingSeconds: Math.round(a.movingSeconds),
      avgHr: Math.round(a.avgHr),
    });
  }
  return rows;
}
