import { DEFAULT_WEEK_START_DAY, startOfWeek } from "@/lib/weekly-targets";

/**
 * Pure target-vs-actual progress model for the tracking dashboard. No DB / no
 * framework — the page feeds it weekly targets + effective actuals and a "now".
 *
 * Phases are relative to the current week (Monday-aligned):
 *  - past:    fully elapsed — a missing actual counts as 0 (a missed week).
 *  - current: in progress — actual so far (0 if nothing yet).
 *  - future:  not started — target only, actual is null (no bar).
 */
export type ProgressStatus = "ahead" | "onTrack" | "behind";
export type WeekPhase = "past" | "current" | "future";

const BEHIND_RATIO = 0.9; // < 90% of target → behind
const AHEAD_RATIO = 1.1; // > 110% of target → ahead

export interface ProgressWeekInput {
  weekStartDate: Date;
  target: number;
  /** Effective actual (MANUAL over STRAVA), or null if nothing recorded. */
  actual: number | null;
  /**
   * Week marked as time off (ill / injured / away). Excluded from the
   * cumulative totals and the headline summary: nothing was expected, so
   * nothing is owed — and nothing is credited either. Without this, an athlete
   * who marked two weeks ill wore a red "behind" pill for the rest of the
   * season, directly above a readiness panel (which already excludes pauses)
   * saying they were on track. Per-week fields are still computed as usual;
   * the row-level UI renders its own "Paused" pill over them.
   */
  paused?: boolean;
}

export interface ProgressWeek {
  weekStartDate: Date;
  target: number;
  actual: number | null; // null only for future weeks
  phase: WeekPhase;
  pctOfTarget: number | null; // null for future weeks
  status: ProgressStatus | null; // null for future weeks ("upcoming")
  cumulativeTarget: number;
  cumulativeActual: number;
}

export interface ProgressSummary {
  started: boolean;
  finished: boolean;
  /** Cumulative figures through the current week (not counting future weeks). */
  cumulativeTarget: number;
  cumulativeActual: number;
  pctOfTarget: number | null;
  status: ProgressStatus | null; // null when the plan hasn't started
}

export interface Progress {
  weeks: ProgressWeek[];
  summary: ProgressSummary;
}

/**
 * Band a completion ratio into a status. Exported so alternate percentage
 * views (the balanced Total mode, src/lib/total-pct.ts) band with the SAME
 * thresholds as the distance-based series and can never drift.
 */
export function classifyRatio(ratio: number): ProgressStatus {
  if (ratio < BEHIND_RATIO) return "behind";
  if (ratio > AHEAD_RATIO) return "ahead";
  return "onTrack";
}

function classify(actual: number, target: number): ProgressStatus {
  if (target <= 0) return "onTrack";
  return classifyRatio(actual / target);
}

export function computeProgress(
  weeks: ProgressWeekInput[],
  now: Date,
  weekStartDay: number = DEFAULT_WEEK_START_DAY,
): Progress {
  const currentWeekMs = startOfWeek(now, weekStartDay).getTime();
  let cumulativeTarget = 0;
  let cumulativeActual = 0;

  const rows: ProgressWeek[] = weeks.map((w) => {
    const ms = w.weekStartDate.getTime();
    const phase: WeekPhase =
      ms > currentWeekMs ? "future" : ms === currentWeekMs ? "current" : "past";

    // Past/current missing data = a real 0 (missed); future = not yet (null).
    const actual = phase === "future" ? null : (w.actual ?? 0);

    // Paused weeks sit outside the season's ledger entirely — both sides, so
    // a synced activity during a rest week can't pad the total the way the
    // week's absent target can't drag it.
    if (!w.paused) {
      cumulativeTarget += w.target;
      if (actual !== null) cumulativeActual += actual;
    }

    return {
      weekStartDate: w.weekStartDate,
      target: w.target,
      actual,
      phase,
      pctOfTarget: actual === null || w.target <= 0 ? null : Math.round((actual / w.target) * 100),
      status: actual === null ? null : classify(actual, w.target),
      cumulativeTarget,
      cumulativeActual,
    };
  });

  const nonFuture = rows.filter((r) => r.phase !== "future");
  const started = nonFuture.length > 0;
  const lastWeekMs = weeks.length ? Math.max(...weeks.map((w) => w.weekStartDate.getTime())) : 0;
  const lastNonFuture = nonFuture.at(-1);
  const cumT = lastNonFuture?.cumulativeTarget ?? 0;
  const cumA = lastNonFuture?.cumulativeActual ?? 0;

  return {
    weeks: rows,
    summary: {
      started,
      finished: weeks.length > 0 && currentWeekMs > lastWeekMs,
      cumulativeTarget: cumT,
      cumulativeActual: cumA,
      pctOfTarget: started && cumT > 0 ? Math.round((cumA / cumT) * 100) : null,
      status: started ? classify(cumA, cumT) : null,
    },
  };
}
