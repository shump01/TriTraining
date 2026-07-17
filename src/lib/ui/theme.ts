/**
 * Shared UI constants for the redesign. Colors reference the runtime CSS
 * variables defined in globals.css, so they follow the active (dark/light) theme.
 */

export type DisciplineKey = "SWIM" | "BIKE" | "RUN";

export const DISCIPLINE_META: Record<
  DisciplineKey,
  { label: string; color: string; icon: string }
> = {
  SWIM: { label: "Swim", color: "var(--swim)", icon: "🏊" },
  BIKE: { label: "Bike", color: "var(--bike)", icon: "🚲" },
  RUN: { label: "Run", color: "var(--run)", icon: "🏃" },
};

export const TOTAL_META = { label: "All sports", color: "var(--brand)" } as const;

/** Matches the status keys produced by src/lib/progress.ts (+ "upcoming" for future weeks). */
export type StatusKey = "ahead" | "onTrack" | "behind" | "upcoming";

export const STATUS_META: Record<StatusKey, { label: string; color: string }> = {
  ahead: { label: "Ahead", color: "var(--ahead)" },
  onTrack: { label: "On track", color: "var(--on-track)" },
  behind: { label: "Behind", color: "var(--behind)" },
  upcoming: { label: "Upcoming", color: "var(--upcoming)" },
};

/** The status pill for a plan/series summary — "upcoming" until it has started. */
export function planStatusKey(summary: { started: boolean; status: StatusKey | null }): StatusKey {
  return summary.started ? (summary.status ?? "onTrack") : "upcoming";
}

/** A translucent version of any CSS color (works with var() colors + the theme). */
export function translucent(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/** Format meters for display: swim in meters, bike/run in km. */
export function formatDistance(meters: number, discipline: DisciplineKey | "TOTAL"): string {
  if (discipline === "SWIM") return `${meters.toLocaleString()} m`;
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1)} km`;
}
