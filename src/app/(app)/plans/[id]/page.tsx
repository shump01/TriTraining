import Link from "next/link";
import { notFound } from "next/navigation";

import { effectiveActualKey, resolveEffectiveActuals } from "@/lib/actuals";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { computeProgress, type ProgressWeekInput } from "@/lib/progress";
import { getTrainingPlan } from "@/lib/training-plan";
import { planStartMonday, startOfWeekMonday } from "@/lib/weekly-targets";

import { DeletePlanButton } from "./delete-plan-button";
import { PlanDashboard, type SeriesData, type SeriesKey, type WeekRow } from "./plan-dashboard";

export const dynamic = "force-dynamic";

const KEY_META: Record<SeriesKey, { label: string; color: string; unit: "m" | "km" }> = {
  TOTAL: { label: "Total", color: "var(--brand)", unit: "km" },
  SWIM: { label: "Swim", color: "var(--swim)", unit: "m" },
  BIKE: { label: "Bike", color: "var(--bike)", unit: "km" },
  RUN: { label: "Run", color: "var(--run)", unit: "km" },
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Scoped to the session user — another user's id returns null → 404.
  const plan = await getTrainingPlan(id);
  if (!plan) {
    notFound();
  }

  const now = new Date();
  const currentWeekMs = startOfWeekMonday(now).getTime();
  const startMonday = planStartMonday(plan);

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
    const prog = computeProgress(progressInputs, now);
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

  return (
    <>
      <PlanDashboard
        planId={plan.id}
        planName={plan.name}
        eventDateMs={plan.eventDate.getTime()}
        startDateMs={startMonday.getTime()}
        currentWeekMs={currentWeekMs}
        series={series}
      />

      <div className="mt-8 flex max-w-[1100px] flex-wrap items-center gap-3 border-t border-border pt-5">
        <Link
          href={`/plans/${plan.id}/edit`}
          className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-text hover:border-brand"
        >
          Edit plan
        </Link>
        <DeletePlanButton planId={plan.id} planName={plan.name} />
      </div>
    </>
  );
}
