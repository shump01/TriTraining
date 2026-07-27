/**
 * Weekly training-volume progression.
 *
 * This module is intentionally PURE: no database, no framework, no I/O — just a
 * deterministic function of its inputs. That makes it trivially unit-testable
 * and reusable (e.g. a route handler can call it and persist the result).
 */

/** Maximum week-over-week increase: 12%. */
export const MAX_WEEKLY_INCREASE = 0.12;

/**
 * Default hard cap multiple: a weekly target never exceeds this multiple of
 * the event distance. Overridable per plan via `WeeklyTargetInput.capMultiple`.
 */
export const CAP_MULTIPLE = 1.5;

/**
 * Training block length, in weeks. The last week of each block is a de-load: it
 * drops back to the level of the block's 2nd week (e.g. 100, 110, 121, 110).
 */
export const BLOCK_WEEKS = 4;

/**
 * Race-week volume as a fraction of the peak, at the bottom of the taper. The
 * final taper week (race week) lands here; earlier taper weeks interpolate up
 * toward the peak. 0.5 = race week at half the peak volume.
 */
export const TAPER_FLOOR = 0.5;

/** Default number of taper weeks for a plan (the schema/validation default). */
export const DEFAULT_TAPER_WEEKS = 2;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Upper bound on a plan's length (~5 years of weeks). The week count drives
 * every loop and every persisted target row here, so it must never be
 * attacker-controlled without a ceiling. Mirrors the date bounds in
 * src/lib/validation.ts, which reject over-long spans as a clean 400.
 */
export const MAX_PLAN_WEEKS = 300;

export interface WeeklyTargetInput {
  /** First Monday on/after plan creation (week 1's start). */
  startDate: Date;
  /** The event date; the last produced week is the one containing it. */
  eventDate: Date;
  /** Week 1's target volume, in meters. Must be positive. */
  startingWeeklyMeters: number;
  /** The event distance, in meters. Must be positive. Drives the hard cap. */
  eventDistanceMeters: number;
  /**
   * Hard cap multiple: a weekly target never exceeds `capMultiple ×
   * eventDistanceMeters`. Must be positive. Defaults to `CAP_MULTIPLE` (1.5).
   */
  capMultiple?: number;
  /**
   * Number of race-week taper weeks: the final N weeks ramp DOWN from the peak
   * into race day (so the athlete arrives fresh) instead of building. Defaults
   * to 0 (no taper — the volume peaks on the event week). Clamped so a plan
   * always keeps at least two build weeks.
   */
  taperWeeks?: number;
}

export interface WeeklyTarget {
  /** UTC-midnight Monday that the week starts on. */
  weekStartDate: Date;
  /** Target volume for the week, in whole meters (rounded down). */
  targetMeters: number;
}

/** UTC-midnight epoch ms for a date's calendar day (timezone/DST-safe). */
function utcMidnightMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** A day-of-week index: 0=Sunday, 1=Monday, … 6=Saturday. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The default training-week boundary when a plan doesn't specify one: Monday. */
export const DEFAULT_WEEK_START_DAY = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first `weekStartDay` on or after `date` (UTC), at UTC midnight — used to
 * align a plan's week 1 to its chosen start day. Returns `date`'s own day when it
 * already falls on `weekStartDay`. `weekStartDay` is 0=Sun..6=Sat (default Mon).
 *
 * @throws RangeError on an invalid Date.
 */
export function firstWeekStartOnOrAfter(
  date: Date,
  weekStartDay: number = DEFAULT_WEEK_START_DAY,
): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("date must be a valid Date");
  }
  const midnight = utcMidnightMs(date);
  const day = new Date(midnight).getUTCDay(); // 0=Sun..6=Sat
  const offsetDays = (weekStartDay - day + 7) % 7; // forward to the next start day
  return new Date(midnight + offsetDays * DAY_MS);
}

/**
 * The start of the training week that contains `date` — the most recent
 * `weekStartDay` on or before `date` (UTC midnight). Used to bucket activities
 * and targets into weeks. `weekStartDay` is 0=Sun..6=Sat (default Mon).
 *
 * @throws RangeError on an invalid Date.
 */
export function startOfWeek(date: Date, weekStartDay: number = DEFAULT_WEEK_START_DAY): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("date must be a valid Date");
  }
  const midnight = utcMidnightMs(date);
  const day = new Date(midnight).getUTCDay(); // 0=Sun..6=Sat
  const offsetDays = (day - weekStartDay + 7) % 7; // back to the start day
  return new Date(midnight - offsetDays * DAY_MS);
}

/**
 * A plan's week-1 start: the explicitly stored `startDate` if present (lets a
 * plan be back-dated to when training actually began), otherwise the first
 * week-start on/after the plan's creation date (legacy plans predating that
 * column). `weekStartDay` defaults to Monday for plans predating that column.
 */
export function planStartWeek(plan: {
  startDate: Date | null;
  createdAt: Date;
  weekStartDay?: number;
}): Date {
  return (
    plan.startDate ??
    firstWeekStartOnOrAfter(plan.createdAt, plan.weekStartDay ?? DEFAULT_WEEK_START_DAY)
  );
}

/**
 * Produce one target per week from `startDate` up to and including the week that
 * contains `eventDate` (weeks start Monday).
 *
 * - Week 1 = `startingWeeklyMeters`.
 * - No target exceeds the cap, `CAP_MULTIPLE × eventDistanceMeters`.
 * - **De-load weeks:** the last week of every `BLOCK_WEEKS`-week block drops
 *   back to the level of that block's 2nd week (e.g. 100, 110, 121, 110). The
 *   next block resumes building from the de-load, so progression is gentle and
 *   every *increase* still stays within 12%.
 * - The ramp is **evened out**: build weeks grow at the *gentlest constant rate*
 *   that still reaches the cap at the peak (the de-loads mean a block advances
 *   ~2 net steps over 4 weeks, which is accounted for). Longer plans therefore
 *   get smaller weekly increases — slower progression where possible.
 * - That even rate is capped at 12%. For plans too short to reach the cap within
 *   12%/week build steps, the ramp simply uses the full 12%.
 * - **Taper:** with `taperWeeks > 0`, the volume peaks `taperWeeks` weeks before
 *   the event and the final weeks ramp down to `TAPER_FLOOR × peak` at race week,
 *   so the athlete arrives fresh. De-loads don't apply in the taper. `taperWeeks`
 *   is clamped to keep at least two build weeks. Default 0 keeps the peak on the
 *   event week (the pre-taper behavior).
 * - All targets are whole meters (rounded down).
 *
 * Growth is applied to the previous week's *integer* target, so the week-over-
 * week ratio of the integer outputs never exceeds the chosen rate (≤ 12%).
 * De-loads are decreases and never count against that ceiling.
 *
 * @throws RangeError on invalid dates, `startDate >= eventDate`, a span longer
 *   than MAX_PLAN_WEEKS, or non-positive `startingWeeklyMeters` /
 *   `eventDistanceMeters` / `capMultiple`.
 */
export function computeWeeklyTargets({
  startDate,
  eventDate,
  startingWeeklyMeters,
  eventDistanceMeters,
  capMultiple = CAP_MULTIPLE,
  taperWeeks = 0,
}: WeeklyTargetInput): WeeklyTarget[] {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    throw new RangeError("startDate must be a valid Date");
  }
  if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) {
    throw new RangeError("eventDate must be a valid Date");
  }
  if (startDate.getTime() >= eventDate.getTime()) {
    throw new RangeError("startDate must be strictly before eventDate");
  }
  if (!Number.isFinite(startingWeeklyMeters) || startingWeeklyMeters <= 0) {
    throw new RangeError("startingWeeklyMeters must be a positive number");
  }
  if (!Number.isFinite(eventDistanceMeters) || eventDistanceMeters <= 0) {
    throw new RangeError("eventDistanceMeters must be a positive number");
  }
  if (!Number.isFinite(capMultiple) || capMultiple <= 0) {
    throw new RangeError("capMultiple must be a positive number");
  }

  const startMs = utcMidnightMs(startDate);
  const eventMs = utcMidnightMs(eventDate);

  // Whole weeks from week 1's Monday to the Monday of the event's week, inclusive.
  const weekCount = Math.floor((eventMs - startMs) / MS_PER_WEEK) + 1;

  // Every week below becomes array entries here and rows in the database, so an
  // unbounded span is a resource bomb, not just nonsense input. Callers bound
  // the dates in validation.ts; this is the belt-and-braces invariant for any
  // future caller that doesn't.
  if (weekCount > MAX_PLAN_WEEKS) {
    throw new RangeError(`Plan spans ${weekCount} weeks; the maximum is ${MAX_PLAN_WEEKS}`);
  }

  const cap = capMultiple * eventDistanceMeters;
  const clampedStart = Math.min(startingWeeklyMeters, cap);

  // The final `effectiveTaper` weeks ramp DOWN into race day instead of building.
  // Clamp so a plan always keeps at least two build weeks (a start week + a
  // peak); short plans automatically get less (or no) taper. A negative or
  // fractional request is floored/clamped here rather than throwing.
  const effectiveTaper = Math.max(0, Math.min(Math.floor(taperWeeks), weekCount - 2));
  // Index of the last BUILD week — the volume peak. Taper weeks (if any) follow.
  const peakIndex = weekCount - 1 - effectiveTaper;

  const isDeloadWeek = (week: number) => week % BLOCK_WEEKS === BLOCK_WEEKS - 1;

  // Each build week reaches a "growth exponent" — the number of build steps
  // applied so far. De-load weeks reset to their block's 2nd week, so they don't
  // advance the exponent; the highest exponent is reached at the peak (peakIndex).
  let maxExponent = 0;
  const exponents: number[] = [0];
  for (let week = 1; week <= peakIndex; week++) {
    const exponent = isDeloadWeek(week) ? exponents[week - 2]! : exponents[week - 1]! + 1;
    exponents.push(exponent);
    if (exponent > maxExponent) maxExponent = exponent;
  }

  // Gentlest constant build rate that still reaches the cap at the peak, capped
  // at 12%. Because there are more build steps to spread across, longer plans
  // get a smaller rate (slower progression where possible).
  let growthRate = 0;
  if (maxExponent > 0 && clampedStart < cap) {
    const evenRate = Math.pow(cap / clampedStart, 1 / maxExponent) - 1;
    growthRate = Math.min(evenRate, MAX_WEEKLY_INCREASE);
  }

  // Week 1: the starting volume, clamped to the cap, rounded down.
  const values: number[] = [Math.floor(clampedStart)];
  const targets: WeeklyTarget[] = [{ weekStartDate: new Date(startMs), targetMeters: values[0]! }];

  // Build weeks 1..peakIndex — the existing even ramp with de-load steps.
  for (let week = 1; week <= peakIndex; week++) {
    const value = isDeloadWeek(week)
      ? values[week - 2]! // de-load: back to this block's 2nd week
      : Math.floor(Math.min(values[week - 1]! * (1 + growthRate), cap));
    values.push(value);
    targets.push({ weekStartDate: new Date(startMs + week * MS_PER_WEEK), targetMeters: value });
  }

  // Taper weeks (peakIndex+1 .. weekCount-1): ramp down evenly from the peak
  // volume to `TAPER_FLOOR × peak` at race week. De-loads don't apply here.
  const peakValue = Math.max(...values);
  for (let t = 1; t <= effectiveTaper; t++) {
    const week = peakIndex + t;
    const factor = 1 - (1 - TAPER_FLOOR) * (t / effectiveTaper);
    const value = Math.floor(peakValue * factor);
    values.push(value);
    targets.push({ weekStartDate: new Date(startMs + week * MS_PER_WEEK), targetMeters: value });
  }

  return targets;
}

/**
 * Volume lost per whole week of a training layoff, applied when returning from
 * paused (ill / injured / travelling) weeks. Detraining is gradual, so this is a
 * deliberately gentle haircut — at 12%/week the ramp wins a one-week layoff back
 * almost immediately, while a long absence starts meaningfully lower.
 */
export const DETRAIN_PER_WEEK = 0.1;

/** Floor on the return baseline: never restart below half the pre-pause volume. */
export const MIN_RETURN_FACTOR = 0.5;

/**
 * Volume multiplier applied to the pre-pause baseline when coming back from
 * `weeksOff` consecutive paused weeks: 1 week off → 0.9, 3 → 0.7, 5+ → the 0.5
 * floor. Zero/negative (no layoff) leaves the baseline untouched.
 *
 * This is what stops a plan resuming at its stale pre-illness target — fitness
 * decayed while you were off, so the ramp has to restart lower and build back.
 */
export function returnToTrainingFactor(weeksOff: number): number {
  if (!Number.isFinite(weeksOff) || weeksOff <= 0) return 1;
  return Math.max(MIN_RETURN_FACTOR, 1 - DETRAIN_PER_WEEK * Math.floor(weeksOff));
}

/** One discipline's inputs for the adaptive re-ramp. */
export interface AdaptiveDisciplineInput {
  discipline: string;
  eventDistanceMeters: number;
  /** Effective actual (MANUAL over STRAVA) for the baseline week, or null. */
  lastCompletedActual: number | null;
  /** The current stored target for the baseline week — the no-signal fallback. */
  lastCompletedTarget: number;
}

/** A regenerated future target row (discipline kept as a string — this module is pure). */
export interface AdaptedTargetRow {
  discipline: string;
  weekStartDate: Date;
  targetMeters: number;
}

/**
 * Re-ramp the current + future weeks of a plan from the **last completed week's
 * actual** volume, per discipline, using the same progression engine
 * (`computeWeeklyTargets`). This is how a plan adapts week-to-week to real
 * training rather than staying pinned to its original projection.
 *
 * - Baseline = the baseline week's effective actual. **Adapt both ways**:
 *   a higher actual ramps future weeks up (still capped), a lower one ramps them
 *   down.
 * - **No-signal fallback**: if that week's actual is missing or 0 (a fully
 *   skipped week), the baseline falls back to that week's existing target, so a
 *   blank week doesn't collapse the rest of the plan to zero.
 * - **Returning from a layoff** (`pausedWeeks > 0`): the baseline week is the last
 *   week actually *trained* (the caller skips back over the paused weeks), the
 *   baseline is detrained by `returnToTrainingFactor`, and the ramp restarts **at
 *   the current week** — so the first week back *is* the reduced volume and the
 *   plan builds up from there, rather than resuming at the stale pre-pause target.
 * - Only rows on/after `currentWeekStart` are returned; the completed week and
 *   earlier stay as historical targets.
 *
 * Pure — no DB/IO. The caller resolves actuals and persists the result.
 */
export function computeAdaptedFutureTargets(args: {
  disciplines: AdaptiveDisciplineInput[];
  /** The week the baseline came from — the last completed week *not* paused. */
  lastCompletedWeekStart: Date;
  currentWeekStart: Date;
  eventDate: Date;
  capMultiple: number;
  /**
   * The plan's taper length. Weeks inside the taper are never re-ramped — once
   * the current week is within `taperWeeks` of race day this returns no rows and
   * the existing taper stands.
   */
  taperWeeks?: number;
  /**
   * Volume multiplier from the last completed week's wellness check-in and the
   * athlete's current Form (see checkinReadinessFactor / formLoadFactor). < 1
   * eases the following weeks toward recovery; 1 (default) leaves it untouched.
   */
  readinessFactor?: number;
  /**
   * Consecutive paused weeks immediately before the current week (0 = none).
   * Drives the detrained return baseline and restarts the ramp at the current week.
   */
  pausedWeeks?: number;
}): AdaptedTargetRow[] {
  const currentMs = utcMidnightMs(args.currentWeekStart);
  const rows: AdaptedTargetRow[] = [];
  const readinessFactor = args.readinessFactor ?? 1;
  const pausedWeeks = args.pausedWeeks ?? 0;
  const returning = pausedWeeks > 0;
  const taperWeeks = Math.max(0, Math.floor(args.taperWeeks ?? 0));

  // THE TAPER IS NOT RE-RAMPED. Two reasons, and both matter:
  //
  //  1. Domain: the taper exists to arrive fresh. Adapting a taper week *upward*
  //     because last week went well is precisely backwards.
  //  2. Mechanics: computeWeeklyTargets re-derives `weekCount` from the start it
  //     is handed, and the re-ramp hands it the *sliding* anchor. As the anchor
  //     nears race day weekCount shrinks, so the taper clamp
  //     (`min(taperWeeks, weekCount - 2)`) collapses and `peakIndex` walks onto
  //     the race week — regenerating a 2-week taper on race week yields
  //     effectiveTaper = 0 and rewrites race day as a +12% BUILD off the peak.
  //
  // So once the current week is inside the taper the ramp is over: return no
  // rows and the taper stands as computed. Weeks are counted the same way
  // computeWeeklyTargets counts them, inclusive of the event's own week.
  const weeksToRaceInclusive =
    Math.floor((utcMidnightMs(args.eventDate) - currentMs) / MS_PER_WEEK) + 1;
  if (taperWeeks > 0 && weeksToRaceInclusive <= taperWeeks) return rows;

  // Coming back from a layoff the ramp restarts AT the current week (its first
  // week back is the detrained baseline itself); otherwise it continues from the
  // last completed week as usual.
  const anchorStart = returning ? args.currentWeekStart : args.lastCompletedWeekStart;
  // computeWeeklyTargets needs a start strictly before the event. (Only reachable
  // on the returning path, where the anchor *is* the current week, and only for a
  // plan with no taper — the guard above already covers every tapered plan.)
  if (anchorStart.getTime() >= args.eventDate.getTime()) return rows;

  const returnFactor = returning ? returnToTrainingFactor(pausedWeeks) : 1;

  for (const d of args.disciplines) {
    // Real, non-zero actual drives the ramp; otherwise treat the week as no
    // signal and re-ramp from its original target instead of from zero. A
    // fatigued check-in scales the baseline down so the plan eases off, and a
    // layoff detrains it further.
    const raw =
      d.lastCompletedActual && d.lastCompletedActual > 0
        ? d.lastCompletedActual
        : d.lastCompletedTarget;
    const baseline = raw * readinessFactor * returnFactor;
    if (!(baseline > 0)) continue;

    const targets = computeWeeklyTargets({
      startDate: anchorStart,
      eventDate: args.eventDate,
      startingWeeklyMeters: baseline,
      eventDistanceMeters: d.eventDistanceMeters,
      capMultiple: args.capMultiple,
      taperWeeks: args.taperWeeks,
    });

    for (const t of targets) {
      if (t.weekStartDate.getTime() >= currentMs) {
        rows.push({
          discipline: d.discipline,
          weekStartDate: t.weekStartDate,
          targetMeters: t.targetMeters,
        });
      }
    }
  }

  return rows;
}
