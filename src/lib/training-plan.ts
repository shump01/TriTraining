import { randomBytes } from "crypto";

import { headers } from "next/headers";

import { auth } from "@/auth";
import { ActualSource, Discipline, type PauseReason } from "@/generated/prisma/client";
import { effectiveActualKey, resolveEffectiveActuals } from "@/lib/actuals";
import { checkinReadinessFactor } from "@/lib/checkin";
import { getUserFormTsb } from "@/lib/load-data";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { prisma } from "@/lib/prisma";
import { computeProgress, type ProgressSummary } from "@/lib/progress";
import { balancedPct } from "@/lib/total-pct";
import { formLoadFactor } from "@/lib/training-load";
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
  taperWeeks: number;
  disciplines: DisciplineVolumes[];
}) {
  return args.disciplines.flatMap((d) =>
    computeWeeklyTargets({
      startDate: args.startDate,
      eventDate: args.eventDate,
      startingWeeklyMeters: d.startingWeeklyMeters,
      eventDistanceMeters: d.eventDistanceMeters,
      capMultiple: args.capMultiple,
      taperWeeks: args.taperWeeks,
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
      weeklyCheckins: true,
      weeklyPauses: true,
      plannedSessions: true,
    },
  });
}

/**
 * Record (upsert) a weekly wellness check-in for a plan. Scoped to the owning
 * user; the week is aligned to the plan's week-start day. Feeds the next
 * adaptive re-ramp via checkinReadinessFactor.
 */
export async function recordCheckin(
  planId: string,
  input: { weekStartDate: Date; fatigue: number; sleep: number; soreness: number; note?: string },
) {
  const userId = await requireUserId();
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, weekStartDay: true },
  });
  if (!plan) throw new NotFoundError();

  const weekStart = startOfWeek(input.weekStartDate, plan.weekStartDay);
  const data = {
    fatigue: input.fatigue,
    sleep: input.sleep,
    soreness: input.soreness,
    note: input.note ?? null,
  };
  return prisma.weeklyCheckin.upsert({
    where: { planId_weekStartDate: { planId: plan.id, weekStartDate: weekStart } },
    create: { planId: plan.id, weekStartDate: weekStart, ...data },
    update: data,
  });
}

/**
 * Mark (upsert) a week as time off — ill, injured, or away. Scoped to the owning
 * user; the week is aligned to the plan's week-start day. A paused week is left
 * out of the readiness trend/adherence, and the next re-ramp returns from a
 * detrained baseline (see returnToTrainingFactor + maybeRecalculatePlan).
 */
export async function recordPause(
  planId: string,
  input: { weekStartDate: Date; reason: PauseReason; note?: string },
) {
  const userId = await requireUserId();
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, weekStartDay: true },
  });
  if (!plan) throw new NotFoundError();

  const weekStart = startOfWeek(input.weekStartDate, plan.weekStartDay);
  const data = { reason: input.reason, note: input.note ?? null };
  return prisma.weeklyPause.upsert({
    where: { planId_weekStartDate: { planId: plan.id, weekStartDate: weekStart } },
    create: { planId: plan.id, weekStartDate: weekStart, ...data },
    update: data,
  });
}

/**
 * Un-pause a week (the athlete trained after all, or marked it by mistake).
 * Scoped to the owning user; a no-op when the week wasn't paused.
 */
export async function clearPause(planId: string, weekStartDate: Date) {
  const userId = await requireUserId();
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, weekStartDay: true },
  });
  if (!plan) throw new NotFoundError();

  const weekStart = startOfWeek(weekStartDate, plan.weekStartDay);
  await prisma.weeklyPause.deleteMany({
    where: { planId: plan.id, weekStartDate: weekStart },
  });
}

export interface PlanWithProgress {
  id: string;
  name: string;
  eventDate: Date;
  /** Start of week 1 (ms) — the app's Apple Health sync queries from here. */
  startDateMs: number;
  summary: ProgressSummary;
  /**
   * Equal-weight plan-to-date % (each sport 1/N, capped at 100) for
   * multi-sport plans — lets list surfaces honor the Total-% display mode.
   * Null for single-sport plans.
   */
  pctBalanced: number | null;
  weeksToGo: number;
  disciplines: DisciplineKey[];
  /** Season priority: "A" (goal race), "B", or "C" (tune-up). */
  priority: string;
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
    const { total, disciplines, byDiscipline } = buildPlanProgressInputs(p);
    const { summary } = computeProgress(total, now, p.weekStartDay);
    // Equal-weight companion figure so list cards can follow the Total-% mode.
    const pctBalanced =
      disciplines.length > 1
        ? balancedPct(
            disciplines.map(
              (d) =>
                computeProgress(byDiscipline[d] ?? [], now, p.weekStartDay).summary.pctOfTarget,
            ),
          )
        : null;
    const weeksToGo = Math.max(0, Math.ceil((p.eventDate.getTime() - now.getTime()) / WEEK_MS));
    return {
      id: p.id,
      name: p.name,
      eventDate: p.eventDate,
      startDateMs: planStartWeek(p).getTime(),
      summary,
      pctBalanced,
      weeksToGo,
      disciplines,
      priority: p.priority,
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
        taperWeeks: input.taperWeeks,
        priority: input.priority,
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
        taperWeeks: input.taperWeeks,
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
        taperWeeks: input.taperWeeks,
        priority: input.priority,
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
      // Drop deselected sports and any actuals recorded against them — and any
      // planner sessions, or a touched week would keep 0 m ghost sessions AND
      // fail replaceWeekSessions' discipline check on every later save.
      await tx.weeklyActual.deleteMany({
        where: { planId: plan.id, discipline: { in: removed } },
      });
      await tx.plannedSession.deleteMany({
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
      // Planner sessions are keyed to the old grid too (weekStartDate AND
      // dayOffset are both grid-relative) — a remap is ambiguous, so reset to
      // the "untouched weeks render defaults" state rather than resurrecting
      // stale rows if the grid ever switches back.
      await tx.plannedSession.deleteMany({ where: { planId: plan.id } });
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

    // Dates may have narrowed — planner rows for weeks now outside the plan
    // range would be unreachable and would fail the range check on every save.
    await tx.plannedSession.deleteMany({
      where: {
        planId: plan.id,
        OR: [
          { weekStartDate: { lt: startWeek } },
          { weekStartDate: { gt: startOfWeek(input.eventDate, input.weekStartDay) } },
        ],
      },
    });

    // Regenerate targets for the resulting discipline set.
    await tx.weeklyTarget.deleteMany({ where: { planId: plan.id } });
    await tx.weeklyTarget.createMany({
      data: buildWeeklyTargetRows({
        planId: plan.id,
        startDate: startWeek,
        eventDate: input.eventDate,
        capMultiple: input.capMultiple,
        taperWeeks: input.taperWeeks,
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
 * Enable or disable a plan's public read-only share link. Owner-scoped.
 * Enabling generates a token once (kept stable across re-enables until revoked);
 * disabling clears it so any existing link stops working. Returns the current
 * token, or null when sharing is off.
 */
export async function setPlanSharing(planId: string, enabled: boolean): Promise<string | null> {
  const userId = await requireUserId();
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: { id: true, shareToken: true },
  });
  if (!plan) throw new NotFoundError();

  if (!enabled) {
    await prisma.trainingPlan.update({ where: { id: plan.id }, data: { shareToken: null } });
    return null;
  }
  if (plan.shareToken) return plan.shareToken;

  const token = randomBytes(18).toString("base64url");
  await prisma.trainingPlan.update({ where: { id: plan.id }, data: { shareToken: token } });
  return token;
}

/**
 * PUBLIC read-only lookup by share token — deliberately NOT user-scoped, since a
 * share link is meant for people without an account. Returns the plan's display
 * data (targets + actuals) or null. Only reachable with the unguessable token,
 * and only while the owner keeps sharing on.
 */
export async function getPlanByShareToken(token: string) {
  if (!token) return null;
  return prisma.trainingPlan.findUnique({
    where: { shareToken: token },
    include: {
      disciplines: true,
      weeklyTargets: { orderBy: { weekStartDate: "asc" } },
      weeklyActuals: true,
      // Without these the shared view reads time off as missed weeks and reports
      // "at risk" on a plan the owner's own page calls "on track".
      weeklyPauses: true,
    },
  });
}

/**
 * The weekly "roll forward": re-ramp a plan's current + future targets from the
 * **last completed week's actual** volume, using the same progression engine
 * (see [computeAdaptedFutureTargets](src/lib/weekly-targets.ts)).
 *
 * Runs at most **once per training week**, on the first view of a new week
 * (guarded by `lastRecalcWeek`) — a cheap no-op on every later view that week.
 * It deliberately does NOT require the view to land on the week-start day: the
 * athlete's training week shouldn't adapt only if they happen to open the app on
 * a Monday. A single roll-forward from the last completed week also covers an
 * athlete who was away for several weeks — that week's actuals are the honest
 * baseline, and replaying the gap would compound the easing factors.
 *
 * Past weeks and the just-completed week keep their historical targets; only
 * weeks on/after the current week are rewritten, and only for disciplines that
 * produced a new ramp (no data is dropped otherwise). Weeks inside the taper are
 * never touched — see computeAdaptedFutureTargets.
 *
 * Scoped to the session user. Returns whether it recalculated.
 */
export async function maybeRecalculatePlan(planId: string): Promise<boolean> {
  return maybeRecalculatePlanForUser(await requireUserId(), planId);
}

/**
 * The roll-forward itself, for callers that already hold a trusted userId —
 * the session wrapper above, and the weekly digest cron (src/lib/digest.ts),
 * which rolls the new week forward before emailing its targets so the numbers
 * in the email are the numbers the athlete finds when they open the app.
 * Same doctrine as the rest of the data layer: the explicit userId scopes
 * every query, so a caller can never recalculate another user's plan.
 */
export async function maybeRecalculatePlanForUser(
  userId: string,
  planId: string,
): Promise<boolean> {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: planId, userId },
    select: {
      id: true,
      startDate: true,
      createdAt: true,
      eventDate: true,
      weekStartDay: true,
      capMultiple: true,
      taperWeeks: true,
      lastRecalcWeek: true,
      disciplines: { select: { discipline: true, eventDistanceMeters: true } },
      weeklyTargets: { select: { discipline: true, weekStartDate: true, targetMeters: true } },
      weeklyActuals: {
        select: { discipline: true, weekStartDate: true, actualMeters: true, source: true },
      },
      weeklyCheckins: {
        select: { weekStartDate: true, fatigue: true, sleep: true, soreness: true },
      },
      weeklyPauses: { select: { weekStartDate: true } },
    },
  });
  if (!plan) return false;

  const now = new Date();
  const currentWeekStart = startOfWeek(now, plan.weekStartDay);

  // Roll forward on the FIRST view of a new training week, whenever that lands.
  //
  // This used to also require `now.getUTCDay() === plan.weekStartDay`, which
  // quietly made the whole adaptive engine a coin flip: open the plan on Tuesday
  // and Thursday but not on Monday and that week never rolled forward — and the
  // guard below then locked it out for good, silently discarding the week's
  // actuals, check-in and Form. `lastRecalcWeek` alone is the honest question
  // ("has this week been rolled forward yet?"), and it answers it on any view.
  //
  // `>=` rather than `===` so a lastRecalcWeek somehow ahead of the current week
  // (clock skew, a restored backup) can't re-trigger the roll-forward every view.
  if (plan.lastRecalcWeek && plan.lastRecalcWeek.getTime() >= currentWeekStart.getTime()) {
    return false;
  }

  const planStart = planStartWeek(plan);
  const lastPlanWeek = startOfWeek(plan.eventDate, plan.weekStartDay);
  // Nothing to adapt before the plan has a completed week, or once it's over.
  if (currentWeekStart.getTime() <= planStart.getTime()) return false;
  if (currentWeekStart.getTime() > lastPlanWeek.getTime()) return false;

  const lastCompletedWeekStart = new Date(currentWeekStart.getTime() - WEEK_MS);

  // Skip back over any run of paused weeks (ill / injured / away) to the last
  // week actually trained — that week, not the stale target of a week spent on
  // the sofa, is what the return ramp builds from.
  const pausedWeekMs = new Set(plan.weeklyPauses.map((p) => p.weekStartDate.getTime()));
  let pausedWeeks = 0;
  let baselineWeekStart = lastCompletedWeekStart;
  while (
    pausedWeekMs.has(baselineWeekStart.getTime()) &&
    baselineWeekStart.getTime() > planStart.getTime()
  ) {
    pausedWeeks += 1;
    baselineWeekStart = new Date(baselineWeekStart.getTime() - WEEK_MS);
  }

  // Effective actual (MANUAL over STRAVA) + original target for the baseline week.
  const effective = resolveEffectiveActuals(plan.weeklyActuals);
  const targetByKey = new Map<string, number>();
  for (const t of plan.weeklyTargets) {
    targetByKey.set(effectiveActualKey(t.discipline, t.weekStartDate), t.targetMeters);
  }

  const disciplines: AdaptiveDisciplineInput[] = plan.disciplines.map((d) => {
    const key = effectiveActualKey(d.discipline, baselineWeekStart);
    return {
      discipline: d.discipline,
      eventDistanceMeters: d.eventDistanceMeters,
      lastCompletedActual: effective.get(key)?.meters ?? null,
      lastCompletedTarget: targetByKey.get(key) ?? 0,
    };
  });

  // Two easing signals, combined multiplicatively:
  //  • subjective — a fatigued/sore check-in for the week the baseline came from;
  //  • objective — the athlete's current Form (TSB) from HR training load. When
  //    Form is deep in the overreaching band, ease the ramp even if no check-in
  //    was logged, and stack with a fatigued check-in when both agree.
  //
  // The check-in is read from the BASELINE week, not the last completed one. On a
  // return from illness those differ, and reading the paused week charged the same
  // illness twice — once as returnToTrainingFactor's detraining, and again as the
  // fatigued check-in that very illness produced. The baseline week's check-in is
  // the one that describes the training the baseline is built from.
  const lastCheckin = plan.weeklyCheckins.find(
    (c) => c.weekStartDate.getTime() === baselineWeekStart.getTime(),
  );
  const checkinFactor = lastCheckin ? checkinReadinessFactor(lastCheckin) : 1;
  const formTsb = await getUserFormTsb(userId);
  const readinessFactor = checkinFactor * (formTsb != null ? formLoadFactor(formTsb) : 1);

  const newRows = computeAdaptedFutureTargets({
    disciplines,
    lastCompletedWeekStart: baselineWeekStart,
    currentWeekStart,
    eventDate: plan.eventDate,
    capMultiple: plan.capMultiple,
    taperWeeks: plan.taperWeeks,
    readinessFactor,
    pausedWeeks,
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

/**
 * Remove the MANUAL actual for one (discipline, week) — the athlete taking back
 * a manual top-up. Only the MANUAL row is touched, so any synced (Strava /
 * Garmin / Apple Health) value for that week stands untouched. Idempotent: a
 * missing manual row is a no-op, not an error.
 */
export async function deleteManualActual(input: {
  planId: string;
  discipline: Discipline;
  weekStartDate: Date;
}) {
  const userId = await requireUserId();

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: input.planId, userId },
    select: { id: true, weekStartDay: true },
  });
  if (!plan) {
    throw new NotFoundError();
  }

  const weekStartDate = startOfWeek(input.weekStartDate, plan.weekStartDay);
  await prisma.weeklyActual.deleteMany({
    where: {
      planId: plan.id,
      discipline: input.discipline,
      weekStartDate,
      source: ActualSource.MANUAL,
    },
  });
  return { ok: true };
}

/** Thrown when a submitted week of sessions is internally inconsistent. */
export class InvalidSessionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionsError";
  }
}

export interface WeekSessionInput {
  discipline: Discipline;
  slot: number;
  label: string;
  share: number;
  dayOffset: number;
  done: boolean;
}

/**
 * Replace one week's planned sessions — the week planner's single write
 * (moves and manual ticks both send the whole week; see
 * src/lib/week-planner.ts for why untouched weeks are never stored).
 *
 * The submitted week must be internally coherent: every session on one of the
 * plan's disciplines, no duplicate (discipline, slot), and each discipline's
 * shares summing to ~1 so the sessions always account for the full weekly
 * target. Manual-tick timestamps survive a move: a session keeps its original
 * completedAt as long as it stays done.
 *
 * @throws UnauthorizedError | NotFoundError | WeekOutOfRangeError | InvalidSessionsError
 */
export async function replaceWeekSessions(input: {
  planId: string;
  weekStartDate: Date;
  sessions: WeekSessionInput[];
}) {
  const userId = await requireUserId();

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: input.planId, userId },
    select: {
      id: true,
      startDate: true,
      createdAt: true,
      eventDate: true,
      weekStartDay: true,
      disciplines: { select: { discipline: true } },
    },
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

  const allowed = new Set(plan.disciplines.map((d) => d.discipline as string));
  const shareSums = new Map<string, number>();
  const seen = new Set<string>();
  for (const s of input.sessions) {
    if (!allowed.has(s.discipline)) {
      throw new InvalidSessionsError("Session discipline is not part of this plan.");
    }
    const key = `${s.discipline}|${s.slot}`;
    if (seen.has(key)) {
      throw new InvalidSessionsError("Duplicate session slot.");
    }
    seen.add(key);
    shareSums.set(s.discipline, (shareSums.get(s.discipline) ?? 0) + s.share);
  }
  for (const [discipline, sum] of shareSums) {
    if (sum < 0.98 || sum > 1.02) {
      throw new InvalidSessionsError(
        `The ${discipline.toLowerCase()} sessions must cover the whole week's target.`,
      );
    }
  }

  // Every discipline with a positive target this week must be present — a
  // partial payload would silently delete the missing discipline's sessions
  // (the replace below is week-scoped, not discipline-scoped).
  const weekTargets = await prisma.weeklyTarget.findMany({
    where: { planId: plan.id, weekStartDate },
    select: { discipline: true, targetMeters: true },
  });
  for (const t of weekTargets) {
    if (t.targetMeters > 0 && !shareSums.has(t.discipline)) {
      throw new InvalidSessionsError(
        `The week's ${t.discipline.toLowerCase()} sessions are missing.`,
      );
    }
  }

  // A session that stays done keeps its original completion timestamp.
  const previous = await prisma.plannedSession.findMany({
    where: { planId: plan.id, weekStartDate },
    select: { discipline: true, slot: true, completedAt: true },
  });
  const prevCompleted = new Map(
    previous.map((p) => [`${p.discipline}|${p.slot}`, p.completedAt] as const),
  );

  await prisma.$transaction([
    prisma.plannedSession.deleteMany({ where: { planId: plan.id, weekStartDate } }),
    prisma.plannedSession.createMany({
      data: input.sessions.map((s) => ({
        planId: plan.id,
        weekStartDate,
        discipline: s.discipline,
        slot: s.slot,
        label: s.label,
        share: s.share,
        dayOffset: s.dayOffset,
        completedAt: s.done ? (prevCompleted.get(`${s.discipline}|${s.slot}`) ?? new Date()) : null,
      })),
    }),
  ]);
}
