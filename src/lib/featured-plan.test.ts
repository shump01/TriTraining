import { describe, expect, it } from "vitest";

import { pickFeaturedPlan, rankLivePlans } from "@/lib/featured-plan";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 6, 16); // a Thursday

/** A plan: started `startWeeksAgo` back, racing in `eventWeeks`. */
function plan(
  id: string,
  priority: string,
  eventWeeks: number,
  startWeeksAgo = 4,
): { id: string; priority: string; eventMs: number; startMs: number } {
  return {
    id,
    priority,
    eventMs: NOW + eventWeeks * WEEK,
    startMs: NOW - startWeeksAgo * WEEK,
  };
}

describe("pickFeaturedPlan", () => {
  it("returns null with no plans, or once every race is behind you", () => {
    expect(pickFeaturedPlan([], NOW)).toBeNull();
    expect(pickFeaturedPlan([plan("a", "A", -1), plan("b", "B", -8)], NOW)).toBeNull();
  });

  it("features the sole live plan", () => {
    expect(pickFeaturedPlan([plan("a", "A", 10)], NOW)?.id).toBe("a");
  });

  it("features the goal race over a nearer tune-up — the old rule's bug", () => {
    // The C race is 4 weeks out, the A race 16. "Nearest event" would pick the
    // tune-up and hide the actual goal; priority has to win.
    const picked = pickFeaturedPlan([plan("tuneup", "C", 4), plan("goal", "A", 16)], NOW);
    expect(picked?.id).toBe("goal");
  });

  it("ranks A over B over C", () => {
    const ranked = rankLivePlans([plan("c", "C", 6), plan("a", "A", 6), plan("b", "B", 6)], NOW);
    expect(ranked.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on the nearest race", () => {
    const ranked = rankLivePlans([plan("far", "A", 20), plan("near", "A", 3)], NOW);
    expect(ranked.map((p) => p.id)).toEqual(["near", "far"]);
  });

  it("prefers a plan underway over a higher-priority one that hasn't begun", () => {
    // The A build starts next month; the B plan is what's actually being trained.
    const notStarted = { ...plan("future-goal", "A", 30), startMs: NOW + 4 * WEEK };
    const picked = pickFeaturedPlan([notStarted, plan("underway", "B", 8)], NOW);
    expect(picked?.id).toBe("underway");
  });

  it("still features a not-yet-started plan when nothing is underway", () => {
    const notStarted = { ...plan("soon", "A", 30), startMs: NOW + 2 * WEEK };
    expect(pickFeaturedPlan([notStarted], NOW)?.id).toBe("soon");
  });

  it("keeps a plan live through its event day", () => {
    expect(pickFeaturedPlan([{ ...plan("today", "A", 0), eventMs: NOW }], NOW)?.id).toBe("today");
  });

  it("sorts an unknown priority behind every known one", () => {
    const ranked = rankLivePlans([plan("weird", "Z", 2), plan("c", "C", 12)], NOW);
    expect(ranked.map((p) => p.id)).toEqual(["c", "weird"]);
  });

  it("does not mutate the caller's array", () => {
    const plans = [plan("c", "C", 2), plan("a", "A", 9)];
    const before = plans.map((p) => p.id);
    rankLivePlans(plans, NOW);
    expect(plans.map((p) => p.id)).toEqual(before);
  });
});

describe("rankLivePlans", () => {
  it("drops finished plans and leads with the featured one", () => {
    const ranked = rankLivePlans(
      [plan("done", "A", -2), plan("c", "C", 5), plan("a", "A", 12)],
      NOW,
    );
    expect(ranked.map((p) => p.id)).toEqual(["a", "c"]);
    // The head is exactly what pickFeaturedPlan returns.
    expect(ranked[0]!.id).toBe(pickFeaturedPlan([plan("c", "C", 5), plan("a", "A", 12)], NOW)?.id);
  });
});
