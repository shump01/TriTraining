import { prisma } from "@/lib/prisma";
import { buildActivityLoadRows } from "@/lib/strava/sync-core";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { buildAppleHealthRows, toActivityHrInputs, type HealthWorkoutInput } from "./core";

export interface HealthIngestResult {
  ok: true;
  workouts: number;
  weeksWritten: number;
  /** ActivityLoad rows written (workouts that carried id + duration + HR). */
  loadWritten: number;
}

/**
 * Ingest a full batch of Apple Health workouts into WeeklyActual rows — and,
 * for workouts that carry duration + heart rate, ActivityLoad rows so the
 * training-load features (Fitness/Fatigue/Form, zones) work without Strava.
 *
 * The app always sends everything since the earliest plan week, so ingest is
 * an idempotent replace: all APPLE_HEALTH rows for the user are rewritten in
 * one transaction (mirroring Strava sync). Re-syncs and deletions on the Watch
 * therefore reconcile exactly; MANUAL and STRAVA rows are never touched — each
 * writer owns exactly its own source's rows, on both tables.
 */
export async function ingestHealthWorkouts(
  userId: string,
  workouts: HealthWorkoutInput[],
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
    return { ok: true, workouts: workouts.length, weeksWritten: 0, loadWritten: 0 };
  }

  const rows = buildAppleHealthRows(planRanges, workouts);
  // Per-workout HR data → training load, reusing the exact builder the Strava
  // path uses (sport mapping, positive-value rules, local-day dating).
  const loadRows = buildActivityLoadRows(toActivityHrInputs(workouts));
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

    // Same idempotent replace for training load — APPLE_HEALTH rows only, so
    // Strava's rows survive here exactly as ours survive its sync.
    await tx.activityLoad.deleteMany({ where: { userId, source: "APPLE_HEALTH" } });
    if (loadRows.length > 0) {
      await tx.activityLoad.createMany({
        data: loadRows.map((r) => ({ userId, source: "APPLE_HEALTH" as const, ...r })),
        skipDuplicates: true,
      });
    }
  });

  return {
    ok: true,
    workouts: workouts.length,
    weeksWritten: rows.length,
    loadWritten: loadRows.length,
  };
}
