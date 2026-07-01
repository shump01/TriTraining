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

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

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

/**
 * The first Monday on or after `date` (UTC), at UTC midnight — used to align a
 * plan's week 1 to a Monday. Returns `date`'s day itself when it's already a
 * Monday.
 *
 * @throws RangeError on an invalid Date.
 */
export function firstMondayOnOrAfter(date: Date): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("date must be a valid Date");
  }
  const midnight = utcMidnightMs(date);
  const day = new Date(midnight).getUTCDay(); // 0=Sun..6=Sat
  const offsetDays = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  return new Date(midnight + offsetDays * 24 * 60 * 60 * 1000);
}

/**
 * A plan's week-1 Monday: the explicitly stored `startDate` if present (lets a
 * plan be back-dated to when training actually began), otherwise the first
 * Monday on/after the plan's creation date (legacy plans predating that column).
 */
export function planStartMonday(plan: { startDate: Date | null; createdAt: Date }): Date {
  return plan.startDate ?? firstMondayOnOrAfter(plan.createdAt);
}

/**
 * The Monday (UTC midnight) of the week that contains `date` — i.e. the start of
 * `date`'s training week. Used to bucket activities into weeks.
 *
 * @throws RangeError on an invalid Date.
 */
export function startOfWeekMonday(date: Date): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("date must be a valid Date");
  }
  const midnight = utcMidnightMs(date);
  const day = new Date(midnight).getUTCDay(); // 0=Sun..6=Sat
  const offsetDays = day === 0 ? -6 : 1 - day; // back to Monday
  return new Date(midnight + offsetDays * 24 * 60 * 60 * 1000);
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
 * - All targets are whole meters (rounded down).
 *
 * Growth is applied to the previous week's *integer* target, so the week-over-
 * week ratio of the integer outputs never exceeds the chosen rate (≤ 12%).
 * De-loads are decreases and never count against that ceiling.
 *
 * @throws RangeError on invalid dates, `startDate >= eventDate`, or non-positive
 *   `startingWeeklyMeters` / `eventDistanceMeters` / `capMultiple`.
 */
export function computeWeeklyTargets({
  startDate,
  eventDate,
  startingWeeklyMeters,
  eventDistanceMeters,
  capMultiple = CAP_MULTIPLE,
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

  const cap = capMultiple * eventDistanceMeters;
  const clampedStart = Math.min(startingWeeklyMeters, cap);

  const isDeloadWeek = (week: number) => week % BLOCK_WEEKS === BLOCK_WEEKS - 1;

  // Each week reaches a "growth exponent" — the number of build steps applied so
  // far. De-load weeks reset to their block's 2nd week, so they don't advance
  // the exponent; the highest exponent is reached at the final peak.
  let maxExponent = 0;
  const exponents: number[] = [0];
  for (let week = 1; week < weekCount; week++) {
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

  for (let week = 1; week < weekCount; week++) {
    const value = isDeloadWeek(week)
      ? values[week - 2]! // de-load: back to this block's 2nd week
      : Math.floor(Math.min(values[week - 1]! * (1 + growthRate), cap));
    values.push(value);
    targets.push({ weekStartDate: new Date(startMs + week * MS_PER_WEEK), targetMeters: value });
  }

  return targets;
}
