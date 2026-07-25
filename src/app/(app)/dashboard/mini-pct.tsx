"use client";

import { useTotalPctMode } from "../use-total-pct-mode";

/**
 * The hero card's percentage figure. For the Total mini it respects the
 * athlete's Total-% preference (set on the plan page): distance-weighted or
 * balanced. Discipline minis pass no pctBalanced and always show their own
 * number. Server-renders the distance value, so hydration is stable.
 */
export function MiniPct({ pct, pctBalanced }: { pct: number; pctBalanced?: number | null }) {
  const [mode] = useTotalPctMode();
  const value = mode === "balanced" && pctBalanced != null ? pctBalanced : pct;
  return (
    <>
      {value}
      <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>%</span>
    </>
  );
}

/**
 * The caption under a mini: "of target" for distance figures, "balanced" when
 * the Total mini is showing the equal-weight number — the label must never
 * claim a balanced figure is meters ÷ meters.
 */
export function MiniCaption({ hasBalanced }: { hasBalanced: boolean }) {
  const [mode] = useTotalPctMode();
  return <>{hasBalanced && mode === "balanced" ? "balanced" : "of target"}</>;
}
