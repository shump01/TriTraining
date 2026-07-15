import { prisma } from "@/lib/prisma";
import { type ActivityInput } from "@/lib/strava/sync-core";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { buildAppleHealthRows } from "./core";

export interface HealthIngestResult {
  ok: true;
  workouts: number;
  weeksWritten: number;
}

/**
 * Ingest a full batch of Apple Health workouts into WeeklyActual rows.
 *
 * The app always sends everything since the earliest plan week, so ingest is
 * an idempotent replace: all APPLE_HEALTH rows for the user's plans are
 * rewritten in one transaction (mirroring Strava sync). Re-syncs and deletions
 * on the Watch therefore reconcile exactly; MANUAL and STRAVA rows are never
 * touched.
 */
export async function ingestHealthWorkouts(
  userId: string,
  workouts: ActivityInput[],
): Promise<HealthIngestResult> {
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

  const planRanges = plans.map((p) => ({
    id: p.id,
    weekStartDay: p.weekStartDay,
    startMs: planStartWeek(p).getTime(),
    endMs: startOfWeek(p.eventDate, p.weekStartDay).getTime(),
    disciplines: new Set<string>(p.disciplines.map((d) => d.discipline)),
  }));

  if (planRanges.length === 0) {
    return { ok: true, workouts: workouts.length, weeksWritten: 0 };
  }

  const rows = buildAppleHealthRows(planRanges, workouts);
  const planIds = planRanges.map((r) => r.id);

  await prisma.$transaction(async (tx) => {
    await tx.weeklyActual.deleteMany({
      where: { planId: { in: planIds }, source: "APPLE_HEALTH" },
    });
    if (rows.length > 0) {
      // skipDuplicates keeps concurrent ingests of the same batch from failing
      // on the unique key: the loser's deleteMany snapshot predates the
      // winner's commit, so its inserts would otherwise conflict.
      await tx.weeklyActual.createMany({ data: rows, skipDuplicates: true });
    }
  });

  return { ok: true, workouts: workouts.length, weeksWritten: rows.length };
}
