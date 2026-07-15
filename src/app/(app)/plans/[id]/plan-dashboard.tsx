"use client";

import Link from "next/link";
import { useState } from "react";

import { buildHeatmap } from "@/lib/heatmap";
import type { PlanReadiness } from "@/lib/readiness";
import type { SeriesData, SeriesKey, WeekRow } from "@/lib/plan-series";
import { STATUS_META, formatDistance, translucent, type StatusKey } from "@/lib/ui/theme";

import { ActualCell } from "./actual-cell";
import { ProgressRing, Sparkline, VolumeChart, type WeekDatum } from "./charts";
import { ConsistencyCard } from "./consistency-card";
import { ReadinessPanel } from "./readiness-panel";
import { SessionsCard } from "./sessions-card";

export interface PlanDashboardProps {
  planId: string;
  planName: string;
  eventDateMs: number;
  startDateMs: number;
  currentWeekMs: number;
  /** Ordered tabs to show: [TOTAL?, ...present disciplines]. TOTAL is omitted for single-sport plans. */
  series: SeriesData[];
  /** Race-day projection derived from the same series. */
  readiness: PlanReadiness;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function summaryStatusKey(s: SeriesData["summary"]): StatusKey {
  return s.started ? (s.status ?? "onTrack") : "upcoming";
}
function weekStatusKey(w: WeekRow): StatusKey {
  return w.phase === "future" ? "upcoming" : (w.status ?? "onTrack");
}
function toData(s: SeriesData): WeekDatum[] {
  return s.weeks.map((w) => ({ weekStartMs: w.ms, target: w.target, actual: w.actual }));
}

function StatusPill({ statusKey, small }: { statusKey: StatusKey; small?: boolean }) {
  const meta = STATUS_META[statusKey];
  return (
    <span
      className={`rounded-[20px] font-bold ${small ? "px-2 py-0.5 text-[10.5px]" : "px-[10px] py-1 text-[12px]"}`}
      style={{ color: meta.color, background: translucent(meta.color, 14) }}
    >
      {meta.label}
    </span>
  );
}

export function PlanDashboard({
  planId,
  planName,
  eventDateMs,
  startDateMs,
  currentWeekMs,
  series,
  readiness,
}: PlanDashboardProps) {
  const [active, setActive] = useState<SeriesKey>(series[0]?.key ?? "TOTAL");
  const [variation, setVariation] = useState<"command" | "timeline">("command");

  const activeData = series.find((s) => s.key === active) ?? series[0]!;
  const n = activeData.weeks.length;
  const currentIndex = activeData.weeks.findIndex((w) => w.phase === "current");
  const weekNumber = currentIndex >= 0 ? currentIndex + 1 : activeData.summary.finished ? n : 0;
  const weeksToGo = Math.max(0, Math.ceil((eventDateMs - currentWeekMs) / WEEK_MS));

  // The week the mobile "this week" strip tracks: the current week, or week 1
  // before the plan starts / the final week once it's finished.
  const buildWeekIndex = currentIndex >= 0 ? currentIndex : activeData.summary.finished ? n - 1 : 0;
  const buildWeek = activeData.weeks[buildWeekIndex];

  return (
    <div className="max-w-[1100px]">
      <Link href="/plans" className="text-[13.5px] text-muted hover:text-text">
        ← All plans
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="m-0 font-display text-[30px] font-black tracking-[-0.025em]">
              {planName}
            </h1>
            <StatusPill statusKey={summaryStatusKey(activeData.summary)} />
          </div>
          <div className="mt-1.5 font-mono text-[12.5px] text-faint">
            Started {fullDate(startDateMs)} · Race day {fullDate(eventDateMs)} ·{" "}
            {weekNumber > 0 ? `Week ${weekNumber} of ${n}` : `${n} weeks`} · {weeksToGo} weeks out
          </div>
        </div>

        <div className="flex gap-1 rounded-[11px] border border-border bg-bg2 p-1">
          {(["command", "timeline"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariation(v)}
              className={`cursor-pointer rounded-[8px] px-3.5 py-2 text-[13px] font-bold ${
                variation === v ? "bg-brand text-white" : "text-muted hover:text-text"
              }`}
            >
              {v === "command" ? "Command" : "Timeline"}
            </button>
          ))}
        </div>
      </div>

      <ReadinessPanel readiness={readiness} />

      <ConsistencyCard heatmap={buildHeatmap(series[0]?.weeks ?? [])} />

      {/* Sticky "this week" strip — mobile only (desktop shows the ring / rail). */}
      <div className="sticky top-[56px] z-30 mb-3 -mx-[14px] border-b border-border bg-bg2/95 px-[14px] py-[9px] backdrop-blur-[10px] app:hidden">
        <div className="flex items-center gap-2.5">
          <span
            className="shrink-0 font-display text-[13px] font-extrabold"
            style={{ color: activeData.color }}
          >
            {weekNumber > 0 ? `W${weekNumber}` : "W1"}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-[6px] bg-card2">
            <div
              className="h-full rounded-[6px]"
              style={{
                width: `${Math.min(buildWeek?.pctOfTarget ?? 0, 100)}%`,
                background: activeData.color,
              }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11.5px] text-muted">
            {formatDistance(buildWeek?.actual ?? 0, active)} /{" "}
            {formatDistance(buildWeek?.target ?? 0, active)}
          </span>
        </div>
      </div>

      {series.length > 1 && (
        <div className="mb-6 -mx-[14px] flex gap-2 overflow-x-auto px-[14px] [scrollbar-width:none] app:mx-0 app:flex-wrap app:px-0">
          {series.map((s) => {
            const on = active === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActive(s.key)}
                className={`shrink-0 cursor-pointer rounded-[10px] px-3.5 py-2 text-[13.5px] font-bold whitespace-nowrap ${
                  on ? "" : "text-muted hover:text-text"
                }`}
                style={on ? { color: s.color, background: translucent(s.color, 14) } : undefined}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {variation === "command" ? (
        <CommandView
          series={series}
          active={active}
          setActive={setActive}
          currentIndex={currentIndex}
          planId={planId}
        />
      ) : (
        <TimelineView data={activeData} currentIndex={currentIndex} weeksToGo={weeksToGo} />
      )}
    </div>
  );
}

function CommandView({
  series,
  active,
  setActive,
  currentIndex,
  planId,
}: {
  series: SeriesData[];
  active: SeriesKey;
  setActive: (k: SeriesKey) => void;
  currentIndex: number;
  planId: string;
}) {
  const data = series.find((s) => s.key === active) ?? series[0]!;
  const editable = active !== "TOTAL";
  // "This build": the current week's own progress, not the plan-to-date total.
  // Before the plan starts, show week 1 (nothing done yet); once finished, show
  // the final week.
  const buildWeekIndex =
    currentIndex >= 0 ? currentIndex : data.summary.finished ? data.weeks.length - 1 : 0;
  const buildWeek = data.weeks[buildWeekIndex];

  // Mobile condensed table: which week's row is expanded to reveal its input.
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <>
      <div className="mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        {series.map((s) => {
          const k = s.key;
          // Show the CURRENT week's own progress, not the plan-to-date total.
          // Before the plan starts, show week 1; once finished, the final week.
          const curIndex =
            currentIndex >= 0 ? currentIndex : s.summary.finished ? s.weeks.length - 1 : 0;
          const cur = s.weeks[curIndex];
          const pct = cur?.pctOfTarget ?? 0;
          const on = active === k;
          const sparkIndex = currentIndex >= 0 ? currentIndex : s.weeks.length - 1;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setActive(k)}
              className="cursor-pointer rounded-[16px] border bg-card p-[18px] text-left"
              style={{ borderColor: on ? s.color : "var(--border)" }}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span
                  className="text-[12px] font-bold tracking-[0.05em] uppercase"
                  style={{ color: s.color }}
                >
                  {s.label}
                </span>
                <StatusPill statusKey={cur ? weekStatusKey(cur) : "upcoming"} small />
              </div>
              <div className="font-display text-[30px] leading-none font-black">
                {pct}
                <span className="text-[16px] font-bold text-muted">%</span>
              </div>
              <div className="mt-1 mb-2.5 text-[11.5px] text-faint">
                {formatDistance(cur?.actual ?? 0, k)} / {formatDistance(cur?.target ?? 0, k)}
              </div>
              <div className="h-[34px]">
                <Sparkline rows={toData(s)} color={s.color} currentIndex={sparkIndex} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-[18px] app:grid-cols-[1fr_260px]">
        <div className="rounded-[18px] border border-border bg-card p-[22px]">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="m-0 font-display text-[16px] font-bold">Weekly volume — {data.label}</h3>
            <span className="font-mono text-[12px] text-faint">target vs actual</span>
          </div>
          <VolumeChart
            rows={toData(data)}
            currentIndex={currentIndex}
            color={data.color}
            unit={data.unit}
            startVol={data.startVol}
            labelOf={shortDate}
          />
        </div>
        <div className="hidden flex-col items-center justify-center rounded-[18px] border border-border bg-card p-[22px] app:flex">
          <div className="mb-3 text-[12px] font-bold tracking-[0.05em] text-muted uppercase">
            This build
          </div>
          <ProgressRing pct={buildWeek?.pctOfTarget ?? 0} color={data.color} size={170} />
          <div className="mt-3 text-center text-[12.5px] text-muted">
            {formatDistance(buildWeek?.actual ?? 0, active)} of{" "}
            {formatDistance(buildWeek?.target ?? 0, active)}
          </div>
        </div>
      </div>

      {active !== "TOTAL" && buildWeek && (
        <SessionsCard discipline={active} weekMeters={buildWeek.target} color={data.color} />
      )}

      <div className="mt-[18px] hidden overflow-hidden rounded-[16px] border border-border bg-card app:block">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="text-left text-[12px] tracking-[0.04em] text-faint uppercase">
              <th className="px-[18px] py-3 font-semibold">Week</th>
              <th className="px-[18px] py-3 font-semibold">Target</th>
              <th className="px-[18px] py-3 font-semibold">Actual</th>
              <th className="px-[18px] py-3 font-semibold">%</th>
              <th className="px-[18px] py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((w, i) => (
              <tr
                key={w.ms}
                className="border-t border-border"
                style={
                  w.phase === "current" ? { background: translucent(data.color, 7) } : undefined
                }
              >
                <td className="px-[18px] py-3">
                  <span className="font-bold">W{i + 1}</span>{" "}
                  <span className="font-mono text-[12px] text-faint">{shortDate(w.ms)}</span>
                </td>
                <td className="px-[18px] py-3 font-mono">{formatDistance(w.target, active)}</td>
                <td className="px-[18px] py-3">
                  {editable ? (
                    <ActualCell
                      planId={planId}
                      discipline={active}
                      weekStartDate={w.dateStr}
                      manualMeters={w.manualMeters}
                      effective={
                        w.effectiveSource
                          ? { meters: w.actual ?? 0, source: w.effectiveSource }
                          : null
                      }
                    />
                  ) : w.effectiveSource || w.phase !== "future" ? (
                    <span className="font-mono">{formatDistance(w.actual ?? 0, active)}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="px-[18px] py-3 font-mono">
                  {w.pctOfTarget == null ? "—" : `${w.pctOfTarget}%`}
                </td>
                <td className="px-[18px] py-3">
                  <StatusPill statusKey={weekStatusKey(w)} small />
                  {w.phase === "current" && (
                    <span className="ml-1.5 font-mono text-[11px] text-faint">now</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile condensed table — tap a week to reveal its actual-entry input. */}
      <div className="mt-[18px] overflow-hidden rounded-[16px] border border-border bg-card app:hidden">
        <div className="grid grid-cols-[78px_1fr_52px_26px] text-[10.5px] tracking-[0.04em] text-faint uppercase">
          <div className="py-[9px] pr-1.5 pl-[14px] font-semibold">Week</div>
          <div className="px-1.5 py-[9px] font-semibold">Actual / target</div>
          <div className="px-1.5 py-[9px] text-right font-semibold">%</div>
          <div />
        </div>
        {data.weeks.map((w, i) => {
          const open = expanded === w.ms;
          const statusKey = weekStatusKey(w);
          return (
            <div
              key={w.ms}
              className="border-t border-border"
              style={w.phase === "current" ? { background: translucent(data.color, 7) } : undefined}
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : w.ms)}
                className="grid min-h-[44px] w-full cursor-pointer grid-cols-[78px_1fr_52px_26px] items-center text-left"
              >
                <div className="py-2.5 pl-[14px]">
                  <div className="text-[13.5px] font-bold">W{i + 1}</div>
                  <div className="font-mono text-[10.5px] text-faint">{shortDate(w.ms)}</div>
                </div>
                <div className="px-1.5 py-2.5 font-mono text-[12px]">
                  {w.phase === "future" ? "—" : formatDistance(w.actual ?? 0, active)}
                  <span className="text-faint"> / {formatDistance(w.target, active)}</span>
                </div>
                <div className="px-1.5 py-2.5 text-right font-mono text-[12px]">
                  {w.pctOfTarget == null ? "—" : `${w.pctOfTarget}%`}
                </div>
                <div className="grid place-items-center">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: STATUS_META[statusKey].color }}
                    title={STATUS_META[statusKey].label}
                  />
                </div>
              </button>
              {open && (
                <div className="border-t border-border px-[14px] py-[11px]">
                  {editable ? (
                    <ActualCell
                      planId={planId}
                      discipline={active}
                      weekStartDate={w.dateStr}
                      manualMeters={w.manualMeters}
                      effective={
                        w.effectiveSource
                          ? { meters: w.actual ?? 0, source: w.effectiveSource }
                          : null
                      }
                    />
                  ) : (
                    <div className="text-[12px] text-muted">
                      Totals combine all sports — switch to a sport to log actuals.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TimelineView({
  data,
  currentIndex,
  weeksToGo,
}: {
  data: SeriesData;
  currentIndex: number;
  weeksToGo: number;
}) {
  const currentWeek = currentIndex >= 0 ? data.weeks[currentIndex] : null;

  return (
    <div className="grid gap-[18px] app:grid-cols-[280px_1fr]">
      <div className="hidden flex-col gap-4 self-start app:flex app:sticky app:top-6">
        <div className="flex flex-col items-center rounded-[18px] border border-border bg-card p-[22px]">
          <ProgressRing pct={data.summary.pctOfTarget ?? 0} color={data.color} size={180} />
          <div className="mt-3 text-center text-[13px] text-muted">
            {formatDistance(data.summary.cumulativeActual, data.key)} of{" "}
            {formatDistance(data.summary.cumulativeTarget, data.key)}
          </div>
        </div>

        <div className="rounded-[18px] border border-border bg-card p-[22px]">
          <div className="mb-2.5 text-[12px] font-bold tracking-[0.05em] text-muted uppercase">
            This week
          </div>
          {currentWeek ? (
            <>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="font-display text-[20px] font-extrabold">
                  {formatDistance(currentWeek.actual ?? 0, data.key)}
                </span>
                <span className="text-[12.5px] text-muted">
                  / {formatDistance(currentWeek.target, data.key)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-[6px] bg-card2">
                <div
                  className="h-full rounded-[6px]"
                  style={{
                    width: `${Math.min(currentWeek.pctOfTarget ?? 0, 100)}%`,
                    background: data.color,
                  }}
                />
              </div>
            </>
          ) : (
            <div className="text-[13px] text-muted">
              {data.summary.finished ? "Plan complete." : `Starts soon — ${weeksToGo} weeks out.`}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {data.weeks.map((w, i) => {
          const pct = w.pctOfTarget;
          return (
            <div
              key={w.ms}
              className="flex items-center gap-4 rounded-[14px] border bg-card px-[18px] py-3.5"
              style={
                w.phase === "current"
                  ? { borderColor: data.color }
                  : { borderColor: "var(--border)" }
              }
            >
              <div className="w-[70px] shrink-0">
                <div className="font-display text-[15px] font-extrabold">W{i + 1}</div>
                <div className="font-mono text-[11.5px] text-faint">{shortDate(w.ms)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[13px]">
                    {w.phase === "future" ? "—" : formatDistance(w.actual ?? 0, data.key)}
                    <span className="text-faint"> / {formatDistance(w.target, data.key)}</span>
                  </span>
                  <StatusPill statusKey={weekStatusKey(w)} small />
                </div>
                <div className="h-1.5 overflow-hidden rounded-[6px] bg-card2">
                  <div
                    className="h-full rounded-[6px]"
                    style={{
                      width: `${Math.min(pct ?? 0, 100)}%`,
                      background: w.phase === "future" ? "var(--border)" : data.color,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
