import { type ActualRow } from "@/lib/actuals";
import { buildHeatmap } from "@/lib/heatmap";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { computeProgress } from "@/lib/progress";
import { DEFAULT_WEEK_START_DAY } from "@/lib/weekly-targets";
import { DISCIPLINE_META, type DisciplineKey } from "@/lib/ui/theme";

/**
 * High-level, per-sport progress shared within a group. Deliberately narrow: only
 * the current week's % of target per discipline — never raw targets/actuals.
 */
export interface MemberDisciplineStat {
  key: DisciplineKey;
  label: string;
  color: string;
  /** Current week's % of target, or null when there is no current week (plan not started / finished). */
  pct: number | null;
}

/** The minimal plan shape needed to compute the shared stat. */
export interface PlanForStats {
  weeklyTargets: { discipline: string; weekStartDate: Date; targetMeters: number }[];
  weeklyActuals: ActualRow[];
  /** Pause DATES only — reasons are health data and never leave the owner. */
  weeklyPauses: { weekStartDate: Date }[];
  weekStartDay?: number;
}

/**
 * Per-discipline **current-week** % of target for one plan — the only thing a
 * group exposes about a member. Pure: no DB/session. Only the disciplines the
 * plan actually includes are returned.
 */
export function buildMemberDisciplineStats(plan: PlanForStats, now: Date): MemberDisciplineStat[] {
  const inputs = buildPlanProgressInputs(plan);
  const weekStartDay = plan.weekStartDay ?? DEFAULT_WEEK_START_DAY;

  return inputs.disciplines.map((d: DisciplineKey) => {
    const prog = computeProgress(inputs.byDiscipline[d] ?? [], now, weekStartDay);
    const current = prog.weeks.find((w) => w.phase === "current");
    const meta = DISCIPLINE_META[d];
    return { key: d, label: meta.label, color: meta.color, pct: current?.pctOfTarget ?? null };
  });
}

/**
 * The whole-plan weekly standing a group shares — the basis of the group's
 * weekly ranking. Percentages only, like the per-sport stats: never targets
 * or actuals, and never a pause reason.
 */
export interface MemberWeekStat {
  /** Current week's % of the combined target; null with no current week or when it's time off. */
  weekPct: number | null;
  /** The completed week before it; null when it doesn't exist or was time off. */
  lastWeekPct: number | null;
  /** Consecutive completed, non-paused weeks on target, ending last week. */
  streak: number;
}

export function buildMemberWeekStats(plan: PlanForStats, now: Date): MemberWeekStat {
  const inputs = buildPlanProgressInputs(plan);
  const weekStartDay = plan.weekStartDay ?? DEFAULT_WEEK_START_DAY;
  const prog = computeProgress(inputs.total, now, weekStartDay);
  const paused = (i: number) => Boolean(inputs.total[i]?.paused);
  const currentIdx = prog.weeks.findIndex((w) => w.phase === "current");
  const current = currentIdx >= 0 ? prog.weeks[currentIdx] : undefined;
  const last = currentIdx > 0 ? prog.weeks[currentIdx - 1] : undefined;
  const heat = buildHeatmap(
    prog.weeks.map((w, i) => ({
      ms: w.weekStartDate.getTime(),
      phase: w.phase,
      pctOfTarget: w.pctOfTarget,
      status: w.status,
      paused: paused(i),
    })),
  );
  return {
    weekPct: current && !paused(currentIdx) ? current.pctOfTarget : null,
    lastWeekPct: last && !paused(currentIdx - 1) ? last.pctOfTarget : null,
    streak: heat.currentStreak,
  };
}

/**
 * Competition ranking by a percent (1, 2, 2, 4): members at the same percent
 * share a rank; members without one (null — no such week, or time off) are
 * unranked. Returns a map keyed by the input objects so callers can attach
 * the rank without caring about ordering.
 */
export function rankByPct<T>(members: T[], pct: (m: T) => number | null): Map<T, number | null> {
  const ranks = new Map<T, number | null>();
  for (const m of members) ranks.set(m, null);
  const ranked = members
    .filter((m) => pct(m) != null)
    .sort((a, b) => (pct(b) ?? 0) - (pct(a) ?? 0));
  ranked.forEach((m, i) => {
    const prev = ranked[i - 1];
    const tied = prev !== undefined && pct(prev) === pct(m);
    ranks.set(m, tied ? (ranks.get(prev) ?? i + 1) : i + 1);
  });
  return ranks;
}
