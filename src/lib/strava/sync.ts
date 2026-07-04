import { prisma } from "@/lib/prisma";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { fetchRecentActivities } from "./client";
import { getValidStravaAccessToken } from "./connection";
import { activitiesAfterSeconds, aggregateActivitiesByWeek } from "./sync-core";

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
    select: {
      id: true,
      startDate: true,
      createdAt: true,
      eventDate: true,
      weekStartDay: true,
      disciplines: { select: { discipline: true } },
    },
  });

  // Each plan covers weeks [week-1 start .. start of event week], aligned to the
  // plan's own week-start day, and only the sports it actually includes (a
  // run-only plan ignores bike/swim activities).
  const planRanges = plans.map((p) => ({
    id: p.id,
    weekStartDay: p.weekStartDay,
    startMs: planStartWeek(p).getTime(),
    endMs: startOfWeek(p.eventDate, p.weekStartDay).getTime(),
    disciplines: new Set<string>(p.disciplines.map((d) => d.discipline)),
  }));

  // Nothing to bucket into — still record that we synced.
  if (planRanges.length === 0) {
    await prisma.stravaConnection
      .update({ where: { userId }, data: { lastSyncedAt: new Date() } })
      .catch(() => {});
    return { ok: true, activities: 0, weeksWritten: 0, rateLimited: false };
  }

  const earliestMs = Math.min(...planRanges.map((r) => r.startMs));
  const afterEpochSeconds = activitiesAfterSeconds(earliestMs);

  const { activities, rateLimited } = await fetchRecentActivities(accessToken, {
    afterEpochSeconds,
  });

  // Plans may use different week-start days, so bucket once per distinct day
  // (usually just one) — a bucket's week boundary must match the plan it feeds.
  const bucketsByDay = new Map<number, ReturnType<typeof aggregateActivitiesByWeek>>();
  for (const day of new Set(planRanges.map((r) => r.weekStartDay))) {
    bucketsByDay.set(day, aggregateActivitiesByWeek(activities, day));
  }

  // Fan each plan's day-aligned buckets out to the weeks its range covers.
  const rows = planRanges.flatMap((r) =>
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
        source: "STRAVA" as const,
      })),
  );

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
