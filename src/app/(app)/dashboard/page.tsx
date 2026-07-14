import Link from "next/link";

import { auth } from "@/auth";
import { buildPlanProgressInputs } from "@/lib/plan-progress";
import { buildPlanSeries } from "@/lib/plan-series";
import { computeProgress } from "@/lib/progress";
import { computeReadiness, type ReadinessStatus } from "@/lib/readiness";
import { getStravaConnectionSummary } from "@/lib/strava/connection";
import { getTrainingPlan, listRecentActuals, listTrainingPlans } from "@/lib/training-plan";
import {
  DISCIPLINE_META,
  STATUS_META,
  formatDistance,
  translucent,
  type DisciplineKey,
} from "@/lib/ui/theme";

import { StravaCard } from "./strava-card";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
function displayName(email: string): string {
  const local = email.split("@")[0] || "Athlete";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default async function DashboardPage() {
  const session = await auth();
  const name = displayName(session?.user?.email ?? "");
  const userId = session!.user.id;

  const now = new Date();
  const plans = await listTrainingPlans();
  const active = plans.find((p) => p.eventDate.getTime() >= now.getTime()) ?? plans.at(-1) ?? null;

  const strava = await getStravaConnectionSummary(userId);
  const recent = await listRecentActuals(4);

  // Per-discipline + total "% of target" for the active plan.
  let minis: { key: string; label: string; color: string; pct: number }[] = [];
  let weeksToGo = 0;
  let readinessChip: { label: string; color: string } | null = null;
  if (active) {
    const full = await getTrainingPlan(active.id);
    if (full) {
      const inputs = buildPlanProgressInputs(full);
      const { overall } = computeReadiness(buildPlanSeries(full, now));
      if (overall && overall.status !== "insufficient") {
        const unit = overall.basis === "projection" ? "of peak" : "so far";
        readinessChip = {
          label: `${READINESS_TEXT[overall.status]} · ${overall.pct}% ${unit}`,
          color: READINESS_COLOR[overall.status],
        };
      }
      const discMinis = inputs.disciplines.map((d) => ({
        key: d as string,
        label: DISCIPLINE_META[d].label,
        color: DISCIPLINE_META[d].color,
        pct: computeProgress(inputs.byDiscipline[d] ?? [], now).summary.pctOfTarget ?? 0,
      }));
      // TOTAL only adds value for multi-sport plans.
      minis =
        inputs.disciplines.length > 1
          ? [
              {
                key: "TOTAL",
                label: "Total",
                color: "var(--brand)",
                pct: computeProgress(inputs.total, now).summary.pctOfTarget ?? 0,
              },
              ...discMinis,
            ]
          : discMinis;
    }
    weeksToGo = Math.max(0, Math.ceil((active.eventDate.getTime() - now.getTime()) / WEEK_MS));
  }

  return (
    <div>
      <div className="mb-[26px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 font-mono text-[12px] tracking-[0.16em] text-faint uppercase">
            {now.toLocaleDateString("en-US", { weekday: "long" })} · {shortDate(now)}
          </div>
          <h1 className="m-0 font-display text-[34px] font-black tracking-[-0.025em]">
            Welcome back, {name}
          </h1>
        </div>
        <Link
          href="/plans/new"
          className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14.5px] font-bold text-white hover:brightness-110"
        >
          + New plan
        </Link>
      </div>

      <div className="grid gap-[18px] app:grid-cols-[1.6fr_1fr]">
        {active ? (
          <Link
            href={`/plans/${active.id}`}
            className="relative overflow-hidden rounded-[18px] border border-border bg-card p-6 hover:border-brand"
          >
            <div className="mb-[18px] flex items-center justify-between">
              <div>
                <div className="mb-1.5 font-mono text-[11px] tracking-[0.14em] text-brand uppercase">
                  Active plan
                </div>
                <div className="font-display text-[23px] font-extrabold tracking-[-0.02em]">
                  {active.name}
                </div>
                {readinessChip && (
                  <span
                    className="mt-2 inline-block rounded-[20px] px-[10px] py-1 text-[11.5px] font-bold"
                    style={{
                      color: readinessChip.color,
                      background: translucent(readinessChip.color, 14),
                    }}
                  >
                    {readinessChip.label}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="font-display text-[30px] leading-none font-black">{weeksToGo}</div>
                <div className="text-[12px] text-muted">weeks to go</div>
              </div>
            </div>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${minis.length}, minmax(0, 1fr))` }}
            >
              {minis.map((m) => (
                <div key={m.key} className="rounded-[12px] bg-card2 p-[13px]">
                  <div
                    className="mb-[7px] text-[11px] font-bold tracking-[0.05em] uppercase"
                    style={{ color: m.color }}
                  >
                    {m.label}
                  </div>
                  <div className="font-display text-[19px] leading-none font-extrabold">
                    {m.pct}%
                  </div>
                  <div className="mt-[3px] text-[11.5px] text-muted">of target</div>
                </div>
              ))}
            </div>
          </Link>
        ) : (
          <div className="flex flex-col items-start justify-center rounded-[18px] border border-border bg-card p-6">
            <div className="font-display text-[20px] font-extrabold">No active plan yet</div>
            <p className="mt-1 mb-4 text-[14px] text-muted">
              Create a plan and we&apos;ll build progressive weekly targets to race day.
            </p>
            <Link
              href="/plans/new"
              className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14.5px] font-bold text-white hover:brightness-110"
            >
              + New plan
            </Link>
          </div>
        )}

        <StravaCard
          connection={strava ? { lastSyncedAt: strava.lastSyncedAt?.toISOString() ?? null } : null}
        />
      </div>

      <h2 className="mt-[30px] mb-3.5 font-display text-[16px] font-bold text-muted">
        Recent activity
      </h2>
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
  );
}
