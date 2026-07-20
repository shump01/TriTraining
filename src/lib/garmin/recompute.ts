import { prisma } from "@/lib/prisma";
import { aggregateActivitiesByWeek, buildActivityLoadRows } from "@/lib/strava/sync-core";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { toActivityHrInputs, toActivityInputs } from "./core";

export interface GarminRecomputeResult {
  activities: number;
  weeksWritten: number;
  loadRowsWritten: number;
}

/**
 * Recompute the GARMIN-sourced WeeklyActual and ActivityLoad rows from the
 * stored GarminActivity set.
 *
 * Garmin's write model differs from the other providers: Strava sync and Apple
 * Health ingest each hold a complete, re-fetchable activity list, so they
 * replace from it directly. Garmin pushes incremental per-activity events and
 * retains nothing re-fetchable (~7-day server retention), so GarminActivity is
 * the system of record — the webhook upserts rows there, then calls this to
 * rebuild the derived tables. Recompute-not-accumulate keeps deliveries
 * idempotent: replays, edits (same activityId, new summary), and backfill
 * batches all converge to the same derived rows.
 *
 * The transactional replace is strictly source-scoped — MANUAL, STRAVA and
 * APPLE_HEALTH rows are never touched (each writer owns exactly its own
 * source's rows, on both tables).
 */
export async function recomputeGarminDerivedRows(userId: string): Promise<GarminRecomputeResult> {
  const [records, plans] = await Promise.all([
    prisma.garminActivity.findMany({
      where: { userId },
      select: {
        activityId: true,
        sportType: true,
        startTimeUtc: true,
        offsetSeconds: true,
        distanceMeters: true,
        durationSeconds: true,
        avgHr: true,
      },
    }),
    prisma.trainingPlan.findMany({
      where: { userId },
      select: {
        id: true,
        startDate: true,
        createdAt: true,
        eventDate: true,
        weekStartDay: true,
        disciplines: { select: { discipline: true } },
      },
    }),
  ]);

  // Each plan covers weeks [week-1 start .. start of event week], aligned to
  // the plan's own week-start day, restricted to the sports it includes —
  // the same fan-out the Strava sync does.
  const planRanges = plans.map((p) => ({
    id: p.id,
    weekStartDay: p.weekStartDay,
    startMs: planStartWeek(p).getTime(),
    endMs: startOfWeek(p.eventDate, p.weekStartDay).getTime(),
    disciplines: new Set<string>(p.disciplines.map((d) => d.discipline)),
  }));

  const activities = toActivityInputs(records);

  // Plans may use different week-start days; bucket once per distinct day.
  const bucketsByDay = new Map<number, ReturnType<typeof aggregateActivitiesByWeek>>();
  for (const day of new Set(planRanges.map((r) => r.weekStartDay))) {
    bucketsByDay.set(day, aggregateActivitiesByWeek(activities, day));
  }

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
        source: "GARMIN" as const,
      })),
  );

  const loadRows = buildActivityLoadRows(toActivityHrInputs(records));

  const planIds = planRanges.map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    if (planIds.length > 0) {
      await tx.weeklyActual.deleteMany({ where: { planId: { in: planIds }, source: "GARMIN" } });
      if (rows.length > 0) {
        await tx.weeklyActual.createMany({ data: rows, skipDuplicates: true });
      }
    }
    // ActivityLoad is whole-athlete, and the full Garmin history lives locally,
    // so replace ALL GARMIN load rows — including when no plans exist (load is
    // not plan-scoped, unlike weekly actuals).
    await tx.activityLoad.deleteMany({ where: { userId, source: "GARMIN" } });
    if (loadRows.length > 0) {
      await tx.activityLoad.createMany({
        data: loadRows.map((r) => ({ userId, source: "GARMIN" as const, ...r })),
        skipDuplicates: true,
      });
    }
  });

  return {
    activities: records.length,
    weeksWritten: rows.length,
    loadRowsWritten: loadRows.length,
  };
}
