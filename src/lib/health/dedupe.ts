import { mapSportTypeToDiscipline } from "@/lib/strava/sync-core";

import type { HealthWorkoutInput } from "./core";

/**
 * Collapsing the SAME physical session appearing more than once in Apple Health.
 *
 * HealthKit is a shared store that any app may write to, and it does not
 * reconcile: a ride recorded on a Garmin bike computer arrives once from Garmin
 * Connect and again from Strava (which the same ride also uploaded to), as two
 * HKWorkouts with different UUIDs. Both are genuine records of one ride, and
 * summing them doubles the week.
 *
 * This is NOT the cross-source case handled by src/lib/actuals.ts. That one
 * ranks STRAVA over GARMIN over APPLE_HEALTH so a session reaching us through
 * two syncs counts once. Here the duplication is INSIDE a single source's
 * batch, below the level precedence can see — every copy is APPLE_HEALTH.
 *
 * There is no reliable identity to join on. UUIDs differ per writing app,
 * distances differ by rounding (81,412 m vs 81,470 m for one ride), and
 * durations differ because one app reports elapsed and another moving time. So
 * the rule is behavioural: two workouts in the same discipline that occupy the
 * same stretch of the clock are the same session, because an athlete cannot do
 * two of them at once.
 */

/**
 * Minimum share of the SHORTER workout that must overlap before two workouts
 * are called one session. A plain "any overlap" test would merge genuinely
 * separate back-to-back sessions that touch by a second — a track session
 * recorded as two efforts, or a brick's bike leg bleeding into its run. Half
 * the shorter session is far past what sloppy boundaries produce and far below
 * what two records of one ride share (they overlap ~100%).
 */
const MIN_OVERLAP_RATIO = 0.5;

/**
 * Fallback when either workout lacks a duration (older app builds send
 * distance only, so no interval can be built). Two same-discipline sessions
 * starting within two minutes of each other is not something an athlete does;
 * two apps writing one ride routinely differ by a few seconds.
 */
const START_TOLERANCE_MS = 120_000;

type Span = { startMs: number; endMs: number | null };

function spanOf(w: HealthWorkoutInput): Span | null {
  const startMs = Date.parse(w.startDateLocal);
  if (!Number.isFinite(startMs)) return null;
  const seconds = w.movingSeconds;
  return {
    startMs,
    endMs: seconds != null && seconds > 0 ? startMs + seconds * 1000 : null,
  };
}

/** Are these two workouts (already known to share a discipline) one session? */
function isSameSession(a: Span, b: Span): boolean {
  // Duration on both sides — compare the intervals properly.
  if (a.endMs != null && b.endMs != null) {
    const overlapMs = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
    if (overlapMs <= 0) return false;
    const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
    // A zero-length workout can't anchor a ratio; fall through to start
    // proximity, which is the honest test when there is no interval.
    if (shorter <= 0) return Math.abs(a.startMs - b.startMs) <= START_TOLERANCE_MS;
    return overlapMs / shorter >= MIN_OVERLAP_RATIO;
  }
  return Math.abs(a.startMs - b.startMs) <= START_TOLERANCE_MS;
}

/**
 * Which copy to keep. Longest distance wins: a duplicate pair is two records of
 * one ride, and the shorter is the truncated/rounded-down one. Duration then
 * external id break ties so the choice is deterministic — ingest is an
 * idempotent full replace, and a representative that flip-flopped between syncs
 * would make the same week's total oscillate.
 */
function isBetter(candidate: HealthWorkoutInput, incumbent: HealthWorkoutInput): boolean {
  if (candidate.distanceMeters !== incumbent.distanceMeters) {
    return candidate.distanceMeters > incumbent.distanceMeters;
  }
  const cs = candidate.movingSeconds ?? 0;
  const is = incumbent.movingSeconds ?? 0;
  if (cs !== is) return cs > is;
  return (candidate.externalId ?? "") < (incumbent.externalId ?? "");
}

/**
 * Drop duplicate records of the same session from an Apple Health batch,
 * keeping the most complete copy of each.
 *
 * Workouts whose sport we don't track are passed through untouched — they are
 * dropped downstream anyway, and clustering them would let an untracked type
 * absorb a tracked one. Same for unparseable timestamps: without a clock
 * position there is no evidence of duplication, and inventing one risks
 * deleting real training.
 */
export function dedupeHealthWorkouts(workouts: HealthWorkoutInput[]): HealthWorkoutInput[] {
  const byDiscipline = new Map<string, { workout: HealthWorkoutInput; span: Span }[]>();
  const passthrough: HealthWorkoutInput[] = [];

  for (const workout of workouts) {
    const discipline = mapSportTypeToDiscipline(workout.sportType);
    const span = discipline ? spanOf(workout) : null;
    if (!discipline || !span) {
      passthrough.push(workout);
      continue;
    }
    const bucket = byDiscipline.get(discipline);
    if (bucket) bucket.push({ workout, span });
    else byDiscipline.set(discipline, [{ workout, span }]);
  }

  const kept: HealthWorkoutInput[] = [];
  for (const bucket of byDiscipline.values()) {
    // Ascending start: a session's copies land adjacent, so one sweep comparing
    // against the cluster so far is enough for the 2-3 copies that occur in
    // practice.
    bucket.sort((x, y) => x.span.startMs - y.span.startMs);

    let leader: { workout: HealthWorkoutInput; span: Span } | null = null;
    // The cluster's full extent, not the leader's: a short copy chosen as
    // leader must not shrink the window a later copy is tested against.
    let clusterEndMs = 0;

    for (const entry of bucket) {
      const clusterSpan: Span | null = leader
        ? { startMs: leader.span.startMs, endMs: clusterEndMs || leader.span.endMs }
        : null;

      if (leader && clusterSpan && isSameSession(clusterSpan, entry.span)) {
        if (isBetter(entry.workout, leader.workout)) leader = { ...entry, span: leader.span };
        clusterEndMs = Math.max(clusterEndMs, entry.span.endMs ?? 0);
        continue;
      }

      if (leader) kept.push(leader.workout);
      leader = entry;
      clusterEndMs = entry.span.endMs ?? 0;
    }
    if (leader) kept.push(leader.workout);
  }

  return [...kept, ...passthrough];
}
