import { getLoadRows, getLoadUser, pickLoadSource } from "@/lib/load-data";
import {
  activityCountsForWeek,
  assembleWeekView,
  dayLabels,
  type DayActivityCount,
  type PlannerSessionView,
} from "@/lib/week-planner";
import { startOfWeek } from "@/lib/weekly-targets";

/**
 * Server-side assembly for the week planner — shared by the plan page, the
 * dashboard's Today card, and the mobile dashboard endpoint so the three can't
 * drift. Load rows come through the per-request cache in load-data.ts, so
 * pages that already computed training load pay nothing extra.
 */

const DAY_MS = 86_400_000;

export interface WeekPlannerView {
  /** ISO date (YYYY-MM-DD) of the week's first day — the PUT body's key. */
  weekStartDate: string;
  /** Column headings, index = dayOffset. */
  dayLabels: string[];
  /** Today's dayOffset within this week, or null when today is outside it. */
  todayOffset: number | null;
  /** The current week is marked as time off — sessions is empty, don't prescribe. */
  paused: boolean;
  sessions: PlannerSessionView[];
  /** This week's synced-activity counts — lets the board recompute auto-ticks locally. */
  activityCounts: DayActivityCount[];
}

interface PlanForPlanner {
  weekStartDay: number;
  weeklyTargets: { discipline: string; weekStartDate: Date; targetMeters: number }[];
  weeklyPauses: { weekStartDate: Date }[];
  plannedSessions: {
    discipline: string;
    slot: number;
    label: string;
    share: number;
    dayOffset: number;
    weekStartDate: Date;
    completedAt: Date | null;
  }[];
}

/** The current week's planner view for an already-loaded plan. */
export async function currentWeekPlanner(
  userId: string,
  plan: PlanForPlanner,
  now: Date,
): Promise<WeekPlannerView> {
  const weekStart = startOfWeek(now, plan.weekStartDay);
  const weekMs = weekStart.getTime();

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offset = Math.floor((today.getTime() - weekMs) / DAY_MS);
  const todayOffset = offset >= 0 && offset <= 6 ? offset : null;
  const base = {
    weekStartDate: weekStart.toISOString().slice(0, 10),
    dayLabels: dayLabels(plan.weekStartDay),
    todayOffset,
  };

  // A paused week prescribes nothing, on ANY surface — the plan page swaps in
  // the pause card, and the dashboard/mobile "today" hides via the empty list.
  if (plan.weeklyPauses.some((p) => p.weekStartDate.getTime() === weekMs)) {
    return { ...base, paused: true, sessions: [], activityCounts: [] };
  }

  const user = await getLoadUser(userId);
  const loadRows = user ? await getLoadRows(userId, pickLoadSource(user)) : [];
  const activityCounts = activityCountsForWeek(loadRows, weekMs);

  const sessions = assembleWeekView({
    weekStartMs: weekMs,
    weekStartDay: plan.weekStartDay,
    stored: plan.plannedSessions.filter((s) => s.weekStartDate.getTime() === weekMs),
    targets: plan.weeklyTargets
      .filter((t) => t.weekStartDate.getTime() === weekMs)
      .map((t) => ({ discipline: t.discipline, weekMeters: t.targetMeters })),
    loadRows,
  });

  return { ...base, paused: false, sessions, activityCounts };
}
