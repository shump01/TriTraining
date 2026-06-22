/**
 * Resolving the "effective" weekly actual from possibly two sources.
 *
 * PRECEDENCE: a MANUAL entry **overrides** STRAVA for the same (discipline,
 * week). We do NOT sum them — manual entry is an override, and summing would
 * double-count a session that is both synced from Strava and entered by hand.
 * Precedence is applied at read time, so a manual override survives future
 * Strava syncs (sync only ever replaces STRAVA-sourced rows).
 */
export type ActualSource = "MANUAL" | "STRAVA";

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
 * Collapse raw WeeklyActual rows (which may include both a MANUAL and a STRAVA
 * row per week) into one effective value per (discipline, week), with MANUAL
 * taking priority.
 */
export function resolveEffectiveActuals(rows: ActualRow[]): Map<string, EffectiveActual> {
  const result = new Map<string, EffectiveActual>();
  for (const row of rows) {
    const key = effectiveActualKey(row.discipline, row.weekStartDate);
    const existing = result.get(key);
    // Set when empty, or when this row is MANUAL and overrides an existing STRAVA.
    if (!existing || (row.source === "MANUAL" && existing.source === "STRAVA")) {
      result.set(key, { meters: row.actualMeters, source: row.source });
    }
  }
  return result;
}
