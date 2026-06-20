import { startOfWeekMonday } from "@/lib/weekly-targets";

/**
 * Pure mapping + bucketing logic for activity sync — no DB, no network, no
 * framework. Easy to unit-test in isolation.
 */

export const DISCIPLINES = ["SWIM", "BIKE", "RUN"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

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
 * Bucket activities into Monday-start weeks and total the distance per
 * (discipline, week). Unmapped types and non-positive/invalid distances are
 * skipped. Totals are floored to whole meters.
 */
export function aggregateActivitiesByWeek(activities: ActivityInput[]): WeeklyActualBucket[] {
  const sums = new Map<string, { discipline: Discipline; weekMs: number; meters: number }>();

  for (const activity of activities) {
    const discipline = mapSportTypeToDiscipline(activity.sportType);
    if (!discipline) continue;
    if (!Number.isFinite(activity.distanceMeters) || activity.distanceMeters <= 0) continue;

    const parsed = new Date(activity.startDateLocal);
    if (Number.isNaN(parsed.getTime())) continue;
    const weekMs = startOfWeekMonday(parsed).getTime();

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
