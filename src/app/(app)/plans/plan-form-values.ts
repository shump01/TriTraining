/**
 * Plain (non-"use client") module for `PlanForm`'s value shape and defaults.
 *
 * A file marked "use client" turns ALL of its exports into client references
 * when imported by a Server Component — including plain, non-component
 * functions. `emptyPlanFormValues()` is called directly (not rendered) by the
 * server-rendered `new/page.tsx`, so it must live outside plan-form.tsx.
 */

export type DiscKey = "SWIM" | "BIKE" | "RUN";

export interface PlanFormValues {
  name: string;
  startDate: string; // YYYY-MM-DD ("" => defaults to this week)
  eventDate: string; // YYYY-MM-DD
  capMultiple: string; // e.g. "1.5" — weekly volume never exceeds this × event distance
  weekStartDay: string; // "0"=Sun..."6"=Sat — the day training weeks begin on
  disciplines: Record<DiscKey, { enabled: boolean; event: string; start: string }>;
}

/** Sensible defaults for a brand-new plan. */
export function emptyPlanFormValues(): PlanFormValues {
  return {
    name: "",
    startDate: "",
    eventDate: "",
    capMultiple: "1.5",
    weekStartDay: "1", // Monday
    disciplines: {
      SWIM: { enabled: true, event: "", start: "" },
      BIKE: { enabled: true, event: "", start: "" },
      RUN: { enabled: true, event: "", start: "" },
    },
  };
}
