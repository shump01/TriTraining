/**
 * Weekly wellness check-in → a volume multiplier for the adaptive re-ramp.
 *
 * The plan already adapts to *how much* you trained (volume actuals). A check-in
 * adds *how you feel*: a fatigued, sore, or under-slept week eases the following
 * weeks' targets (a nudge toward recovery) instead of pushing the ramp. Pure and
 * dependency-free so it's trivially unit-tested and reused by the engine.
 */

export interface Wellness {
  /** 1 = fresh … 5 = exhausted. */
  fatigue: number;
  /** 1 = poor … 5 = great. */
  sleep: number;
  /** 1 = none … 5 = very sore. */
  soreness: number;
}

/** Largest easing applied at maximum reported load (20% off the baseline). */
export const MAX_CHECKIN_EASING = 0.2;

/**
 * Map a check-in to a multiplier in [1 − MAX_CHECKIN_EASING, 1].
 *
 * `load = fatigue + soreness + (6 − sleep)` runs 3 (great) … 15 (wrecked). Up to
 * a load of 7 there's no change (factor 1); beyond that it eases linearly to the
 * floor at the maximum load. A missing/partial check-in returns 1 (no change).
 */
export function checkinReadinessFactor(w: Wellness): number {
  const clamp = (v: number) => Math.min(5, Math.max(1, Math.round(v)));
  const fatigue = clamp(w.fatigue);
  const sleep = clamp(w.sleep);
  const soreness = clamp(w.soreness);

  const load = fatigue + soreness + (6 - sleep); // 3 … 15
  const over = Math.min(Math.max(load - 7, 0), 8); // ease past 7, saturate at 15
  return 1 - (over / 8) * MAX_CHECKIN_EASING;
}
