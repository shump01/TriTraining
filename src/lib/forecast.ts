import { buildLoadSeries, type DailyTss, type LoadPoint } from "@/lib/training-load";

/**
 * Race-readiness forecast: project Fitness/Fatigue/Form (CTL/ATL/TSB) from
 * today through race day, assuming the remaining weekly targets are executed.
 *
 * The projection is the SAME exponential math as the historical PMC — future
 * weeks' target meters are converted to estimated daily TSS and appended to
 * the athlete's actual daily history, then the whole thing is folded through
 * buildLoadSeries. That makes the taper visible as the Form upswing and turns
 * the Load page's rear-view mirror into a forward answer: "what shape will I
 * be in on race morning?"
 *
 * Meters → TSS is the only estimated step. Each discipline gets a
 * TSS-per-meter rate — derived from the athlete's own recent weeks (their
 * actual load per actual distance) when there's enough data, else a
 * conservative age-group default. Pure and dependency-free; the data layer
 * feeds athlete samples and plan weeks.
 */

export type ForecastDiscipline = "SWIM" | "BIKE" | "RUN";

const DAY_MS = 86_400_000;

/**
 * Default training stress per meter, by discipline — a steady age-group
 * aerobic effort (about 2:13/100m swim at ~50 TSS/h, 27 km/h bike at
 * ~55 TSS/h, 5:45/km run at ~60 TSS/h). Deliberately conservative: they
 * exist only as the fallback when the athlete's own history can't calibrate.
 */
export const DEFAULT_TSS_PER_METER: Record<ForecastDiscipline, number> = {
  SWIM: 0.0185,
  BIKE: 0.00204,
  RUN: 0.00575,
};

/** Weeks of (meters, tss) evidence required before trusting a derived rate. */
const DERIVED_MIN_WEEKS = 2;
/** A derived rate outside [default/4, default×4] is treated as garbage data. */
const DERIVED_CLAMP_FACTOR = 4;

/** One completed week's evidence for one discipline. */
export interface WeekSample {
  discipline: ForecastDiscipline;
  /** Effective weekly actual distance. */
  meters: number;
  /** Total hrTSS the athlete's load rows produced for that discipline+week. */
  tss: number;
}

export interface TssPerMeterRates {
  rates: Record<ForecastDiscipline, number>;
  /** Which disciplines were calibrated from the athlete's own history. */
  derived: Record<ForecastDiscipline, boolean>;
}

/**
 * Calibrate TSS-per-meter per discipline from recent completed weeks. Weeks
 * with zero meters or zero TSS are ignored (nothing to learn from); fewer
 * than DERIVED_MIN_WEEKS usable weeks falls back to the default; derived
 * rates are clamped to a sane multiple of the default so one mislabeled
 * activity can't produce an absurd forecast.
 */
export function deriveTssPerMeter(samples: WeekSample[]): TssPerMeterRates {
  const rates = { ...DEFAULT_TSS_PER_METER };
  const derived: Record<ForecastDiscipline, boolean> = {
    SWIM: false,
    BIKE: false,
    RUN: false,
  };

  for (const d of ["SWIM", "BIKE", "RUN"] as const) {
    const usable = samples.filter((s) => s.discipline === d && s.meters > 0 && s.tss > 0);
    if (usable.length < DERIVED_MIN_WEEKS) continue;
    const meters = usable.reduce((sum, s) => sum + s.meters, 0);
    const tss = usable.reduce((sum, s) => sum + s.tss, 0);
    const raw = tss / meters;
    const lo = DEFAULT_TSS_PER_METER[d] / DERIVED_CLAMP_FACTOR;
    const hi = DEFAULT_TSS_PER_METER[d] * DERIVED_CLAMP_FACTOR;
    rates[d] = Math.min(Math.max(raw, lo), hi);
    derived[d] = true;
  }

  return { rates, derived };
}

/** One plan week the projection will "execute". */
export interface ForecastWeek {
  /** UTC-midnight week start. */
  weekStartMs: number;
  targets: { discipline: ForecastDiscipline; targetMeters: number }[];
  /** Marked as time off — projected as a zero-load recovery week. */
  paused: boolean;
}

/** Estimated total TSS for one week's targets under the given rates. */
export function estimateWeekTss(
  week: ForecastWeek,
  rates: Record<ForecastDiscipline, number>,
): number {
  if (week.paused) return 0;
  return week.targets.reduce(
    (sum, t) => sum + Math.max(0, t.targetMeters) * rates[t.discipline],
    0,
  );
}

export type ForecastVerdictKey = "detrained" | "primed" | "sharp" | "carrying" | "fatigued";

export interface ForecastVerdict {
  key: ForecastVerdictKey;
  label: string;
  detail: string;
}

/**
 * Race-day Form (TSB) → verdict, using the classic PMC race guidance: the
 * +10…+25 window is the sweet spot; higher usually means fitness was given
 * away in an over-long taper; at or below zero the taper isn't clearing the
 * fatigue the plan itself is scheduled to create.
 */
export function raceDayVerdict(tsb: number): ForecastVerdict {
  if (tsb > 25) {
    return {
      key: "detrained",
      label: "Over-tapered",
      detail:
        "Form this high on race morning usually means more taper than the fitness can afford — consider holding a touch more volume in the final weeks.",
    };
  }
  if (tsb >= 10) {
    return {
      key: "primed",
      label: "Race-ready",
      detail: "Right in the classic +10 to +25 window: fatigue cleared, fitness held.",
    };
  }
  if (tsb >= 0) {
    return {
      key: "sharp",
      label: "Nearly fresh",
      detail:
        "Slightly tired but sharp — fine for a B or C race; an A race would appreciate a touch more taper.",
    };
  }
  if (tsb >= -10) {
    return {
      key: "carrying",
      label: "Carrying fatigue",
      detail:
        "On this plan you'd start with fatigue not fully cleared — consider easing the final weeks slightly.",
    };
  }
  return {
    key: "fatigued",
    label: "Fatigued",
    detail:
      "On the current plan you'd land on race day tired. Ease the closing weeks or extend the taper.",
  };
}

export interface RaceForecast {
  /** The series point for today — where the projection takes over. */
  anchor: LoadPoint;
  /** Daily projected points, strictly after today, through race day. */
  projection: LoadPoint[];
  raceDay: { fitness: number; fatigue: number; form: number };
  verdict: ForecastVerdict;
  /** Highest projected Fitness between now and the race (the taper trade). */
  peakFitness: number;
}

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Project the PMC through race day. `history` is the athlete's real daily TSS
 * (what the Load page already charts); `weeks` are the plan weeks from the
 * current week through the race week. Each future week's estimated TSS is
 * spread evenly across its seven days — day-level placement barely moves a
 * 42-day average, and an even spread is the honest "no further information"
 * assumption. Days of the current week already lived are real history; only
 * days strictly after today are estimated, and nothing past race day counts.
 *
 * Null when there's no history to anchor on or the race isn't in the future —
 * the caller simply doesn't show a forecast.
 */
export function buildRaceForecast(input: {
  history: DailyTss[];
  nowMs: number;
  raceDayMs: number;
  weeks: ForecastWeek[];
  rates: Record<ForecastDiscipline, number>;
}): RaceForecast | null {
  const today = utcMidnight(input.nowMs);
  const raceDay = utcMidnight(input.raceDayMs);
  if (raceDay <= today) return null;
  if (input.history.length === 0) return null;

  const daily: DailyTss[] = input.history.filter((d) => utcMidnight(d.dateMs) <= today);
  if (daily.length === 0) return null;

  // Real TSS by day — used to net the current week's already-banked volume.
  const bankedByDay = new Map<number, number>();
  for (const d of daily) {
    const day = utcMidnight(d.dateMs);
    bankedByDay.set(day, (bankedByDay.get(day) ?? 0) + d.tss);
  }

  for (const week of input.weeks) {
    const weekTss = estimateWeekTss(week, input.rates);
    if (weekTss <= 0) continue;
    const weekEnd = week.weekStartMs + 6 * DAY_MS;

    // Days this week can still contribute: strictly after today, and strictly
    // before race day — race morning has no training behind it yet, and race
    // day itself is the race, not 1/7 of race-week volume.
    const from = Math.max(week.weekStartMs, today + DAY_MS);
    const to = Math.min(weekEnd, raceDay - DAY_MS);
    if (to < from) continue;

    let perDay: number;
    if (week.weekStartMs <= today) {
      // The current week: sessions already trained are real history, so only
      // the target's REMAINDER is still ahead, spread over the week's
      // remaining days — else a banked Monday long ride would count twice
      // (once as history, again inside the week's estimate).
      let banked = 0;
      for (let ms = week.weekStartMs; ms <= today; ms += DAY_MS) {
        banked += bankedByDay.get(ms) ?? 0;
      }
      const remainingDays = (weekEnd - today) / DAY_MS;
      perDay = Math.max(0, weekTss - banked) / remainingDays;
    } else {
      perDay = weekTss / 7;
    }
    if (perDay <= 0) continue;
    for (let ms = from; ms <= to; ms += DAY_MS) {
      daily.push({ dateMs: ms, tss: perDay });
    }
  }

  const series = buildLoadSeries(daily, raceDay);
  const anchor =
    series.find((p) => p.dateMs === today) ?? series.findLast((p) => p.dateMs <= today);
  const projection = series.filter((p) => p.dateMs > today);
  const last = projection.at(-1);
  if (!anchor || !last) return null;

  const peakFitness = Math.max(anchor.ctl, ...projection.map((p) => p.ctl));

  // Band the SAME rounded value the card displays — banding the raw TSB lets
  // "Form +10" sit next to a verdict whose copy says +10 is a different band.
  const form = Math.round(last.tsb);

  return {
    anchor,
    projection,
    raceDay: {
      fitness: Math.round(last.ctl),
      fatigue: Math.round(last.atl),
      form,
    },
    verdict: raceDayVerdict(form),
    peakFitness: Math.round(peakFitness),
  };
}
