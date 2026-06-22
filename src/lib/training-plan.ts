import { auth } from "@/auth";
import { ActualSource, Discipline } from "@/generated/prisma/client";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { prisma } from "@/lib/prisma";
import { computeProgress, type ProgressSummary } from "@/lib/progress";
import type { DisciplineKey } from "@/lib/ui/theme";
import type { CreatePlanInput } from "@/lib/validation";
import { computeWeeklyTargets, planStartMonday, startOfWeekMonday } from "@/lib/weekly-targets";

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
  disciplines: DisciplineVolumes[];
}) {
  return args.disciplines.flatMap((d) =>
    computeWeeklyTargets({
      startDate: args.startDate,
      eventDate: args.eventDate,
      startingWeeklyMeters: d.startingWeeklyMeters,
      eventDistanceMeters: d.eventDistanceMeters,
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

/** Resolve the authenticated user's id, or throw. The only source of `userId`. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
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
    return { id: p.id, name: p.name, eventDate: p.eventDate, summary, weeksToGo, disciplines };
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

export async function createTrainingPlan(input: { name: string; eventDate: Date }) {
  const userId = await requireUserId();
  return prisma.trainingPlan.create({
    data: { userId, name: input.name, eventDate: input.eventDate },
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

  // Week 1's Monday — the start the user chose (back-dated if they've already
  // been training), defaulting to the current week. Aligned to a Monday.
  const startMonday = startOfWeekMonday(input.startDate ?? new Date());
  if (startMonday.getTime() >= input.eventDate.getTime()) {
    throw new PlanDateRangeError();
  }

  return prisma.$transaction(async (tx) => {
    const plan = await tx.trainingPlan.create({
      data: { userId, name: input.name, eventDate: input.eventDate, startDate: startMonday },
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
        startDate: startMonday,
        eventDate: plan.eventDate,
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

  const startMonday = startOfWeekMonday(input.startDate ?? new Date());
  if (startMonday.getTime() >= input.eventDate.getTime()) {
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

    await tx.trainingPlan.update({
      where: { id: plan.id },
      data: { name: input.name, eventDate: input.eventDate, startDate: startMonday },
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

    // Regenerate targets for the resulting discipline set.
    await tx.weeklyTarget.deleteMany({ where: { planId: plan.id } });
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        startDate: startMonday,
        eventDate: input.eventDate,
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

// ── Child records (scoped via the parent plan's ownership) ───────────────────

export async function listWeeklyTargets(planId: string) {
  const userId = await requireUserId();
  return prisma.weeklyTarget.findMany({
    where: { planId, plan: { userId } },
    orderBy: { weekStartDate: "asc" },
  });
}

export async function listWeeklyActuals(planId: string) {
  const userId = await requireUserId();
  return prisma.weeklyActual.findMany({
    where: { planId, plan: { userId } },
    orderBy: { weekStartDate: "asc" },
  });
}

export async function upsertPlanDiscipline(input: {
  planId: string;
  discipline: Discipline;
  eventDistanceMeters: number;
  startingWeeklyMeters: number;
}) {
  const userId = await requireUserId();
  await assertPlanOwned(input.planId, userId);
  return prisma.planDiscipline.upsert({
    where: {
      planId_discipline: { planId: input.planId, discipline: input.discipline },
    },
    create: input,
    update: {
      eventDistanceMeters: input.eventDistanceMeters,
      startingWeeklyMeters: input.startingWeeklyMeters,
    },
  });
}

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
    select: { id: true, startDate: true, createdAt: true, eventDate: true },
  });
  if (!plan) {
    throw new NotFoundError();
  }

  const weekStartDate = startOfWeekMonday(input.weekStartDate);
  const startMs = planStartMonday(plan).getTime();
  const endMs = startOfWeekMonday(plan.eventDate).getTime();
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

/** Throws unless the plan exists AND belongs to `userId`. */
async function assertPlanOwned(planId: string, userId: string): Promise<void> {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true },
  });
  if (!plan) {
    // Generic — don't reveal whether the plan exists but belongs to someone else.
    throw new Error("Training plan not found");
  }
}
