"use client";

import Link from "next/link";

import { ConsistencyCard } from "@/app/(app)/plans/[id]/consistency-card";
import { VolumeChart } from "@/app/(app)/plans/[id]/charts";
import { ReadinessPanel } from "@/app/(app)/plans/[id]/readiness-panel";
import type { Heatmap } from "@/lib/heatmap";
import type { SeriesData } from "@/lib/plan-series";
import type { PlanReadiness } from "@/lib/readiness";

function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Public, read-only rendering of a shared plan — no editing controls, no auth.
 * Reuses the presentational readiness / consistency / chart pieces.
 */
export function SharedPlanView({
  planName,
  eventDateMs,
  startDateMs,
  series,
  readiness,
  heatmap,
}: {
  planName: string;
  eventDateMs: number;
  startDateMs: number;
  series: SeriesData[];
  readiness: PlanReadiness;
  heatmap: Heatmap;
}) {
  return (
    <div className="mx-auto max-w-[1000px] px-5 py-8">
      <div className="mb-1 font-mono text-[12px] tracking-[0.14em] text-brand uppercase">
        Shared plan · read-only
      </div>
      <h1 className="m-0 font-display text-[30px] font-black tracking-[-0.025em]">{planName}</h1>
      <div className="mt-1.5 mb-6 font-mono text-[12.5px] text-faint">
        {fullDate(startDateMs)} → race day {fullDate(eventDateMs)}
      </div>

      <ReadinessPanel readiness={readiness} />
      <ConsistencyCard heatmap={heatmap} />

      {series.map((s) => (
        <div key={s.key} className="mb-[18px] rounded-[18px] border border-border bg-card p-[22px]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="m-0 font-display text-[16px] font-bold">{s.label} — weekly volume</h3>
            <span className="font-mono text-[12px] text-faint">
              {s.summary.pctOfTarget ?? 0}% to date
            </span>
          </div>
          <VolumeChart
            rows={s.weeks.map((w) => ({ weekStartMs: w.ms, target: w.target, actual: w.actual }))}
            currentIndex={s.weeks.findIndex((w) => w.phase === "current")}
            color={s.color}
            unit={s.unit}
            startVol={s.startVol}
            labelOf={shortDate}
          />
        </div>
      ))}

      <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted">
        Made with{" "}
        <Link href="/" className="font-bold text-brand">
          TriTrainer
        </Link>
        .
      </div>
    </div>
  );
}
