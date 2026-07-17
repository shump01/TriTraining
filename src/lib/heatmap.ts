/**
 * Consistency heatmap + streaks — a pure summary of how reliably the athlete
 * hit their weekly targets. Derived from the per-week progress the plan already
 * computes (see buildPlanSeries / computeProgress); no DB or framework.
 *
 * A week "hits" when its status is onTrack or ahead (i.e. not behind). Only
 * COMPLETED (past) weeks count toward streaks and totals — the in-progress
 * current week is still open, and future weeks have no data.
 *
 * Weeks marked as time off (see WeeklyPause) are **transparent**: nothing was
 * expected of them, so they neither count toward the totals nor break a streak —
 * a fortnight ill leaves a run of good weeks intact. Anything else would
 * contradict the pause feature, and the plan page renders a "Paused" pill on the
 * very week this used to score as missed.
 */

export type WeekStatus = "ahead" | "onTrack" | "behind" | null;
export type WeekPhase = "past" | "current" | "future";

export interface HeatmapWeek {
  ms: number;
  phase: WeekPhase;
  pctOfTarget: number | null;
  status: WeekStatus;
  /** Marked as time off — ill / injured / away. */
  paused?: boolean;
}

export interface HeatmapCell {
  ms: number;
  phase: WeekPhase;
  pctOfTarget: number | null;
  status: WeekStatus;
  /** A completed, non-paused week whose status is onTrack/ahead. */
  hit: boolean;
  /** Time off: rendered distinctly, and excluded from totals and streaks. */
  paused: boolean;
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
  return !w.paused && w.phase === "past" && (w.status === "onTrack" || w.status === "ahead");
}

export function buildHeatmap(weeks: HeatmapWeek[]): Heatmap {
  const cells: HeatmapCell[] = weeks.map((w) => ({
    ms: w.ms,
    phase: w.phase,
    pctOfTarget: w.pctOfTarget,
    status: w.status,
    hit: isHit(w),
    paused: Boolean(w.paused),
  }));

  // Paused weeks are dropped from the sequence entirely rather than scored as a
  // miss, so a streak simply continues across the time off.
  const completed = weeks.filter((w) => w.phase === "past" && !w.paused);
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
