import Link from "next/link";
import { notFound } from "next/navigation";

import { getTrainingLoad } from "@/lib/load-data";
import { buildPlanSeries } from "@/lib/plan-series";
import { currentWeekPlanner } from "@/lib/planner-data";
import { computeFormReadiness, computeReadiness } from "@/lib/readiness";
import { getTrainingPlan, maybeRecalculatePlan, requireUserId } from "@/lib/training-plan";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

import { CheckinCard } from "./checkin-card";
import { DeletePlanButton } from "./delete-plan-button";
import { PauseCard, type PauseReasonKey } from "./pause-card";
import { PlanDashboard } from "./plan-dashboard";
import { SharePlanButton } from "./share-plan-button";
import { WeekPlannerCard } from "./week-planner-card";

import "../../surface.css";

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
  const readiness = computeReadiness(series);

  // The check-in only makes sense during an in-progress week of the plan.
  const isActiveWeek = series.some((s) => s.weeks.some((w) => w.phase === "current"));
  const currentCheckin = plan.weeklyCheckins.find(
    (c) => c.weekStartDate.getTime() === currentWeekMs,
  );
  const currentPause = plan.weeklyPauses.find((p) => p.weekStartDate.getTime() === currentWeekMs);

  // Objective Form (TSB) from HR training load, cross-checked against this week's
  // check-in. Null until the athlete has set an LTHR and synced HR activities.
  const load = await getTrainingLoad();
  const formSignal = load.summary
    ? computeFormReadiness(load.summary.form, currentCheckin ?? null)
    : null;

  // The week board — only meaningful during an active, unpaused week.
  const planner =
    isActiveWeek && !currentPause
      ? await currentWeekPlanner(await requireUserId(), plan, now)
      : null;

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap">
        <PlanDashboard
          planId={plan.id}
          planName={plan.name}
          eventDateMs={plan.eventDate.getTime()}
          startDateMs={startWeek.getTime()}
          currentWeekMs={currentWeekMs}
          series={series}
          readiness={readiness}
          formSignal={formSignal}
          hasPlanner={!!planner && planner.sessions.length > 0}
        />

        {planner && planner.sessions.length > 0 && (
          <WeekPlannerCard
            planId={plan.id}
            weekStartDate={planner.weekStartDate}
            dayLabels={planner.dayLabels}
            todayOffset={planner.todayOffset}
            activityCounts={planner.activityCounts}
            initial={planner.sessions}
          />
        )}

        {/* A paused week has nothing to rate — the pause card replaces the check-in. */}
        {isActiveWeek && !currentPause && (
          <CheckinCard
            planId={plan.id}
            weekStartDate={new Date(currentWeekMs).toISOString().slice(0, 10)}
            initial={
              currentCheckin
                ? {
                    fatigue: currentCheckin.fatigue,
                    sleep: currentCheckin.sleep,
                    soreness: currentCheckin.soreness,
                    note: currentCheckin.note,
                  }
                : null
            }
          />
        )}

        {isActiveWeek && (
          <PauseCard
            planId={plan.id}
            weekStartDate={new Date(currentWeekMs).toISOString().slice(0, 10)}
            initial={
              currentPause
                ? { reason: currentPause.reason as PauseReasonKey, note: currentPause.note }
                : null
            }
          />
        )}

        <div className="mt-8 flex max-w-[1100px] flex-wrap items-center gap-3 border-t border-border pt-5">
          <Link
            href={`/plans/${plan.id}/edit`}
            className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-text hover:border-brand"
          >
            Edit plan
          </Link>
          <DeletePlanButton planId={plan.id} planName={plan.name} />
          <div className="ml-auto">
            <SharePlanButton planId={plan.id} initialToken={plan.shareToken} />
          </div>
        </div>
      </div>
    </div>
  );
}
