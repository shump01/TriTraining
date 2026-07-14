/**
 * Resolving the "effective" weekly actual from possibly several sources.
 *
 * PRECEDENCE: MANUAL > STRAVA > APPLE_HEALTH for the same (discipline, week).
 * We do NOT sum sources — a manual entry is an override, and summing would
 * double-count a session that is both auto-synced and entered by hand (or that
 * reaches us from both Strava and Apple Health). Precedence is applied at read
 * time, so a manual override survives future syncs (each sync only ever
 * replaces rows of its own source).
 */
export type ActualSource = "MANUAL" | "STRAVA" | "APPLE_HEALTH";

const SOURCE_RANK: Record<ActualSource, number> = {
  MANUAL: 3,
  STRAVA: 2,
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
 * Collapse raw WeeklyActual rows (which may include one row per source per
 * week) into one effective value per (discipline, week), highest-precedence
 * source wins.
 */
export function resolveEffectiveActuals(rows: ActualRow[]): Map<string, EffectiveActual> {
  const result = new Map<string, EffectiveActual>();
  for (const row of rows) {
    const key = effectiveActualKey(row.discipline, row.weekStartDate);
    const existing = result.get(key);
    if (!existing || SOURCE_RANK[row.source] > SOURCE_RANK[existing.source]) {
      result.set(key, { meters: row.actualMeters, source: row.source });
    }
  }
  return result;
}
