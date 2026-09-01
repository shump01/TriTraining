import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { getTrainingLoad } from "@/lib/load-data";
import { buildPlanSeries } from "@/lib/plan-series";
import { allWeeksPlanner } from "@/lib/planner-data";
import { computeFormReadiness, computeReadiness } from "@/lib/readiness";
import { enforceRateLimit } from "@/lib/security";
import { getTrainingPlan, maybeRecalculatePlan, requireUserId } from "@/lib/training-plan";
import { planStartWeek, startOfWeek, trainingPhaseForWeek } from "@/lib/weekly-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/plans/:id — JSON mirror of the plan-detail page: plan meta +
 * the per-series week data (src/lib/plan-series.ts). Runs the same weekly
 * roll-forward trigger as the page so mobile views keep plans adaptive.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  const { id } = await params;

  try {
    const userId = await requireUserId();
    await maybeRecalculatePlan(id);

    const plan = await getTrainingPlan(id);
    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    const series = buildPlanSeries(plan, now);
    const currentWeekMs = startOfWeek(now, plan.weekStartDay).getTime();

    // Week-pager feed: a structural phase label per week (index-aligned with
    // every series' weeks) and each week's prescribed sessions. Both additive —
    // old app binaries parse them away via `.optional()`.
    const weeks = series[0]?.weeks ?? [];
    const weekPhases = weeks.map((_, i) =>
      trainingPhaseForWeek(i, weeks.length, plan.taperWeeks),
    );
    const weekSessions = await allWeeksPlanner(
      userId,
      plan,
      weeks.map((w) => new Date(w.ms)),
    );
    // The current week's wellness check-in (if any) — same lookup as the page.
    const checkin =
      plan.weeklyCheckins.find((c) => c.weekStartDate.getTime() === currentWeekMs) ?? null;

    // Objective Form (TSB) + subjective cross-check, mirroring the web plan page.
    const load = await getTrainingLoad();
    const form = load.summary ? computeFormReadiness(load.summary.form, checkin) : null;

    return NextResponse.json(
      {
        plan: {
          id: plan.id,
          name: plan.name,
          weekStartDay: plan.weekStartDay,
          capMultiple: plan.capMultiple,
          taperWeeks: plan.taperWeeks,
          priority: plan.priority,
          shareToken: plan.shareToken,
          eventDateMs: plan.eventDate.getTime(),
          startDateMs: planStartWeek(plan).getTime(),
          currentWeekMs,
          disciplines: plan.disciplines.map((d) => ({
            discipline: d.discipline,
            startingWeeklyMeters: d.startingWeeklyMeters,
            eventDistanceMeters: d.eventDistanceMeters,
          })),
        },
        series,
        weekPhases,
        weekSessions,
        readiness: computeReadiness(series),
        form: form && {
          tsb: form.tsb,
          status: form.status,
          label: form.label,
          eases: form.eases,
          note: form.note,
        },
        checkin: checkin && {
          fatigue: checkin.fatigue,
          sleep: checkin.sleep,
          soreness: checkin.soreness,
          note: checkin.note,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/plans/[id]" });
  }
}
