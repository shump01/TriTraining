/**
 * Which plan the dashboard leads with when an athlete has several.
 *
 * The old rule was "the nearest upcoming event", which quietly featured the
 * *least* important plan: a June C-race tune-up would hide a September A-race,
 * even though the A build is the thing actually being executed (a B/C race is a
 * hard session inside it). Priority is exactly the field that settles this, so
 * it leads the ranking.
 *
 * Order of preference:
 *   1. plans already underway, over ones that haven't started yet;
 *   2. then priority — A (goal) over B over C;
 *   3. then the nearest race, to break ties.
 *
 * Finished plans are never ranked: once every event has passed there is nothing
 * to feature, so the page can say so rather than show a stale plan at "0 weeks
 * to go". Pure — no DB / framework — and shared by the web dashboard and the
 * mobile dashboard endpoint so the two can't drift apart.
 */

export interface FeaturedPlanInput {
  /** UTC ms of the event date. */
  eventMs: number;
  /** UTC ms of week 1's start. */
  startMs: number;
  /** Season priority: "A" (goal race), "B", or "C" (tune-up). */
  priority: string;
}

const PRIORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };
/** An unrecognised priority sorts behind every known one rather than throwing. */
const PRIORITY_LAST = 3;

/** Sort keys, compared in order. Lower wins. */
function rank(p: FeaturedPlanInput, nowMs: number): number[] {
  return [
    p.startMs <= nowMs ? 0 : 1, // underway beats not-yet-started
    PRIORITY_ORDER[p.priority] ?? PRIORITY_LAST, // A > B > C
    p.eventMs, // then the nearest race
  ];
}

/**
 * The athlete's live plans (event not yet passed), best first — the one to
 * feature, then the rest in the order they deserve attention. Finished plans are
 * dropped; the plans page is where history lives. Generic so callers get their
 * own richer plan type back.
 */
export function rankLivePlans<T extends FeaturedPlanInput>(plans: T[], nowMs: number): T[] {
  // A plan stays live through its event day; after that it's history.
  return plans
    .filter((p) => p.eventMs >= nowMs)
    .sort((a, b) => {
      const ra = rank(a, nowMs);
      const rb = rank(b, nowMs);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
      }
      return 0;
    });
}

/** The single plan to lead with, or null when nothing is live. */
export function pickFeaturedPlan<T extends FeaturedPlanInput>(plans: T[], nowMs: number): T | null {
  return rankLivePlans(plans, nowMs)[0] ?? null;
}
