import {
  effectiveActualKey,
  resolveEffectiveActuals,
  type ActualRow,
  type ActualSource,
} from "@/lib/actuals";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { computeProgress, type ProgressWeekInput } from "@/lib/progress";

/**
 * Shape a plan's targets + effective actuals into the per-series (TOTAL + one
 * per discipline) chart/table data the plan-detail views render. Extracted from
 * the plan page so the web page and the mobile JSON endpoint share it.
 */

export type SeriesKey = "TOTAL" | "SWIM" | "BIKE" | "RUN";

export interface WeekRow {
  ms: number;
  dateStr: string; // YYYY-MM-DD — used for actual writes (matches server)
  target: number;
  actual: number | null;
  phase: "past" | "current" | "future";
  pctOfTarget: number | null;
  status: "ahead" | "onTrack" | "behind" | null;
  cumulativeActual: number;
  cumulativeTarget: number;
  manualMeters: number | null;
  effectiveSource: ActualSource | null;
}

export interface SeriesData {
  key: SeriesKey;
  label: string;
  color: string;
  unit: "m" | "km";
  startVol: number | null;
  weeks: WeekRow[];
  summary: {
    started: boolean;
    finished: boolean;
    cumulativeActual: number;
    cumulativeTarget: number;
    pctOfTarget: number | null;
    status: "ahead" | "onTrack" | "behind" | null;
  };
}

const KEY_META: Record<SeriesKey, { label: string; color: string; unit: "m" | "km" }> = {
  TOTAL: { label: "Total", color: "var(--brand)", unit: "km" },
  SWIM: { label: "Swim", color: "var(--swim)", unit: "m" },
  BIKE: { label: "Bike", color: "var(--bike)", unit: "km" },
  RUN: { label: "Run", color: "var(--run)", unit: "km" },
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface PlanForSeries {
  weekStartDay: number;
  disciplines: { discipline: string; startingWeeklyMeters: number }[];
  weeklyTargets: { discipline: string; weekStartDate: Date; targetMeters: number }[];
  weeklyActuals: ActualRow[];
}

/** Ordered series: [TOTAL?, ...present disciplines]. TOTAL only for multi-sport plans. */
export function buildPlanSeries(plan: PlanForSeries, now: Date): SeriesData[] {
  const inputs = buildPlanProgressInputs(plan);
  const effective = resolveEffectiveActuals(plan.weeklyActuals);

  const manualByKey = new Map<string, number>();
  for (const a of plan.weeklyActuals) {
    if (a.source === "MANUAL") {
      manualByKey.set(effectiveActualKey(a.discipline, a.weekStartDate), a.actualMeters);
    }
  }

  const startByDisc = new Map<string, number>();
  for (const d of plan.disciplines) {
    startByDisc.set(d.discipline, d.startingWeeklyMeters);
  }
  const totalStart =
    (startByDisc.get("SWIM") ?? 0) + (startByDisc.get("BIKE") ?? 0) + (startByDisc.get("RUN") ?? 0);

  function buildSeries(
    key: SeriesKey,
    progressInputs: ProgressWeekInput[],
    startVol: number | null,
  ): SeriesData {
    const prog = computeProgress(progressInputs, now, plan.weekStartDay);
    const weeks: WeekRow[] = prog.weeks.map((w) => {
      const k = key === "TOTAL" ? null : effectiveActualKey(key, w.weekStartDate);
      const eff = k ? effective.get(k) : undefined;
      return {
        ms: w.weekStartDate.getTime(),
        dateStr: isoDate(w.weekStartDate),
        target: w.target,
        actual: w.actual,
        phase: w.phase,
        pctOfTarget: w.pctOfTarget,
        status: w.status,
        cumulativeActual: w.cumulativeActual,
        cumulativeTarget: w.cumulativeTarget,
        manualMeters: k ? (manualByKey.get(k) ?? null) : null,
        effectiveSource: eff ? eff.source : null,
      };
    });
    return { key, ...KEY_META[key], startVol, weeks, summary: prog.summary };
  }

  // Only the disciplines the plan includes; TOTAL is added solely for multi-sport
  // plans (for a single sport it would duplicate that sport's series).
  const present = inputs.disciplines;
  const series: SeriesData[] = [];
  if (present.length > 1) {
    series.push(buildSeries("TOTAL", inputs.total, totalStart));
  }
  for (const d of present) {
    series.push(buildSeries(d, inputs.byDiscipline[d] ?? [], startByDisc.get(d) ?? null));
  }
  return series;
}
