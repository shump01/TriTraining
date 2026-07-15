import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { buildPlanSeries } from "@/lib/plan-series";
import { prisma } from "@/lib/prisma";
import { computeReadiness, type SeriesReadiness } from "@/lib/readiness";
import { enforceRateLimit } from "@/lib/security";
import { getStravaConnectionSummary } from "@/lib/strava/connection";
import {
  getTrainingPlan,
  listRecentActuals,
  listTrainingPlans,
  requireUserId,
} from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GET /api/mobile/dashboard — JSON mirror of the dashboard page's server data
 * (src/app/(app)/dashboard/page.tsx): active-plan card, per-discipline minis,
 * Strava status, recent actuals. Colors are omitted; the app maps them by key.
 */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  try {
    const userId = await requireUserId();
    const now = new Date();

    const [user, plans, strava, recent] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      listTrainingPlans(),
      getStravaConnectionSummary(userId),
      listRecentActuals(4),
    ]);

    // The dashboard's active-plan rule: nearest upcoming event, else most recent.
    const active =
      plans.find((p) => p.eventDate.getTime() >= now.getTime()) ?? plans.at(-1) ?? null;

    let activePlan: {
      id: string;
      name: string;
      eventDate: Date;
      weeksToGo: number;
      minis: { key: string; label: string; pct: number }[];
      readiness: SeriesReadiness | null;
    } | null = null;

    if (active) {
      const full = await getTrainingPlan(active.id);
      let minis: { key: string; label: string; pct: number }[] = [];
      let readiness: SeriesReadiness | null = null;
      if (full) {
        // One source of truth with the web dashboard: the series drives both
        // the readiness chip and the minis, which show the CURRENT week's %.
        const series = buildPlanSeries(full, now);
        readiness = computeReadiness(series).overall;
        minis = series.map((s) => {
          const i = s.weeks.findIndex((w) => w.phase === "current");
          const curIndex = i >= 0 ? i : s.summary.finished ? s.weeks.length - 1 : 0;
          return { key: s.key, label: s.label, pct: s.weeks[curIndex]?.pctOfTarget ?? 0 };
        });
      }
      activePlan = {
        id: active.id,
        name: active.name,
        eventDate: active.eventDate,
        weeksToGo: Math.max(0, Math.ceil((active.eventDate.getTime() - now.getTime()) / WEEK_MS)),
        minis,
        readiness,
      };
    }

    return NextResponse.json(
      {
        user: { email: user?.email ?? null },
        activePlan,
        strava: strava
          ? { connected: true, lastSyncedAt: strava.lastSyncedAt }
          : { connected: false, lastSyncedAt: null },
        recentActuals: recent.map((a) => ({
          discipline: a.discipline,
          weekStartDate: a.weekStartDate,
          actualMeters: a.actualMeters,
          source: a.source,
          planName: a.plan.name,
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/dashboard" });
  }
}
