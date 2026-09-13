import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { pickFeaturedPlan } from "@/lib/featured-plan";
import { getGroupMemberStats, listMyGroups } from "@/lib/groups";
import { buildPlanSeries } from "@/lib/plan-series";
import { currentWeekPlanner } from "@/lib/planner-data";
import { prisma } from "@/lib/prisma";
import { computeReadiness, type SeriesReadiness } from "@/lib/readiness";
import { balancedPct } from "@/lib/total-pct";
import { enforceRateLimit } from "@/lib/security";
import { getStravaConnectionSummary } from "@/lib/strava/connection";
import {
  getTrainingPlan,
  listRecentActuals,
  listTrainingPlans,
  maybeRecalculatePlan,
  requireUserId,
} from "@/lib/training-plan";
import { planStartWeek } from "@/lib/weekly-targets";

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
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          name: true,
          viewMode: true,
          // Only their presence is reported — never the hash itself.
          passwordHash: true,
          accounts: { select: { provider: true } },
        },
      }),
      listTrainingPlans(),
      getStravaConnectionSummary(userId),
      listRecentActuals(4),
    ]);

    // The same featured-plan rule the web dashboard uses (goal race first), from
    // the shared pure module so the two can't drift. Null once every race has
    // passed — the app shouldn't show a finished plan as active.
    const active = pickFeaturedPlan(
      plans.map((p) => ({
        ...p,
        eventMs: p.eventDate.getTime(),
        startMs: planStartWeek(p).getTime(),
      })),
      now.getTime(),
    );

    type Mini = {
      key: string;
      label: string;
      pct: number;
      /** TOTAL only: the equal-weight % (each sport 1/N, capped at 100). */
      pctBalanced?: number | null;
      actualMeters: number;
      targetMeters: number;
    };
    type TodaySession = { discipline: string; label: string; meters: number; done: boolean };
    type UpcomingWeek = {
      /** YYYY-MM-DD UTC week start — same convention as the series' dateStr. */
      weekStart: string;
      paused: boolean;
      minis: { key: string; label: string; targetMeters: number }[];
    };
    let activePlan: {
      id: string;
      name: string;
      eventDate: Date;
      weeksToGo: number;
      minis: Mini[];
      /** Week-brief feed: the current week plus up to the next three. */
      upcomingWeeks: UpcomingWeek[];
      readiness: SeriesReadiness | null;
      /** Today's sessions from the week planner (empty outside plan weeks). */
      today: TodaySession[];
      /** True when today is an in-plan, unpaused day with no sessions. */
      todayRestDay: boolean;
    } | null = null;
    // The current and the finished week's starts, in the same YYYY-MM-DD form
    // as the upcomingWeeks feed — the group standings below are stamped with
    // them so the app can match "the week this rank describes" by identity.
    let currentWeekStart: string | null = null;
    let lastWeekStart: string | null = null;

    if (active) {
      // Roll the week forward first (same as the plan page), so today's
      // session distances reflect the re-ramped targets.
      await maybeRecalculatePlan(active.id);
      const full = await getTrainingPlan(active.id);
      let minis: Mini[] = [];
      let upcomingWeeks: UpcomingWeek[] = [];
      let readiness: SeriesReadiness | null = null;
      let today: TodaySession[] = [];
      let todayRestDay = false;
      if (full) {
        const planner = await currentWeekPlanner(userId, full, now);
        if (planner.todayOffset != null && !planner.paused) {
          today = planner.sessions
            .filter((s) => s.dayOffset === planner.todayOffset)
            .map((s) => ({
              discipline: s.discipline,
              label: s.label,
              meters: s.meters,
              done: s.done || s.auto,
            }));
          todayRestDay = planner.sessions.length > 0 && today.length === 0;
        }
        // One source of truth with the web dashboard: the series drives both
        // the readiness chip and the minis, which show the CURRENT week's %.
        const series = buildPlanSeries(full, now);
        readiness = computeReadiness(series).overall;
        // Every series shares the same week list, so one index fits all. The
        // guard covers a plan with no target rows at all (series === []) —
        // not producible by today's write paths, which regenerate targets in
        // the same transaction, but a `!` here turned that data state into a
        // 500 for the whole dashboard.
        const first = series[0];
        const wi = first ? first.weeks.findIndex((w) => w.phase === "current") : -1;
        const curIndex = wi >= 0 ? wi : first?.summary.finished ? first.weeks.length - 1 : 0;
        minis = series.map((s) => {
          const week = s.weeks[curIndex];
          return {
            key: s.key,
            label: s.label,
            pct: week?.pctOfTarget ?? 0,
            // TOTAL also carries the equal-weight figure so the app can offer
            // the same distance/balanced choice the web dashboard has.
            pctBalanced:
              s.key === "TOTAL"
                ? balancedPct(
                    series
                      .filter((d) => d.key !== "TOTAL")
                      .map((d) => d.weeks[curIndex]?.pctOfTarget ?? null),
                  )
                : undefined,
            // Raw meters so clients (the watch complication) can show
            // distance done / remaining, not just the percentage.
            actualMeters: week?.actual ?? 0,
            targetMeters: week?.target ?? 0,
          };
        });
        // Week-brief feed: the current week plus the next three, targets only.
        // The current week is INCLUDED so the app can keep a brief scheduled
        // whose fire time is still ahead — a pre-dawn background sync on brief
        // day must not cancel that morning's notification. When the plan
        // hasn't started yet there is no "current" row, so start at week 1;
        // a finished plan feeds nothing.
        const rows = first ? first.weeks : [];
        const upcomingStart = wi >= 0 ? wi : first?.summary.finished ? rows.length : 0;
        currentWeekStart = wi >= 0 ? (rows[wi]?.dateStr ?? null) : null;
        lastWeekStart = wi > 0 ? (rows[wi - 1]?.dateStr ?? null) : null;
        upcomingWeeks = rows.slice(upcomingStart, upcomingStart + 4).map((row, i) => {
          const idx = upcomingStart + i;
          return {
            weekStart: row.dateStr,
            paused: row.paused,
            minis: series
              .filter((s) => s.key !== "TOTAL")
              .map((s) => ({
                key: s.key,
                label: s.label,
                targetMeters: s.weeks[idx]?.target ?? 0,
              })),
          };
        });
      }
      activePlan = {
        id: active.id,
        name: active.name,
        eventDate: active.eventDate,
        weeksToGo: Math.max(0, Math.ceil((active.eventDate.getTime() - now.getTime()) / WEEK_MS)),
        minis,
        upcomingWeeks,
        readiness,
        today,
        todayRestDay,
      };
    }

    // The requester's standing in each of their groups — the week brief's
    // closing line ("You finished 2nd of 6 in Dawn Patrol."). One entry per
    // group per week that can be ranked: the CURRENT week (near-final by
    // Sunday evening) and the FINISHED week (final). The app matches by
    // weekStart, so it finds a line whichever side of the rollover a re-lay
    // lands on — the server's week rolls at UTC midnight, hours before or
    // after the athlete's own Monday. `rankedCount` counts the members ranked
    // THAT week, not the roster. Best-effort: a group that fails to compute
    // must never sink the dashboard.
    const groupStandings: {
      groupId: string;
      name: string;
      weekStart: string;
      rank: number;
      rankedCount: number;
      pct: number | null;
    }[] = [];
    try {
      for (const g of await listMyGroups()) {
        const stats = await getGroupMemberStats(g.id);
        const me = stats.find((s) => s.userId === userId);
        if (!me) continue;
        if (currentWeekStart && me.rank != null) {
          groupStandings.push({
            groupId: g.id,
            name: g.name,
            weekStart: currentWeekStart,
            rank: me.rank,
            rankedCount: stats.filter((s) => s.weekPct != null).length,
            pct: me.weekPct,
          });
        }
        if (lastWeekStart && me.lastRank != null) {
          groupStandings.push({
            groupId: g.id,
            name: g.name,
            weekStart: lastWeekStart,
            rank: me.lastRank,
            rankedCount: stats.filter((s) => s.lastWeekPct != null).length,
            pct: me.lastWeekPct,
          });
        }
      }
    } catch {
      // Standings are a garnish on the dashboard, never a reason to 500 it.
    }

    return NextResponse.json(
      {
        user: {
          email: user?.email ?? null,
          name: user?.name ?? null,
          // Plan-view density preference; the app gates its Settings toggle on
          // this field's presence (old-server BC pattern).
          viewMode: user?.viewMode ?? "DETAILED",
          // How this account signs in: Settings hides "change password" for a
          // provider-only account and names the provider instead.
          hasPassword: Boolean(user?.passwordHash),
          providers: user?.accounts.map((a) => a.provider) ?? [],
        },
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
        groupStandings,
      },
      { status: 200 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/dashboard" });
  }
}
