"use client";

import { useTotalPctMode } from "../use-total-pct-mode";

/**
 * A plan card's progress bar + caption, honoring the Total-% display mode set
 * on the plan page — one click apart, the list and the plan must agree on the
 * same number. Single-sport plans pass no pctBalanced and always show their
 * distance figure. Server-renders the distance value (mode server snapshot),
 * so hydration is stable.
 */
export function PlanCardPct({
  pct,
  pctBalanced,
  weeksToGo,
}: {
  /** Null when the engine declined to compute one (every week so far paused). */
  pct: number | null;
  pctBalanced: number | null;
  weeksToGo: number;
}) {
  const [mode] = useTotalPctMode();
  const balanced = mode === "balanced" && pctBalanced != null;
  const value = balanced ? pctBalanced : pct;

  return (
    <>
      <div className="mb-2.5 h-2 overflow-hidden rounded-[6px] bg-card2">
        <div
          className="h-full rounded-[6px] bg-brand"
          style={{ width: `${Math.min(value ?? 0, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[12.5px] text-muted">
        <span>
          {/* "—", not a fabricated 0%: an all-paused season has no percentage,
              and "On track · 0% of target" reads as a contradiction. */}
          {value == null ? "—" : `${value}% ${balanced ? "balanced" : "of target"}`}
        </span>
        <span>{weeksToGo} wks to go</span>
      </div>
    </>
  );
}
