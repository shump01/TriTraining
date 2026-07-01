import { logger } from "@/lib/logger";
import { startOfWeekMonday } from "@/lib/weekly-targets";

import { fetchRecentActivities } from "./client";
import { getValidStravaAccessToken } from "./connection";
import { DISCIPLINES, aggregateActivitiesByWeek, type Discipline } from "./sync-core";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyAverageResult {
  /** Whether the user has a usable Strava connection. */
  connected: boolean;
  /** Number of trailing completed weeks the average is computed over. */
  weeks: number;
  /** Average weekly meters per discipline (0 where there's no recent activity). */
  averages: Record<Discipline, number>;
}

function zeroAverages(): Record<Discipline, number> {
  return { SWIM: 0, BIKE: 0, RUN: 0 };
}

/**
 * Average weekly training volume per discipline over the last `weeks` fully
 * completed weeks (the current, still-in-progress week is excluded), computed
 * directly from Strava activity history — no training plan required. Used to
 * suggest a starting weekly volume when creating a new plan.
 *
 * Never throws: `connected: false` when there's no usable Strava connection;
 * on a Strava API failure, `connected: true` with zero averages (the caller
 * can still offer to try again).
 */
export async function getRecentWeeklyAverages(
  userId: string,
  weeks = 4,
): Promise<WeeklyAverageResult> {
  const accessToken = await getValidStravaAccessToken(userId);
  if (!accessToken) {
    return { connected: false, weeks, averages: zeroAverages() };
  }

  const currentWeekMs = startOfWeekMonday(new Date()).getTime();
  const rangeStartMs = currentWeekMs - weeks * WEEK_MS;

  let activities;
  try {
    ({ activities } = await fetchRecentActivities(accessToken, {
      afterEpochSeconds: Math.floor(rangeStartMs / 1000) - 1,
    }));
  } catch (error) {
    logger.error("Strava weekly-average fetch failed", { error });
    return { connected: true, weeks, averages: zeroAverages() };
  }

  const totals = zeroAverages();
  for (const bucket of aggregateActivitiesByWeek(activities)) {
    const ms = bucket.weekStartDate.getTime();
    // Only the `weeks` completed weeks before the current one.
    if (ms >= rangeStartMs && ms < currentWeekMs) {
      totals[bucket.discipline] += bucket.meters;
    }
  }

  const averages = Object.fromEntries(
    DISCIPLINES.map((d) => [d, Math.round(totals[d] / weeks)]),
  ) as Record<Discipline, number>;

  return { connected: true, weeks, averages };
}
