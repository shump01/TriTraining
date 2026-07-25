import type { SeriesData } from "@/lib/plan-series";
import { classifyRatio } from "@/lib/progress";

/**
 * Two ways to read the TOTAL percentage of a multi-sport week:
 *
 * - "distance" (the default, and how the series is built): total actual meters
 *   over total target meters. Honest about volume, but a big-volume sport
 *   dominates — with bike at 80% of the week's meters, finishing swim and run
 *   barely moves the number.
 * - "balanced": every discipline counts equally — the mean of the per-sport
 *   percentages, each CAPPED at 100. Swim 100% + run 100% + bike 0% reads 67%,
 *   whatever the distances; over-running one sport can never mask skipping
 *   another (that's the cap, and the point of the mode).
 *
 * Display-only: the adaptive engine, readiness projection, weekly digest
 * email (and its streak line), the shared public page, and every stored
 * number stay distance-based — deliberately, since none of them can see this
 * client-side preference. The preference lives in localStorage (see
 * useTotalPctMode) — like the theme, it never reaches the server. Surfaces
 * that CAN see it (plan page, plans list, dashboard Total mini) all honor it.
 */

export type TotalPctMode = "distance" | "balanced";

export const TOTAL_PCT_STORAGE_KEY = "tt-total-pct-mode";

export function isTotalPctMode(v: unknown): v is TotalPctMode {
  return v === "distance" || v === "balanced";
}

/**
 * Equal-weight percentage: mean of the given per-discipline percentages, each
 * capped at 100, rounded. Nulls (no target that week / future weeks) are
 * excluded rather than counted as zero; all-null → null.
 */
export function balancedPct(pcts: (number | null)[]): number | null {
  const usable = pcts.filter((p): p is number => p != null);
  if (usable.length === 0) return null;
  const sum = usable.reduce((acc, p) => acc + Math.min(p, 100), 0);
  return Math.round(sum / usable.length);
}

/**
 * Re-express the TOTAL series' percentages (and their status banding) under
 * the chosen mode. Distance mode — and any plan without a TOTAL series —
 * returns the input untouched. Meters (bars, cumulative distances) are real
 * distances in both modes; only pct + status are re-derived, using the same
 * thresholds as the distance series (classifyRatio). Note the cap means
 * "ahead" (>110%) is unreachable in balanced mode — you can complete a
 * balanced week, not overshoot it.
 */
export function applyTotalPctMode(series: SeriesData[], mode: TotalPctMode): SeriesData[] {
  if (mode !== "balanced") return series;
  const total = series.find((s) => s.key === "TOTAL");
  const disciplines = series.filter((s) => s.key !== "TOTAL");
  if (!total || disciplines.length < 2) return series;

  const weeks = total.weeks.map((w, i) => {
    const pct = balancedPct(disciplines.map((d) => d.weeks[i]?.pctOfTarget ?? null));
    // Future weeks keep their null; a computed week keeps its banding coherent
    // with the displayed number.
    if (w.phase === "future" || pct == null) {
      return { ...w, pctOfTarget: pct != null && w.phase !== "future" ? pct : w.pctOfTarget };
    }
    return { ...w, pctOfTarget: pct, status: classifyRatio(pct / 100) };
  });

  const summaryPct = balancedPct(disciplines.map((d) => d.summary.pctOfTarget));
  const summary =
    summaryPct == null
      ? total.summary
      : { ...total.summary, pctOfTarget: summaryPct, status: classifyRatio(summaryPct / 100) };

  return series.map((s) => (s.key === "TOTAL" ? { ...s, weeks, summary } : s));
}
