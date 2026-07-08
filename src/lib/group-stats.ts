import { type ActualRow } from "@/lib/actuals";
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
