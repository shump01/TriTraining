/**
 * Suggested session split — turn a week's volume target for one sport into a
 * handful of concrete workouts (long / tempo / easy-ish), so the weekly number
 * becomes a to-do list. Pure and dependency-free; a starting point to follow or
 * adjust. Rounds so the sessions sum back to exactly `weekMeters`.
 */

export type SessionDiscipline = "SWIM" | "BIKE" | "RUN";

export interface SuggestedSession {
  label: string;
  meters: number;
}

const TEMPLATES: Record<SessionDiscipline, { label: string; frac: number }[]> = {
  SWIM: [
    { label: "Endurance", frac: 0.4 },
    { label: "Threshold", frac: 0.35 },
    { label: "Technique", frac: 0.25 },
  ],
  BIKE: [
    { label: "Long ride", frac: 0.45 },
    { label: "Tempo", frac: 0.3 },
    { label: "Recovery spin", frac: 0.25 },
  ],
  RUN: [
    { label: "Long run", frac: 0.4 },
    { label: "Tempo", frac: 0.3 },
    { label: "Easy", frac: 0.3 },
  ],
};

export function suggestSessions(
  discipline: SessionDiscipline,
  weekMeters: number,
): SuggestedSession[] {
  if (!(weekMeters > 0)) return [];
  const template = TEMPLATES[discipline];

  const sessions: SuggestedSession[] = [];
  let allocated = 0;
  template.forEach((t, i) => {
    // The last session absorbs the rounding remainder so the split is exact.
    const meters =
      i === template.length - 1
        ? Math.max(weekMeters - allocated, 0)
        : Math.round(weekMeters * t.frac);
    allocated += meters;
    sessions.push({ label: t.label, meters });
  });
  return sessions;
}
