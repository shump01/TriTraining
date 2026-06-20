import { auth } from "@/auth";
import { ActualSource, Discipline } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreatePlanInput, RecomputePlanInput } from "@/lib/validation";
import { computeWeeklyTargets, firstMondayOnOrAfter } from "@/lib/weekly-targets";

/** Thrown when an operation is attempted without an authenticated session. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized: no authenticated user");
    this.name = "UnauthorizedError";
  }
}

/** Thrown when a plan doesn't exist or isn't owned by the current user. */
export class NotFoundError extends Error {
  constructor() {
    super("Training plan not found");
    this.name = "NotFoundError";
  }
}

type DisciplineVolumes = {
  discipline: Discipline;
  startingWeeklyMeters: number;
  eventDistanceMeters: number;
};

/**
 * Build the WeeklyTarget rows for a plan by running the (pure) progression
 * engine for each discipline. Week 1 aligns to the first Monday on/after the
 * plan's creation date.
 */
function buildWeeklyTargetRows(args: {
  planId: string;
  createdAt: Date;
  eventDate: Date;
  disciplines: DisciplineVolumes[];
}) {
  const startDate = firstMondayOnOrAfter(args.createdAt);
  return args.disciplines.flatMap((d) =>
    computeWeeklyTargets({
      startDate,
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

  return prisma.$transaction(async (tx) => {
    const plan = await tx.trainingPlan.create({
      data: { userId, name: input.name, eventDate: input.eventDate },
    });

    const disciplines: DisciplineVolumes[] = DISCIPLINE_ORDER.map((discipline) => ({
      discipline,
      eventDistanceMeters: input.disciplines[discipline].eventDistanceMeters,
      startingWeeklyMeters: input.disciplines[discipline].startingWeeklyMeters,
    }));

    await tx.planDiscipline.createMany({
      data: disciplines.map((d) => ({ planId: plan.id, ...d })),
    });

    // Run the progression engine and bulk-insert targets in the same transaction.
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        createdAt: plan.createdAt,
        eventDate: plan.eventDate,
        disciplines,
      }),
    });

    return plan;
  });
}

/**
 * Regenerate a plan's weekly targets, optionally applying changes to the event
 * date and/or per-discipline starting volumes / event distances first. Scoped to
 * the owning user and wrapped in a transaction (old targets are replaced).
 *
 * @throws UnauthorizedError | NotFoundError
 */
export async function recomputePlanTargets(planId: string, updates: RecomputePlanInput) {
  const userId = await requireUserId();

  return prisma.$transaction(async (tx) => {
    // Ownership check inside the transaction — scoped to the session user.
    const plan = await tx.trainingPlan.findFirst({
      where: { id: planId, userId },
      include: { disciplines: true },
    });
    if (!plan) {
      throw new NotFoundError();
    }

    const eventDate = updates.eventDate ?? plan.eventDate;
    if (updates.eventDate) {
      await tx.trainingPlan.update({
        where: { id: plan.id },
        data: { eventDate: updates.eventDate },
      });
    }

    // Resolve effective volumes (apply updates, else keep current) and persist
    // any discipline changes.
    const disciplines: DisciplineVolumes[] = [];
    for (const d of plan.disciplines) {
      const update = updates.disciplines?.[d.discipline];
      const startingWeeklyMeters = update?.startingWeeklyMeters ?? d.startingWeeklyMeters;
      const eventDistanceMeters = update?.eventDistanceMeters ?? d.eventDistanceMeters;

      if (update?.startingWeeklyMeters !== undefined || update?.eventDistanceMeters !== undefined) {
        await tx.planDiscipline.update({
          where: { planId_discipline: { planId: plan.id, discipline: d.discipline } },
          data: { startingWeeklyMeters, eventDistanceMeters },
        });
      }

      disciplines.push({ discipline: d.discipline, startingWeeklyMeters, eventDistanceMeters });
    }

    // Replace the targets atomically.
    await tx.weeklyTarget.deleteMany({ where: { planId: plan.id } });
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        createdAt: plan.createdAt,
        eventDate,
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

export async function recordWeeklyActual(input: {
  planId: string;
  discipline: Discipline;
  weekStartDate: Date;
  actualMeters: number;
  source: ActualSource;
}) {
  const userId = await requireUserId();
  await assertPlanOwned(input.planId, userId);
  // Upsert on the (plan, discipline, week, source) key so re-recording the same
  // week replaces rather than duplicates.
  return prisma.weeklyActual.upsert({
    where: {
      planId_discipline_weekStartDate_source: {
        planId: input.planId,
        discipline: input.discipline,
        weekStartDate: input.weekStartDate,
        source: input.source,
      },
    },
    create: input,
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
