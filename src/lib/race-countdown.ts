/**
 * The race-day countdown, as pure arithmetic over the device clock.
 *
 * THE RACE IS A CALENDAR DAY, NOT AN INSTANT. The server stores the event as a
 * DATE and ships it as UTC midnight ("2026-12-13T00:00:00.000Z", or that same
 * instant in ms on the plan detail). Only the date parts are meaningful; read
 * as an instant it is the evening of the 12th in New York and late morning
 * of the 13th in Sydney — the cause of every off-by-one race-date label west
 * of UTC. So this module takes the Y-M-D and builds LOCAL instants from it:
 *
 * - the countdown's zero is LOCAL 00:00 of race day (`raceStartMs`). No start
 *   time is stored, so "race day has arrived" is the only honest zero; if a
 *   start time is ever added, this is the one place to change;
 * - the day count is noon-anchored and rounded, the repo's DST convention
 *   (week-brief-plan.ts): a spring-forward inside the span shortens the raw
 *   difference by an hour and a floor would undercount by a day;
 * - the eve clock is real elapsed time with hours NOT taken modulo 24 — a
 *   fall-back eve is genuinely 25 wall-clock hours long and says so;
 * - `raceDayMs` is LOCAL NOON of race day: format THAT with the local-getter
 *   date helpers, never the UTC instant.
 *
 * `nextChangeMs` is the scheduling contract: the first instant at which the
 * rendered value can differ, so a caller ticks exactly when the display can
 * change and never otherwise. Paused weeks never move the race.
 */

export type RaceCountdownPhase = "weeks" | "days" | "eve" | "raceDay" | "done";

export type RaceCountdown = {
  phase: RaceCountdownPhase;
  /** Whole LOCAL calendar days from today to race day: 0 on race day, negative after. */
  days: number;
  /** ceil(days / 7), floored at 0 — the legacy "N weeks" figure. */
  weeks: number;
  /** Local 00:00 of race day — the instant the countdown reaches zero. */
  raceStartMs: number;
  /** Local NOON of race day — format this, never the UTC instant. */
  raceDayMs: number;
  /** raceStartMs − nowMs, clamped at 0. */
  remainingMs: number;
  /** Floor decomposition of remainingMs; hours are uncapped (25 on a fall-back eve). */
  hours: number;
  minutes: number;
  seconds: number;
  /** days 0..6 — the week brief's "race week" rule. */
  isRaceWeek: boolean;
  /** Epoch ms, strictly after nowMs, at which the rendered value next changes; null once done. */
  nextChangeMs: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Inside the taper the count is in days, not weeks. */
export const DAYS_BAND_MAX = 14;
/** On the eve the clock shows seconds only inside the final hour. */
export const SECONDS_UNDER_MS = HOUR_MS;

type Ymd = [year: number, month: number, day: number];

/** The event's calendar date, or null for anything that is not a real date. */
function raceYmd(eventDate: string | number): Ymd | null {
  let ymd: string;
  if (typeof eventDate === "number") {
    if (!Number.isFinite(eventDate)) return null;
    // Valid precisely because the server stores a DATE: the instant is UTC
    // midnight, so its UTC date parts ARE the calendar date.
    ymd = new Date(eventDate).toISOString().slice(0, 10);
  } else {
    ymd = eventDate.slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // "2026-13-45" passes the regex; the Date constructor would silently roll
  // it into 2027. Round-trip the parts to reject it.
  const probe = new Date(y, mo - 1, d, 12);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d)
    return null;
  return [y, mo, d];
}

function localMs(ymd: Ymd, hour: number, dayOffset = 0): number {
  return new Date(ymd[0], ymd[1] - 1, ymd[2] + dayOffset, hour, 0, 0, 0).getTime();
}

function localYmd(ms: number): Ymd {
  const t = new Date(ms);
  return [t.getFullYear(), t.getMonth() + 1, t.getDate()];
}

/**
 * The first local midnight strictly after `nowMs`. Built from the local
 * calendar date, so an exact midnight yields the NEXT one, and a fall-back
 * day's midnight is 25 real hours after the previous.
 */
export function nextLocalMidnightMs(nowMs: number): number {
  return localMs(localYmd(nowMs), 0, 1);
}

export function raceCountdown(eventDate: string | number, nowMs: number): RaceCountdown | null {
  if (!Number.isFinite(nowMs)) return null;
  const race = raceYmd(eventDate);
  if (!race) return null;

  const raceStartMs = localMs(race, 0);
  const raceDayMs = localMs(race, 12);
  const todayNoonMs = localMs(localYmd(nowMs), 12);
  const days = Math.round((raceDayMs - todayNoonMs) / DAY_MS);
  const weeks = Math.max(0, Math.ceil(days / 7));
  const remainingMs = Math.max(0, raceStartMs - nowMs);
  const hours = Math.floor(remainingMs / HOUR_MS);
  const minutes = Math.floor((remainingMs % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((remainingMs % MINUTE_MS) / 1000);

  let phase: RaceCountdownPhase;
  let nextChangeMs: number | null;
  if (days < 0) {
    phase = "done";
    nextChangeMs = null;
  } else if (days === 0) {
    phase = "raceDay";
    nextChangeMs = localMs(race, 0, 1);
  } else if (days === 1) {
    phase = "eve";
    // Tick on the display's own boundaries: the next whole minute, or the
    // next whole second inside the final hour — and land on zero exactly.
    const unit = remainingMs < SECONDS_UNDER_MS ? 1000 : MINUTE_MS;
    nextChangeMs = nowMs + (remainingMs % unit || unit);
  } else if (days <= DAYS_BAND_MAX) {
    phase = "days";
    nextChangeMs = nextLocalMidnightMs(nowMs);
  } else {
    phase = "weeks";
    nextChangeMs = nextLocalMidnightMs(nowMs);
  }

  return {
    phase,
    days,
    weeks,
    raceStartMs,
    raceDayMs,
    remainingMs,
    hours,
    minutes,
    seconds,
    isRaceWeek: days >= 0 && days <= 6,
    nextChangeMs,
  };
}

/** The eve clock: "6h 42m" (hours uncapped) while an hour or more remains, "42:10" below it. */
export function formatRemaining(remainingMs: number): string {
  const ms = Math.max(0, remainingMs);
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((ms % MINUTE_MS) / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return hours >= 1 ? `${hours}h ${two(minutes)}m` : `${two(minutes)}:${two(seconds)}`;
}

/**
 * One line for the compact surfaces.
 *   short: "29 wks" | "1 wk" | "12 days" | "Tomorrow" | "Today" | "Raced"
 *   long:  "29 wks to go" | "12 days to go" | "Tomorrow" | "Race day" | "Raced"
 */
export function countdownLabel(cd: RaceCountdown, style: "short" | "long"): string {
  switch (cd.phase) {
    case "weeks": {
      const unit = cd.weeks === 1 ? "wk" : "wks";
      return style === "short" ? `${cd.weeks} ${unit}` : `${cd.weeks} ${unit} to go`;
    }
    case "days":
      return style === "short" ? `${cd.days} days` : `${cd.days} days to go`;
    case "eve":
      return "Tomorrow";
    case "raceDay":
      return style === "short" ? "Today" : "Race day";
    case "done":
      return "Raced";
  }
}
