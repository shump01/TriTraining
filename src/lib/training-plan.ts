import { headers } from "next/headers";

import { auth } from "@/auth";
import { ActualSource, Discipline } from "@/generated/prisma/client";
import { effectiveActualKey, resolveEffectiveActuals } from "@/lib/actuals";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { prisma } from "@/lib/prisma";
import { computeProgress, type ProgressSummary } from "@/lib/progress";
import type { DisciplineKey } from "@/lib/ui/theme";
import type { CreatePlanInput } from "@/lib/validation";
import {
  computeAdaptedFutureTargets,
  computeWeeklyTargets,
  planStartWeek,
  startOfWeek,
  type AdaptiveDisciplineInput,
} from "@/lib/weekly-targets";

/** Thrown when an operation is attempted without an authenticated session. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized: no authenticated user");
    this.name = "UnauthorizedError";
  }
}

/** Thrown when a requested week falls outside the plan's date range. */
export class WeekOutOfRangeError extends Error {
  constructor() {
    super("Week is outside the plan's date range");
    this.name = "WeekOutOfRangeError";
  }
}

/** Thrown when a plan doesn't exist or isn't owned by the current user. */
export class NotFoundError extends Error {
  constructor() {
    super("Training plan not found");
    this.name = "NotFoundError";
  }
}

/** Thrown when a plan's start date is not strictly before its event date. */
export class PlanDateRangeError extends Error {
  constructor() {
    super("Start date must be before the event date");
    this.name = "PlanDateRangeError";
  }
}

type DisciplineVolumes = {
  discipline: Discipline;
  startingWeeklyMeters: number;
  eventDistanceMeters: number;
};

/**
 * Build the WeeklyTarget rows for a plan by running the (pure) progression
 * engine for each discipline. `startDate` is week 1's Monday (already aligned by
 * the caller).
 */
function buildWeeklyTargetRows(args: {
  planId: string;
  startDate: Date;
  eventDate: Date;
  capMultiple: number;
  disciplines: DisciplineVolumes[];
}) {
  return args.disciplines.flatMap((d) =>
    computeWeeklyTargets({
      startDate: args.startDate,
      eventDate: args.eventDate,
      startingWeeklyMeters: d.startingWeeklyMeters,
      eventDistanceMeters: d.eventDistanceMeters,
      capMultiple: args.capMultiple,
    }).map((t) => ({
      planId: args.planId,
      discipline: d.discipline,
      weekStartDate: t.weekStartDate,
      targetMeters: t.targetMeters,
    })),
  );
}

/** Canonical discipline order used when persisting a plan's disciplines. */
const DISCIPLINE_ORDER = [Discipline.SWIM, Discipline.BIKE, Discipline.RUN] as const;

/**
 * User-scoped data access for the training-plan domain.
 *
 * The golden rule (see prisma/schema.prisma): every query is filtered by the
 * **authenticated** user id, which is read from the session here and never
 * accepted as an argument. Callers therefore cannot read or mutate another
 * user's data, even with a forged id.
 *
 * Top-level rows (TrainingPlan) are scoped by `userId` directly. Child rows
 * (PlanDiscipline / WeeklyTarget / WeeklyActual) are scoped transitively via the
 * `plan: { userId }` relation filter, or by an explicit ownership assertion
 * before a write.
 */

/**
 * Mobile-client fallback: resolve the user from an `Authorization: Bearer`
 * token, which is a `Session.sessionToken` handed out by the login route (see
 * src/app/api/auth/login/route.ts). Same table, same expiry semantics as the
 * cookie session — just a different transport. Returns null when there is no
 * usable bearer token (including outside a request scope, e.g. unit tests).
 */
async function bearerUserId(): Promise<string | null> {
  let authorization: string | null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    return null;
  }
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice("bearer ".length).trim();
  if (!token) return null;

  const session = await prisma.session.findFirst({
    where: { sessionToken: token, expires: { gt: new Date() } },
    select: { userId: true },
  });
  return session?.userId ?? null;
}

/** Resolve the authenticated user's id, or throw. The only source of `userId`. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id ?? (await bearerUserId());
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}

// ── TrainingPlan ─────────────────────────────────────────────────────────────

export async function listTrainingPlans() {
  const userId = await requireUserId();
  return prisma.trainingPlan.findMany({
    where: { userId },
    orderBy: { eventDate: "asc" },
  });
}

export async function getTrainingPlan(planId: string) {
  const userId = await requireUserId();
  // Filtered by id AND userId — a plan id belonging to someone else returns null.
  return prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    include: {
      disciplines: true,
      weeklyTargets: { orderBy: { weekStartDate: "asc" } },
      weeklyActuals: true,
    },
  });
}

export interface PlanWithProgress {
  id: string;
  name: string;
  eventDate: Date;
  /** Start of week 1 (ms) — the app's Apple Health sync queries from here. */
  startDateMs: number;
  summary: ProgressSummary;
  weeksToGo: number;
  disciplines: DisciplineKey[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** All of the user's plans with their combined (all-sports) progress summary. */
export async function listTrainingPlansWithProgress(): Promise<PlanWithProgress[]> {
  const userId = await requireUserId();
  const plans = await prisma.trainingPlan.findMany({
    where: { userId },
    orderBy: { eventDate: "asc" },
    include: { weeklyTargets: true, weeklyActuals: true },
  });
  const now = new Date();
  return plans.map((p) => {
    const { total, disciplines } = buildPlanProgressInputs(p);
    const { summary } = computeProgress(total, now);
    const weeksToGo = Math.max(0, Math.ceil((p.eventDate.getTime() - now.getTime()) / WEEK_MS));
    return {
      id: p.id,
      name: p.name,
      eventDate: p.eventDate,
      startDateMs: planStartWeek(p).getTime(),
      summary,
      weeksToGo,
      disciplines,
    };
  });
}

/** Most recent weekly actuals across the user's plans (for the dashboard feed). */
export async function listRecentActuals(limit = 4) {
  const userId = await requireUserId();
  return prisma.weeklyActual.findMany({
    where: { plan: { userId } },
    orderBy: [{ weekStartDate: "desc" }, { actualMeters: "desc" }],
    take: limit,
    select: {
      discipline: true,
      weekStartDate: true,
      actualMeters: true,
      source: true,
      plan: { select: { name: true } },
    },
  });
}

/**
 * Create a plan together with its three discipline rows AND the generated weekly
 * targets, all in a single transaction. `userId` comes from the session — never
 * from `input`. If any write fails, the whole thing rolls back so we never
 * persist a half-created plan.
 */
export async function createTrainingPlanWithDisciplines(input: CreatePlanInput) {
  const userId = await requireUserId();

  // Week 1's start — the day the user chose (back-dated if they've already been
  // training), defaulting to the current week. Aligned to the plan's week-start day.
  const startWeek = startOfWeek(input.startDate ?? new Date(), input.weekStartDay);
  if (startWeek.getTime() >= input.eventDate.getTime()) {
    throw new PlanDateRangeError();
  }

  return prisma.$transaction(async (tx) => {
    const plan = await tx.trainingPlan.create({
      data: {
        userId,
        name: input.name,
        eventDate: input.eventDate,
        startDate: startWeek,
        capMultiple: input.capMultiple,
        weekStartDay: input.weekStartDay,
      },
    });

    const disciplines: DisciplineVolumes[] = DISCIPLINE_ORDER.filter(
      (discipline) => input.disciplines[discipline],
    ).map((discipline) => ({
      discipline,
      eventDistanceMeters: input.disciplines[discipline]!.eventDistanceMeters,
      startingWeeklyMeters: input.disciplines[discipline]!.startingWeeklyMeters,
    }));

    await tx.planDiscipline.createMany({
      data: disciplines.map((d) => ({ planId: plan.id, ...d })),
    });

    // Run the progression engine and bulk-insert targets in the same transaction.
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        startDate: startWeek,
        eventDate: plan.eventDate,
        capMultiple: input.capMultiple,
        disciplines,
      }),
    });

    return plan;
  });
}

/**
 * Full edit of a plan: name, start/event dates, and which disciplines are
 * included (with their volumes). Discipline rows are added / updated / removed to
 * match the input (a removed sport's recorded actuals are dropped too), then all
 * weekly targets are regenerated. Scoped to the owning user; transactional.
 *
 * @throws UnauthorizedError | NotFoundError | PlanDateRangeError
 */
export async function updateTrainingPlan(planId: string, input: CreatePlanInput) {
  const userId = await requireUserId();

  const startWeek = startOfWeek(input.startDate ?? new Date(), input.weekStartDay);
  if (startWeek.getTime() >= input.eventDate.getTime()) {
    throw new PlanDateRangeError();
  }

  return prisma.$transaction(async (tx) => {
    // Ownership check inside the transaction — scoped to the session user.
    const plan = await tx.trainingPlan.findFirst({
      where: { id: planId, userId },
      include: { disciplines: true },
    });
    if (!plan) {
      throw new NotFoundError();
    }

    const dayChanged = plan.weekStartDay !== input.weekStartDay;

    await tx.trainingPlan.update({
      where: { id: plan.id },
      data: {
        name: input.name,
        eventDate: input.eventDate,
        startDate: startWeek,
        capMultiple: input.capMultiple,
        weekStartDay: input.weekStartDay,
        // A full edit regenerates targets, so the previous weekly recompute no
        // longer applies — let the next on-day view recalculate afresh.
        lastRecalcWeek: null,
      },
    });

    // Reconcile disciplines against the selected set.
    const selected = DISCIPLINE_ORDER.filter((d) => input.disciplines[d]);
    const selectedSet = new Set<Discipline>(selected);
    const removed = plan.disciplines.map((d) => d.discipline).filter((d) => !selectedSet.has(d));

    if (removed.length > 0) {
      // Drop deselected sports and any actuals recorded against them.
      await tx.weeklyActual.deleteMany({
        where: { planId: plan.id, discipline: { in: removed } },
      });
      await tx.planDiscipline.deleteMany({
        where: { planId: plan.id, discipline: { in: removed } },
      });
    }

    const disciplines: DisciplineVolumes[] = [];
    for (const d of selected) {
      const v = input.disciplines[d]!;
      await tx.planDiscipline.upsert({
        where: { planId_discipline: { planId: plan.id, discipline: d } },
        create: {
          planId: plan.id,
          discipline: d,
          eventDistanceMeters: v.eventDistanceMeters,
          startingWeeklyMeters: v.startingWeeklyMeters,
        },
        update: {
          eventDistanceMeters: v.eventDistanceMeters,
          startingWeeklyMeters: v.startingWeeklyMeters,
        },
      });
      disciplines.push({
        discipline: d,
        eventDistanceMeters: v.eventDistanceMeters,
        startingWeeklyMeters: v.startingWeeklyMeters,
      });
    }

    // If the week-start day changed, existing actuals are keyed to the old grid.
    // Clear STRAVA actuals (they regenerate on the next sync) and re-anchor MANUAL
    // ones onto the new grid, deduping any that collapse onto the same week.
    if (dayChanged) {
      await tx.weeklyActual.deleteMany({
        where: { planId: plan.id, source: ActualSource.STRAVA },
      });
      const manual = await tx.weeklyActual.findMany({
        where: { planId: plan.id, source: ActualSource.MANUAL },
      });
      await tx.weeklyActual.deleteMany({
        where: { planId: plan.id, source: ActualSource.MANUAL },
      });
      const reanchored = new Map<
        string,
        { discipline: Discipline; weekStartDate: Date; actualMeters: number }
      >();
      for (const a of manual) {
        const wk = startOfWeek(a.weekStartDate, input.weekStartDay);
        const key = `${a.discipline}|${wk.getTime()}`;
        const existing = reanchored.get(key);
        if (!existing || a.actualMeters > existing.actualMeters) {
          reanchored.set(key, {
            discipline: a.discipline,
            weekStartDate: wk,
            actualMeters: a.actualMeters,
          });
        }
      }
      if (reanchored.size > 0) {
        await tx.weeklyActual.createMany({
          data: [...reanchored.values()].map((r) => ({
            planId: plan.id,
            discipline: r.discipline,
            weekStartDate: r.weekStartDate,
            actualMeters: r.actualMeters,
            source: ActualSource.MANUAL,
          })),
        });
      }
    }

    // Regenerate targets for the resulting discipline set.
    await tx.weeklyTarget.deleteMany({ where: { planId: plan.id } });
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        startDate: startWeek,
        eventDate: input.eventDate,
        capMultiple: input.capMultiple,
        disciplines,
      }),
    });

    return tx.trainingPlan.findUnique({
      where: { id: plan.id },
      include: {
        disciplines: true,
        weeklyTargets: { orderBy: { weekStartDate: "asc" } },
      },
    });
  });
}

export async function deleteTrainingPlan(planId: string): Promise<boolean> {
  const userId = await requireUserId();
  // deleteMany with the userId guard: a no-op (count 0) if the plan isn't theirs.
  const { count } = await prisma.trainingPlan.deleteMany({ where: { id: planId, userId } });
  return count > 0;
}

/**
 * The weekly "roll forward": re-ramp a plan's current + future targets from the
 * **last completed week's actual** volume, using the same progression engine
 * (see [computeAdaptedFutureTargets](src/lib/weekly-targets.ts)).
 *
 * Runs **only** when the plan is viewed **on its week-start day** and hasn't
 * already recalculated this week (the `lastRecalcWeek` guard) — so it's a cheap
 * no-op on every other view. Past weeks and the just-completed week keep their
 * historical targets; only weeks on/after the current week are rewritten, and
 * only for disciplines that produced a new ramp (no data is dropped otherwise).
 *
 * Scoped to the session user. Returns whether it recalculated.
 */
export async function maybeRecalculatePlan(planId: string): Promise<boolean> {
  const userId = await requireUserId();

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: {
      id: true,
      startDate: true,
      createdAt: true,
      eventDate: true,
      weekStartDay: true,
      capMultiple: true,
      lastRecalcWeek: true,
      disciplines: { select: { discipline: true, eventDistanceMeters: true } },
      weeklyTargets: { select: { discipline: true, weekStartDate: true, targetMeters: true } },
      weeklyActuals: {
        select: { discipline: true, weekStartDate: true, actualMeters: true, source: true },
      },
    },
  });
  if (!plan) return false;

  const now = new Date();
  // Trigger only on the plan's week-start day (UTC — consistent with all week math).
  if (now.getUTCDay() !== plan.weekStartDay) return false;

  const currentWeekStart = startOfWeek(now, plan.weekStartDay);
  // Already rolled forward for this week.
  if (plan.lastRecalcWeek && plan.lastRecalcWeek.getTime() === currentWeekStart.getTime()) {
    return false;
  }

  const planStart = planStartWeek(plan);
  const lastPlanWeek = startOfWeek(plan.eventDate, plan.weekStartDay);
  // Nothing to adapt before the plan has a completed week, or once it's over.
  if (currentWeekStart.getTime() <= planStart.getTime()) return false;
  if (currentWeekStart.getTime() > lastPlanWeek.getTime()) return false;

  const lastCompletedWeekStart = new Date(currentWeekStart.getTime() - WEEK_MS);

  // Effective actual (MANUAL over STRAVA) + original target for the completed week.
  const effective = resolveEffectiveActuals(plan.weeklyActuals);
  const targetByKey = new Map<string, number>();
  for (const t of plan.weeklyTargets) {
    targetByKey.set(effectiveActualKey(t.discipline, t.weekStartDate), t.targetMeters);
  }

  const disciplines: AdaptiveDisciplineInput[] = plan.disciplines.map((d) => {
    const key = effectiveActualKey(d.discipline, lastCompletedWeekStart);
    return {
      discipline: d.discipline,
      eventDistanceMeters: d.eventDistanceMeters,
      lastCompletedActual: effective.get(key)?.meters ?? null,
      lastCompletedTarget: targetByKey.get(key) ?? 0,
    };
  });

  const newRows = computeAdaptedFutureTargets({
    disciplines,
    lastCompletedWeekStart,
    currentWeekStart,
    eventDate: plan.eventDate,
    capMultiple: plan.capMultiple,
  });

  // Only replace future targets for disciplines that produced a fresh ramp.
  const touched = [...new Set(newRows.map((r) => r.discipline as Discipline))];

  await prisma.$transaction(async (tx) => {
    if (touched.length > 0) {
      await tx.weeklyTarget.deleteMany({
        where: {
          planId: plan.id,
          weekStartDate: { gte: currentWeekStart },
          discipline: { in: touched },
        },
      });
      await tx.weeklyTarget.createMany({
        data: newRows.map((r) => ({
          planId: plan.id,
          discipline: r.discipline as Discipline,
          weekStartDate: r.weekStartDate,
          targetMeters: r.targetMeters,
        })),
      });
    }
    await tx.trainingPlan.update({
      where: { id: plan.id },
      data: { lastRecalcWeek: currentWeekStart },
    });
  });

  return true;
}

// ── Child records (scoped via the parent plan's ownership) ───────────────────

/**
 * Manually record/override a weekly actual (source = MANUAL).
 *
 * `userId` comes from the session. The week is normalized to its Monday and must
 * fall within the plan's date range. Upserts on (plan, discipline, week, MANUAL)
 * so re-entering a week replaces rather than duplicates. A MANUAL entry takes
 * precedence over STRAVA at read time (see src/lib/actuals.ts).
 *
 * @throws UnauthorizedError | NotFoundError | WeekOutOfRangeError
 */
export async function recordManualActual(input: {
  planId: string;
  discipline: Discipline;
  weekStartDate: Date;
  actualMeters: number;
}) {
  const userId = await requireUserId();

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: input.planId, userId },
    select: { id: true, startDate: true, createdAt: true, eventDate: true, weekStartDay: true },
  });
  if (!plan) {
    throw new NotFoundError();
  }

  const weekStartDate = startOfWeek(input.weekStartDate, plan.weekStartDay);
  const startMs = planStartWeek(plan).getTime();
  const endMs = startOfWeek(plan.eventDate, plan.weekStartDay).getTime();
  if (weekStartDate.getTime() < startMs || weekStartDate.getTime() > endMs) {
    throw new WeekOutOfRangeError();
  }

  return prisma.weeklyActual.upsert({
    where: {
      planId_discipline_weekStartDate_source: {
        planId: plan.id,
        discipline: input.discipline,
        weekStartDate,
        source: ActualSource.MANUAL,
      },
    },
    create: {
      planId: plan.id,
      discipline: input.discipline,
      weekStartDate,
      actualMeters: input.actualMeters,
      source: ActualSource.MANUAL,
    },
    update: { actualMeters: input.actualMeters },
  });
}
