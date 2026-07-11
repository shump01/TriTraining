import Link from "next/link";
import { notFound } from "next/navigation";

import { buildPlanSeries } from "@/lib/plan-series";
import { getTrainingPlan, maybeRecalculatePlan } from "@/lib/training-plan";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { DeletePlanButton } from "./delete-plan-button";
import { PlanDashboard } from "./plan-dashboard";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Weekly roll-forward: if today is the plan's week-start day, re-ramp the
  // future weeks from last week's actual. A cheap no-op on any other day.
  await maybeRecalculatePlan(id);

  // Scoped to the session user — another user's id returns null → 404.
  const plan = await getTrainingPlan(id);
  if (!plan) {
    notFound();
  }

  const now = new Date();
  const currentWeekMs = startOfWeek(now, plan.weekStartDay).getTime();
  const startWeek = planStartWeek(plan);
  const series = buildPlanSeries(plan, now);

  return (
    <>
      <PlanDashboard
        planId={plan.id}
        planName={plan.name}
        eventDateMs={plan.eventDate.getTime()}
        startDateMs={startWeek.getTime()}
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
