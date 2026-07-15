import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { buildPlanSeries } from "@/lib/plan-series";
import { computeReadiness } from "@/lib/readiness";
import { enforceRateLimit } from "@/lib/security";
import { getTrainingPlan, maybeRecalculatePlan } from "@/lib/training-plan";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

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
    await maybeRecalculatePlan(id);

    const plan = await getTrainingPlan(id);
    if (!plan) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const now = new Date();
    const series = buildPlanSeries(plan, now);
    const currentWeekMs = startOfWeek(now, plan.weekStartDay).getTime();
    // The current week's wellness check-in (if any) — same lookup as the page.
    const checkin =
      plan.weeklyCheckins.find((c) => c.weekStartDate.getTime() === currentWeekMs) ?? null;
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
        readiness: computeReadiness(series),
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
