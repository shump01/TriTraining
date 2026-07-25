import Link from "next/link";

import { auth } from "@/auth";
import { SeasonTimeline, toSeasonPlans } from "@/components/season-timeline";
import { displayNameFor } from "@/lib/display-name";
import { rankLivePlans } from "@/lib/featured-plan";
import { buildPlanSeries } from "@/lib/plan-series";
import { currentWeekPlanner } from "@/lib/planner-data";
import { balancedPct } from "@/lib/total-pct";
import type { PlannerSessionView } from "@/lib/week-planner";

import { MiniCaption, MiniPct } from "./mini-pct";
import { computeReadiness, type ReadinessStatus } from "@/lib/readiness";
import { getStravaConnectionSummary } from "@/lib/strava/connection";
import {
  getTrainingPlan,
  listRecentActuals,
  listTrainingPlansWithProgress,
  maybeRecalculatePlan,
} from "@/lib/training-plan";
import {
  DISCIPLINE_META,
  STATUS_META,
  formatDistance,
  translucent,
  type DisciplineKey,
} from "@/lib/ui/theme";

import { OtherPlans } from "./other-plans";
import { StravaCard } from "./strava-card";
import "./home.css";

export const dynamic = "force-dynamic";

/** The hero card's accent bar follows the featured plan's priority. */
const PRIORITY_ACCENT: Record<string, string> = {
  A: "var(--run)",
  B: "var(--bike)",
  C: "var(--swim)",
};

// Compact readiness chip text/color, reusing the plan status palette.
const READINESS_TEXT: Record<Exclude<ReadinessStatus, "insufficient">, string> = {
  ahead: "Ahead",
  onTrack: "On track",
  atRisk: "At risk",
};
const READINESS_COLOR: Record<Exclude<ReadinessStatus, "insufficient">, string> = {
  ahead: STATUS_META.ahead.color,
  onTrack: STATUS_META.onTrack.color,
  atRisk: STATUS_META.behind.color,
};

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const session = await auth();
  const name = displayNameFor(session?.user ?? {});
  const userId = session!.user.id;

  const now = new Date();
  // One query for every plan + its progress — the strip and the season bars are
  // served from it, so listing them costs no extra round trips.
  const plans = await listTrainingPlansWithProgress();
  // Live plans, best first: the goal race leads, then whatever else is running.
  const [active, ...others] = rankLivePlans(
    plans.map((p) => ({ ...p, eventMs: p.eventDate.getTime(), startMs: p.startDateMs })),
    now.getTime(),
  );

  const strava = await getStravaConnectionSummary(userId);
  const recent = await listRecentActuals(4);

  // Per-discipline + total "% of target" for the featured plan. The TOTAL
  // entry also carries the balanced (equal-weight) figure so the client mini
  // can honor the athlete's Total-% preference.
  let minis: {
    key: string;
    label: string;
    color: string;
    pct: number;
    pctBalanced?: number | null;
  }[] = [];
  let readinessChip: { label: string; color: string } | null = null;
  // Today's sessions from the featured plan's week board.
  let todaySessions: PlannerSessionView[] = [];
  let todayRestDay = false;
  if (active) {
    // Roll the week forward first (same as the plan page), so today's session
    // distances reflect the re-ramped targets, not last week's.
    await maybeRecalculatePlan(active.id);
    const full = await getTrainingPlan(active.id);
    if (full) {
      const planner = await currentWeekPlanner(userId, full, now);
      if (planner.todayOffset != null && !planner.paused) {
        todaySessions = planner.sessions.filter((s) => s.dayOffset === planner.todayOffset);
        todayRestDay = planner.sessions.length > 0 && todaySessions.length === 0;
      }
      // One source of truth for both the minis and the readiness chip. Series
      // already omits TOTAL for single-sport plans and honors the week-start day.
      const series = buildPlanSeries(full, now);
      const { overall } = computeReadiness(series);
      if (overall && overall.status !== "insufficient") {
        const unit = overall.basis === "projection" ? "of peak" : "so far";
        readinessChip = {
          label: `${READINESS_TEXT[overall.status]} · ${overall.pct}% ${unit}`,
          color: READINESS_COLOR[overall.status],
        };
      }
      // Each mini shows the CURRENT week's % (matches the plan-detail cards).
      // Every series shares the same week list, so one index fits all.
      const wi = series[0]!.weeks.findIndex((w) => w.phase === "current");
      const curIndex = wi >= 0 ? wi : series[0]!.summary.finished ? series[0]!.weeks.length - 1 : 0;
      minis = series.map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        pct: s.weeks[curIndex]?.pctOfTarget ?? 0,
        pctBalanced:
          s.key === "TOTAL"
            ? balancedPct(
                series
                  .filter((d) => d.key !== "TOTAL")
                  .map((d) => d.weeks[curIndex]?.pctOfTarget ?? null),
              )
            : undefined,
      }));
    }
  }

  return (
    <div className="homepage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap">
        <div
          className="mb-[30px] flex flex-wrap items-end justify-between gap-4 rise"
          style={{ animationDelay: "0.05s" }}
        >
          <div>
            <span className="eyebrow">
              <span className="pulse" />
              <span className="mono">
                {now.toLocaleDateString("en-US", { weekday: "long" })} · {shortDate(now)}
              </span>
            </span>
            <h1 className="hp-h1">
              Welcome back,
              <br />
              <em>{name}.</em>
            </h1>
          </div>
          <Link href="/plans/new" className="btn">
            <span>+ New plan</span>
          </Link>
        </div>

        <div className="grid gap-[18px] app:grid-cols-[1.6fr_1fr]">
          {active ? (
            <Link
              href={`/plans/${active.id}`}
              className="hero-card rise"
              style={
                {
                  "--accent": PRIORITY_ACCENT[active.priority] ?? "var(--ink-faint)",
                  animationDelay: "0.12s",
                } as React.CSSProperties
              }
            >
              <div className="mb-[18px] flex items-start justify-between gap-4">
                <div>
                  <div className="mono" style={{ fontSize: 11, marginBottom: 8, display: "block" }}>
                    {others.length > 0 ? "Your focus" : "Active plan"}
                  </div>
                  <div className="flex items-center gap-2.5">
                    {others.length > 0 && (
                      <span className="chip" title={`Priority ${active.priority}`}>
                        {active.priority}
                      </span>
                    )}
                    <div className="hero-name">{active.name}</div>
                  </div>
                  {readinessChip && (
                    <span
                      className="mt-2.5 inline-block rounded-[20px] px-[10px] py-1 text-[11.5px] font-bold"
                      style={{
                        color: readinessChip.color,
                        background: translucent(readinessChip.color, 14),
                      }}
                    >
                      {readinessChip.label}
                    </span>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="hero-count">{active.weeksToGo}</div>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em" }}>
                    weeks to go
                  </div>
                </div>
              </div>
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${minis.length}, minmax(0, 1fr))` }}
              >
                {minis.map((m) => (
                  <div key={m.key} className="mini">
                    <div
                      className="mono"
                      style={{ fontSize: 10, letterSpacing: "0.14em", color: m.color }}
                    >
                      {m.label}
                    </div>
                    <div className="pct" style={{ marginTop: 7 }}>
                      <MiniPct pct={m.pct} pctBalanced={m.pctBalanced} />
                    </div>
                    <div className="mt-[3px] text-[11px] text-faint">
                      <MiniCaption hasBalanced={m.pctBalanced != null} />
                    </div>
                  </div>
                ))}
              </div>
            </Link>
          ) : (
            <div
              className="hero-card rise flex flex-col items-start justify-center"
              style={
                { "--accent": "var(--ink-faint)", animationDelay: "0.12s" } as React.CSSProperties
              }
            >
              <div className="hero-name">
                {plans.length > 0 ? "No plan in progress" : "No active plan yet"}
              </div>
              <p className="mt-2 mb-5 max-w-[46ch] text-[14px] leading-[1.55] text-muted">
                {plans.length > 0
                  ? "Every race on your calendar has been and gone. Set the next one and we'll build the weeks back up to it."
                  : "Create a plan and we'll build progressive weekly targets to race day."}
              </p>
              <div className="flex flex-wrap gap-2.5">
                <Link href="/plans/new" className="btn">
                  <span>+ New plan</span>
                </Link>
                {plans.length > 0 && (
                  <Link href="/plans" className="btn ghost">
                    <span>Past plans</span>
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="rise" style={{ animationDelay: "0.18s" }}>
            <StravaCard
              connection={
                strava ? { lastSyncedAt: strava.lastSyncedAt?.toISOString() ?? null } : null
              }
            />
          </div>
        </div>

        {active && (todaySessions.length > 0 || todayRestDay) && (
          <div className="mt-[18px] rise" style={{ animationDelay: "0.22s" }}>
            <Link
              href={`/plans/${active.id}`}
              className="block rounded-[16px] border border-border bg-card p-5 transition-colors hover:border-brand"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="font-display text-[15px] font-bold text-text">Today</span>
                <span className="font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                  plan your week →
                </span>
              </div>
              {todayRestDay && (
                <p className="m-0 text-[13.5px] text-muted">
                  Rest day — nothing scheduled. Recovery is training too.
                </p>
              )}
              <div className="flex flex-wrap gap-2.5">
                {todaySessions.map((s) => {
                  const meta = DISCIPLINE_META[s.discipline as DisciplineKey];
                  const complete = s.done || s.auto;
                  return (
                    <span
                      key={`${s.discipline}|${s.slot}`}
                      className="inline-flex items-center gap-2 rounded-[11px] border border-border bg-bg2 px-3 py-2"
                      style={{ borderLeft: `3px solid ${meta?.color ?? "var(--brand)"}` }}
                    >
                      <span
                        className={`text-[13px] font-semibold ${
                          complete ? "text-muted line-through" : "text-text"
                        }`}
                      >
                        {s.label}
                      </span>
                      <span className="font-mono text-[12px] text-muted">
                        {formatDistance(s.meters, s.discipline as DisciplineKey)}
                      </span>
                      {complete && (
                        <span
                          className="font-mono text-[10.5px] font-bold"
                          style={{ color: "var(--on-track)" }}
                        >
                          ✓
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </Link>
          </div>
        )}

        {/* Both of these render nothing for a single-plan athlete: the strip is
            empty, and the timeline hides itself below two plans. The shared
            components stay untouched — the token overrides re-skin them. */}
        <div className="rise" style={{ animationDelay: "0.24s" }}>
          <OtherPlans plans={others} />
        </div>
        <div className="mt-[30px] rise" style={{ animationDelay: "0.24s" }}>
          <SeasonTimeline plans={toSeasonPlans(plans)} nowMs={now.getTime()} />
        </div>

        <div className="rise" style={{ animationDelay: "0.3s" }}>
          <h2 className="section-label">Recent activity</h2>
          <div className="overflow-hidden rounded-[16px] border border-border bg-card">
            {recent.length === 0 ? (
              <div className="p-[18px] text-[14px] text-muted">
                No activity logged yet — sync Strava or enter actuals on a plan.
              </div>
            ) : (
              recent.map((a, i) => {
                const d = a.discipline as DisciplineKey;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3.5 border-b border-border px-[18px] py-3.5 last:border-b-0"
                  >
                    <div
                      className="grid h-9 w-9 place-items-center rounded-[9px] text-base"
                      style={{ background: translucent(DISCIPLINE_META[d].color, 16) }}
                    >
                      {DISCIPLINE_META[d].icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-[14.5px] font-bold">
                        {DISCIPLINE_META[d].label} · week of {shortDate(a.weekStartDate)}
                      </div>
                      <div className="text-[12.5px] text-faint">
                        {a.plan.name} ·{" "}
                        {a.source === "MANUAL"
                          ? "manual entry"
                          : a.source === "APPLE_HEALTH"
                            ? "Apple Health"
                            : a.source === "GARMIN"
                              ? "Garmin"
                              : "Strava"}
                      </div>
                    </div>
                    <div className="font-display text-[16px] font-extrabold">
                      {formatDistance(a.actualMeters, d)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
