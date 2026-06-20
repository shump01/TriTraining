import { prisma } from "@/lib/prisma";
import { firstMondayOnOrAfter, startOfWeekMonday } from "@/lib/weekly-targets";

import { fetchRecentActivities } from "./client";
import { getValidStravaAccessToken } from "./connection";
import { aggregateActivitiesByWeek } from "./sync-core";

export interface SyncResult {
  ok: boolean;
  reason?: "not_connected";
  activities: number;
  weeksWritten: number;
  rateLimited: boolean;
}

/**
 * Sync the user's recent Strava activities into WeeklyActual rows.
 *
 * - Fetches activities (paginated, 429-tolerant) since the earliest plan week.
 * - Buckets distance into Monday-start weeks per discipline.
 * - For every plan whose date range covers a week, writes a STRAVA-sourced
 *   WeeklyActual for that (plan, discipline, week).
 * - Idempotent: replaces all STRAVA-sourced actuals for the user's plans in a
 *   single transaction (MANUAL actuals are left untouched), so re-running yields
 *   the same numbers and reflects deletions on Strava.
 */
export async function syncStravaActivities(userId: string): Promise<SyncResult> {
  // Refreshes the token first if needed; null when not connected / revoked.
  const accessToken = await getValidStravaAccessToken(userId);
  if (!accessToken) {
    return {
      ok: false,
      reason: "not_connected",
      activities: 0,
      weeksWritten: 0,
      rateLimited: false,
    };
  }

  const plans = await prisma.trainingPlan.findMany({
    where: { userId },
    select: { id: true, createdAt: true, eventDate: true },
  });

  // Each plan covers weeks [first Monday on/after creation .. Monday of event week].
  const planRanges = plans.map((p) => ({
    id: p.id,
    startMs: firstMondayOnOrAfter(p.createdAt).getTime(),
    endMs: startOfWeekMonday(p.eventDate).getTime(),
  }));

  // Nothing to bucket into — still record that we synced.
  if (planRanges.length === 0) {
    await prisma.stravaConnection
      .update({ where: { userId }, data: { lastSyncedAt: new Date() } })
      .catch(() => {});
    return { ok: true, activities: 0, weeksWritten: 0, rateLimited: false };
  }

  const earliestMs = Math.min(...planRanges.map((r) => r.startMs));
  const afterEpochSeconds = Math.floor(earliestMs / 1000) - 1;

  const { activities, rateLimited } = await fetchRecentActivities(accessToken, {
    afterEpochSeconds,
  });

  const buckets = aggregateActivitiesByWeek(activities);

  // Fan each bucket out to every plan whose range covers that week.
  const rows = buckets.flatMap((bucket) => {
    const weekMs = bucket.weekStartDate.getTime();
    return planRanges
      .filter((r) => weekMs >= r.startMs && weekMs <= r.endMs)
      .map((r) => ({
        planId: r.id,
        discipline: bucket.discipline,
        weekStartDate: bucket.weekStartDate,
        actualMeters: bucket.meters,
        source: "STRAVA" as const,
      }));
  });

  const planIds = planRanges.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    // Replace (not accumulate) STRAVA-sourced actuals — keeps sync idempotent.
    await tx.weeklyActual.deleteMany({ where: { planId: { in: planIds }, source: "STRAVA" } });
    if (rows.length > 0) {
      await tx.weeklyActual.createMany({ data: rows });
    }
    await tx.stravaConnection.update({ where: { userId }, data: { lastSyncedAt: new Date() } });
  });

  return { ok: true, activities: activities.length, weeksWritten: rows.length, rateLimited };
}
