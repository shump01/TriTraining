/**
 * Consistency heatmap + streaks — a pure summary of how reliably the athlete
 * hit their weekly targets. Derived from the per-week progress the plan already
 * computes (see buildPlanSeries / computeProgress); no DB or framework.
 *
 * A week "hits" when its status is onTrack or ahead (i.e. not behind). Only
 * COMPLETED (past) weeks count toward streaks and totals — the in-progress
 * current week is still open, and future weeks have no data.
 */

export type WeekStatus = "ahead" | "onTrack" | "behind" | null;
export type WeekPhase = "past" | "current" | "future";

export interface HeatmapWeek {
  ms: number;
  phase: WeekPhase;
  pctOfTarget: number | null;
  status: WeekStatus;
}

export interface HeatmapCell {
  ms: number;
  phase: WeekPhase;
  pctOfTarget: number | null;
  status: WeekStatus;
  /** A completed week whose status is onTrack/ahead. */
  hit: boolean;
}

export interface Heatmap {
  cells: HeatmapCell[];
  weeksCompleted: number;
  weeksHit: number;
  /** Most-recent run of consecutive completed weeks that hit target. */
  currentStreak: number;
  /** Longest such run anywhere in the plan. */
  bestStreak: number;
}

function isHit(w: HeatmapWeek): boolean {
  return w.phase === "past" && (w.status === "onTrack" || w.status === "ahead");
}

export function buildHeatmap(weeks: HeatmapWeek[]): Heatmap {
  const cells: HeatmapCell[] = weeks.map((w) => ({
    ms: w.ms,
    phase: w.phase,
    pctOfTarget: w.pctOfTarget,
    status: w.status,
    hit: isHit(w),
  }));

  const completed = weeks.filter((w) => w.phase === "past");
  const weeksCompleted = completed.length;
  const weeksHit = completed.filter(isHit).length;

  // Best streak: longest consecutive run of hits among completed weeks.
  let bestStreak = 0;
  let run = 0;
  for (const w of completed) {
    if (isHit(w)) {
      run += 1;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }

  // Current streak: consecutive hits ending at the most recent completed week.
  let currentStreak = 0;
  for (let i = completed.length - 1; i >= 0; i--) {
    if (isHit(completed[i]!)) currentStreak += 1;
    else break;
  }

  return { cells, weeksCompleted, weeksHit, currentStreak, bestStreak };
}
