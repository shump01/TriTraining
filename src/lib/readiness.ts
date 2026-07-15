import { checkinReadinessFactor, type Wellness } from "@/lib/checkin";
import { formLoadFactor, formStatus, type FormStatus } from "@/lib/training-load";
import { linearTrend, trendAt, type TrendPoint } from "@/lib/trend";

/**
 * Race-readiness projection. Turns a plan's target-vs-actual weeks into a
 * forward-looking answer: **will you arrive at your planned peak, and if not,
 * what to do?** Pure — no DB / framework — so it's shared by the plan page, the
 * dashboard, and the mobile endpoints, and is easily unit-tested.
 *
 * While the athlete is still building toward the peak week, we fit an OLS trend
 * through the completed weeks' actual volume and extrapolate to the peak week;
 * `pct` is the projected % of that peak. Once the peak is reached (the taper) or
 * the plan is over, there's nothing left to project, so we report adherence
 * to date instead (`basis: "toDate"`).
 */

// Mirror the thresholds used for weekly status in src/lib/progress.ts.
const BEHIND_RATIO = 0.9; // < 90% of target → at risk
const AHEAD_RATIO = 1.1; // > 110% → ahead
// Need at least this many completed weeks before a trend projection is meaningful.
const MIN_TREND_POINTS = 2;

export type ReadinessStatus = "ahead" | "onTrack" | "atRisk" | "insufficient";
/** Whether `pct` is a projection to the peak week, or adherence accrued to date. */
export type ReadinessBasis = "projection" | "toDate";

export type ReadinessSeriesKey = "TOTAL" | "SWIM" | "BIKE" | "RUN";

/** Minimal per-series input — structurally satisfied by SeriesData from plan-series. */
export interface ReadinessSeriesInput {
  key: ReadinessSeriesKey;
  label: string;
  weeks: {
    target: number;
    /** Effective actual (MANUAL over synced), or null for future weeks. */
    actual: number | null;
    phase: "past" | "current" | "future";
  }[];
}

export interface SeriesReadiness {
  key: ReadinessSeriesKey;
  label: string;
  status: ReadinessStatus;
  basis: ReadinessBasis;
  /** % of peak (projection) or % of plan-to-date (toDate). Null when insufficient. */
  pct: number | null;
  /** Whole-meter weekly increase suggested to close a projected shortfall (else null). */
  recommendedPerWeekMeters: number | null;
  /** Weeks from now to the peak week (projection only). */
  weeksToPeak: number | null;
}

export interface PlanReadiness {
  /** TOTAL for multi-sport plans; the sole discipline for single-sport plans. */
  overall: SeriesReadiness | null;
  /** Per-discipline readiness (never includes TOTAL). */
  disciplines: SeriesReadiness[];
}

function classify(ratio: number): Exclude<ReadinessStatus, "insufficient"> {
  if (ratio > AHEAD_RATIO) return "ahead";
  if (ratio < BEHIND_RATIO) return "atRisk";
  return "onTrack";
}

function computeSeriesReadiness(s: ReadinessSeriesInput): SeriesReadiness {
  const base = { key: s.key, label: s.label } as const;
  const insufficient: SeriesReadiness = {
    ...base,
    status: "insufficient",
    basis: "projection",
    pct: null,
    recommendedPerWeekMeters: null,
    weeksToPeak: null,
  };

  const weeks = s.weeks;
  const n = weeks.length;
  if (n === 0) return insufficient;

  const currentIndex = weeks.findIndex((w) => w.phase === "current");
  const started = weeks.some((w) => w.phase !== "future");

  // Peak (highest-target) week.
  let peakIndex = 0;
  let peakTarget = 0;
  weeks.forEach((w, i) => {
    if (w.target > peakTarget) {
      peakTarget = w.target;
      peakIndex = i;
    }
  });

  // Completed-week actuals feed the trend — exclude the partial current week so
  // a mid-week reading doesn't drag the slope down.
  const points: TrendPoint[] = [];
  weeks.forEach((w, i) => {
    if (w.phase === "past" && w.actual != null) points.push({ x: i, y: w.actual });
  });

  const anchorIndex = currentIndex >= 0 ? currentIndex : n - 1;

  // Still building toward the peak → project the trend forward to the peak week.
  if (started && peakIndex > anchorIndex) {
    if (points.length < MIN_TREND_POINTS) return insufficient;
    const trend = linearTrend(points);
    if (!trend) return insufficient;

    const projected = Math.max(0, trendAt(trend, peakIndex));
    const ratio = peakTarget > 0 ? projected / peakTarget : 1;
    const status = classify(ratio);
    const weeksToPeak = peakIndex - anchorIndex;
    const recommendedPerWeekMeters =
      status === "atRisk" && projected < peakTarget && weeksToPeak > 0
        ? Math.ceil((peakTarget - projected) / weeksToPeak)
        : null;

    return {
      ...base,
      status,
      basis: "projection",
      pct: peakTarget > 0 ? Math.round(ratio * 100) : null,
      recommendedPerWeekMeters,
      weeksToPeak,
    };
  }

  // Peak reached/passed (taper) or plan finished → adherence accrued to date.
  if (started) {
    let cumulativeActual = 0;
    let cumulativeTarget = 0;
    for (const w of weeks) {
      if (w.phase !== "future") {
        cumulativeActual += w.actual ?? 0;
        cumulativeTarget += w.target;
      }
    }
    if (cumulativeTarget > 0) {
      const ratio = cumulativeActual / cumulativeTarget;
      return {
        ...base,
        status: classify(ratio),
        basis: "toDate",
        pct: Math.round(ratio * 100),
        recommendedPerWeekMeters: null,
        weeksToPeak: null,
      };
    }
  }

  return insufficient;
}

/**
 * Readiness for a plan's series (TOTAL + per-discipline, as built by
 * buildPlanSeries). `overall` is the TOTAL series for multi-sport plans, or the
 * single discipline for single-sport plans.
 */
export function computeReadiness(series: ReadinessSeriesInput[]): PlanReadiness {
  const all = series.map(computeSeriesReadiness);
  const overall = all.find((r) => r.key === "TOTAL") ?? all[0] ?? null;
  const disciplines = all.filter((r) => r.key !== "TOTAL");
  return { overall, disciplines };
}

/**
 * The objective HR-load side of readiness: current Form (TSB) turned into a
 * status, the volume easing the re-ramp will apply from it, and — when a wellness
 * check-in exists — a cross-check between what the athlete *reports* and what the
 * numbers *measure*. This is the "you feel fresh, but your Form is −35" insight.
 */
export interface FormReadiness {
  /** Current Form (TSB), rounded. */
  tsb: number;
  status: FormStatus;
  label: string;
  /** Volume multiplier (≤ 1) the re-ramp applies from Form alone. */
  easeFactor: number;
  /** Whether Form is easing the ramp (i.e. Form reads "overreaching"). */
  eases: boolean;
  /** A cross-check headline when the subjective and objective signals disagree. */
  note: string | null;
}

export function computeFormReadiness(tsb: number, checkin?: Wellness | null): FormReadiness {
  const status = formStatus(tsb);
  const easeFactor = formLoadFactor(tsb);
  const eases = easeFactor < 1;

  let note: string | null = null;
  if (checkin) {
    const subjectiveEases = checkinReadinessFactor(checkin) < 1;
    if (status.key === "overreaching" && !subjectiveEases) {
      note =
        "Your check-in says you feel fine, but your Form shows fatigue running ahead of fitness — the numbers say ease back this week.";
    } else if (status.key === "fresh" && subjectiveEases) {
      note =
        "Your check-in flags fatigue, though your Form looks fresh — a lighter week won't set your build back.";
    }
  }

  return { tsb: Math.round(tsb), status: status.key, label: status.label, easeFactor, eases, note };
}
