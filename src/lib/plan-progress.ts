import { resolveEffectiveActuals, type ActualRow } from "@/lib/actuals";
import type { ProgressWeekInput } from "@/lib/progress";
import type { DisciplineKey } from "@/lib/ui/theme";

/**
 * Shape a plan's targets + (effective) actuals into the per-discipline and
 * combined-total week inputs the progress engine consumes. Shared by the
 * dashboard and the plan-detail screen so the math lives in one place.
 */
const DISCIPLINE_ORDER: DisciplineKey[] = ["SWIM", "BIKE", "RUN"];

interface PlanForProgress {
  weeklyTargets: { discipline: string; weekStartDate: Date; targetMeters: number }[];
  weeklyActuals: ActualRow[];
}

export interface PlanProgressInputs {
  weekMsList: number[];
  /** Disciplines the plan actually includes, in canonical order. */
  disciplines: DisciplineKey[];
  /** Per-discipline week inputs — only the present disciplines are populated. */
  byDiscipline: Partial<Record<DisciplineKey, ProgressWeekInput[]>>;
  total: ProgressWeekInput[];
}

export function buildPlanProgressInputs(plan: PlanForProgress): PlanProgressInputs {
  const effective = resolveEffectiveActuals(plan.weeklyActuals);
  const key = (discipline: string, ms: number) => `${discipline}|${ms}`;

  const targetByKey = new Map<string, number>();
  const presentSet = new Set<string>();
  for (const t of plan.weeklyTargets) {
    targetByKey.set(key(t.discipline, t.weekStartDate.getTime()), t.targetMeters);
    presentSet.add(t.discipline);
  }

  // Only the disciplines the plan has targets for (a run-only plan has just RUN).
  const disciplines = DISCIPLINE_ORDER.filter((d) => presentSet.has(d));

  const weekMsList = [...new Set(plan.weeklyTargets.map((t) => t.weekStartDate.getTime()))].sort(
    (a, b) => a - b,
  );

  const effectiveMeters = (discipline: string, ms: number): number | null => {
    const eff = effective.get(key(discipline, ms));
    return eff ? eff.meters : null;
  };

  const byDiscipline: Partial<Record<DisciplineKey, ProgressWeekInput[]>> = {};
  for (const d of disciplines) {
    byDiscipline[d] = weekMsList.map((ms) => ({
      weekStartDate: new Date(ms),
      target: targetByKey.get(key(d, ms)) ?? 0,
      actual: effectiveMeters(d, ms),
    }));
  }

  const total: ProgressWeekInput[] = weekMsList.map((ms) => {
    let target = 0;
    let actualSum = 0;
    let anyActual = false;
    for (const d of disciplines) {
      target += targetByKey.get(key(d, ms)) ?? 0;
      const a = effectiveMeters(d, ms);
      if (a != null) {
        actualSum += a;
        anyActual = true;
      }
    }
    return { weekStartDate: new Date(ms), target, actual: anyActual ? actualSum : null };
  });

  return { weekMsList, disciplines, byDiscipline, total };
}
