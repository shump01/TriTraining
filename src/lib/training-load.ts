/**
 * Heart-rate training load: per-activity hrTSS rolled into the classic
 * Performance Management Chart — CTL (Fitness), ATL (Fatigue), TSB (Form).
 * Pure and dependency-free; the data layer feeds it daily TSS + "now".
 *
 * hrTSS from AVERAGE heart rate (Strava doesn't hand us the full HR stream):
 *   IF  = avgHR / thresholdHR        (intensity factor, clamped to sane bounds)
 *   TSS = hours × IF² × 100          (100 = one hour at threshold)
 * It's an approximation — average HR can't see the shape of a session — but it's
 * the standard average-HR method and needs only data every HR-recorded activity
 * already carries.
 *
 * CTL/ATL are exponentially-weighted moving averages of daily TSS with the usual
 * 42- and 7-day time constants; Form (TSB) = Fitness − Fatigue.
 */

export const CTL_DAYS = 42; // Fitness (Chronic Training Load) time constant
export const ATL_DAYS = 7; // Fatigue (Acute Training Load) time constant

// Clamp the intensity factor so a spurious avg-HR reading can't produce absurd
// load (e.g. a mis-recorded HR of 30 or 250 bpm).
const IF_MIN = 0.3;
const IF_MAX = 1.15;

const DAY_MS = 86_400_000;

/** hrTSS for a single activity. Returns 0 when inputs are unusable. */
export function activityTss(movingSeconds: number, avgHr: number, thresholdHr: number): number {
  if (!(movingSeconds > 0) || !(avgHr > 0) || !(thresholdHr > 0)) return 0;
  const intensity = Math.min(Math.max(avgHr / thresholdHr, IF_MIN), IF_MAX);
  const hours = movingSeconds / 3600;
  return hours * intensity * intensity * 100;
}

/** Total TSS accrued on one calendar day (UTC-midnight ms). */
export interface DailyTss {
  dateMs: number;
  tss: number;
}

export interface LoadPoint {
  dateMs: number;
  tss: number;
  /** CTL — Fitness. */
  ctl: number;
  /** ATL — Fatigue. */
  atl: number;
  /** TSB — Form = CTL − ATL. */
  tsb: number;
}

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Build the daily CTL/ATL/TSB series from the first activity day through today
 * (rest days count as 0 TSS, so fatigue decays correctly). Empty in → empty out.
 */
export function buildLoadSeries(daily: DailyTss[], nowMs: number): LoadPoint[] {
  if (daily.length === 0) return [];

  const byDay = new Map<number, number>();
  for (const d of daily) {
    const day = utcMidnight(d.dateMs);
    byDay.set(day, (byDay.get(day) ?? 0) + d.tss);
  }

  const startMs = Math.min(...[...byDay.keys()]);
  const endMs = Math.max(utcMidnight(nowMs), startMs);

  const points: LoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const tss = byDay.get(ms) ?? 0;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    points.push({ dateMs: ms, tss, ctl, atl, tsb: ctl - atl });
  }
  return points;
}

export type FormStatus = "fresh" | "neutral" | "productive" | "overreaching";

/** Map Form (TSB) to a training-readiness label, using the usual PMC bands. */
export function formStatus(tsb: number): { key: FormStatus; label: string } {
  if (tsb > 15) return { key: "fresh", label: "Fresh / tapered" };
  if (tsb >= -10) return { key: "neutral", label: "Balanced" };
  if (tsb >= -30) return { key: "productive", label: "Building fitness" };
  return { key: "overreaching", label: "Overreaching — ease off" };
}

export interface LoadSummary {
  fitness: number; // CTL, rounded
  fatigue: number; // ATL, rounded
  form: number; // TSB, rounded
  status: ReturnType<typeof formStatus>;
  /** Last 7 days of TSS. */
  weekLoad: number;
}

/** Current fitness / fatigue / form from the tail of the series. */
export function summarizeLoad(points: LoadPoint[]): LoadSummary | null {
  const last = points.at(-1);
  if (!last) return null;
  const weekLoad = points.slice(-7).reduce((sum, p) => sum + p.tss, 0);
  return {
    fitness: Math.round(last.ctl),
    fatigue: Math.round(last.atl),
    form: Math.round(last.tsb),
    status: formStatus(last.tsb),
    weekLoad: Math.round(weekLoad),
  };
}
