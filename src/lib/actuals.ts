/**
 * Resolving the "effective" weekly actual from possibly several sources.
 *
 * AUTO SOURCES DON'T SUM among themselves: for the same (discipline, week) the
 * highest-precedence auto source wins (STRAVA > GARMIN > APPLE_HEALTH), because
 * a single session often reaches us from more than one sync (many Garmin users
 * auto-mirror to Strava, and a workout can arrive from both Strava and Apple
 * Health) — summing them would double-count. Strava outranks Garmin so that
 * connecting Garmin never silently changes an existing Strava user's numbers.
 *
 * A MANUAL entry is DIFFERENT: it ADDS on top of the auto total rather than
 * replacing it. Manual is how the athlete tops up what a sync couldn't see — a
 * pool swim done without a watch, a treadmill run — so effective =
 * best-auto + manual. Precedence/summing are applied at read time, so a manual
 * entry survives future syncs (each sync only ever replaces rows of its own
 * source).
 */
export type ActualSource = "MANUAL" | "STRAVA" | "GARMIN" | "APPLE_HEALTH";

// Ranks the AUTO sources only; MANUAL is additive and handled separately.
const SOURCE_RANK: Record<ActualSource, number> = {
  MANUAL: 4,
  STRAVA: 3,
  GARMIN: 2,
  APPLE_HEALTH: 1,
};

export interface ActualRow {
  discipline: string;
  weekStartDate: Date;
  actualMeters: number;
  source: ActualSource;
}

export interface EffectiveActual {
  meters: number;
  source: ActualSource;
}

export function effectiveActualKey(discipline: string, weekStartDate: Date): string {
  return `${discipline}|${weekStartDate.getTime()}`;
}

/**
 * Collapse raw WeeklyActual rows (one row per source per week) into one
 * effective value per (discipline, week): the highest-precedence AUTO source
 * (never summed among themselves) PLUS any manual entry on top.
 *
 * `source` labels the primary provider — the auto source when one exists, else
 * MANUAL. The manual portion is surfaced separately by callers (plan-series
 * exposes it as `manualMeters`) so the UI can show the "synced + manual" split.
 */
export function resolveEffectiveActuals(rows: ActualRow[]): Map<string, EffectiveActual> {
  type Acc = { auto?: { meters: number; source: ActualSource }; manual: number };
  const acc = new Map<string, Acc>();
  for (const row of rows) {
    const key = effectiveActualKey(row.discipline, row.weekStartDate);
    const cur = acc.get(key) ?? { manual: 0 };
    if (row.source === "MANUAL") {
      cur.manual += row.actualMeters; // one manual row per key today, but additive is the intent
    } else if (!cur.auto || SOURCE_RANK[row.source] > SOURCE_RANK[cur.auto.source]) {
      cur.auto = { meters: row.actualMeters, source: row.source };
    }
    acc.set(key, cur);
  }

  const result = new Map<string, EffectiveActual>();
  for (const [key, a] of acc) {
    result.set(key, {
      meters: (a.auto?.meters ?? 0) + a.manual,
      source: a.auto ? a.auto.source : "MANUAL",
    });
  }
  return result;
}
