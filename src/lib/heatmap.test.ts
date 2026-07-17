import { describe, expect, it } from "vitest";

import { buildHeatmap, type HeatmapWeek } from "@/lib/heatmap";

type S = "ahead" | "onTrack" | "behind" | null;
type P = "past" | "current" | "future";
let ms = 0;
const wk = (phase: P, status: S, pct: number | null = status ? 100 : null): HeatmapWeek => ({
  ms: (ms += 7 * 24 * 60 * 60 * 1000),
  phase,
  pctOfTarget: pct,
  status,
});

describe("buildHeatmap", () => {
  it("counts completed weeks and hits (onTrack/ahead), ignoring current/future", () => {
    const h = buildHeatmap([
      wk("past", "onTrack"),
      wk("past", "behind"),
      wk("past", "ahead"),
      wk("current", "behind"),
      wk("future", null),
    ]);
    expect(h.weeksCompleted).toBe(3);
    expect(h.weeksHit).toBe(2);
    expect(h.cells).toHaveLength(5);
  });

  it("computes the current streak from the most recent completed weeks", () => {
    // hits: yes, no, yes, yes  → current streak 2 (last two), best 2.
    const h = buildHeatmap([
      wk("past", "onTrack"),
      wk("past", "behind"),
      wk("past", "ahead"),
      wk("past", "onTrack"),
    ]);
    expect(h.currentStreak).toBe(2);
    expect(h.bestStreak).toBe(2);
  });

  it("breaks the current streak on the last completed week, but keeps best", () => {
    // hits: yes, yes, yes, no  → current 0, best 3.
    const h = buildHeatmap([
      wk("past", "ahead"),
      wk("past", "onTrack"),
      wk("past", "onTrack"),
      wk("past", "behind"),
    ]);
    expect(h.currentStreak).toBe(0);
    expect(h.bestStreak).toBe(3);
  });

  it("does not count the in-progress current week toward the streak", () => {
    // Two completed hits, then a strong current week (still open).
    const h = buildHeatmap([wk("past", "onTrack"), wk("past", "ahead"), wk("current", "ahead")]);
    expect(h.currentStreak).toBe(2);
    expect(h.weeksCompleted).toBe(2);
  });

  it("handles a plan that hasn't started (all future)", () => {
    const h = buildHeatmap([wk("future", null), wk("future", null)]);
    expect(h.weeksCompleted).toBe(0);
    expect(h.weeksHit).toBe(0);
    expect(h.currentStreak).toBe(0);
    expect(h.bestStreak).toBe(0);
  });
});

describe("buildHeatmap — paused weeks (time off)", () => {
  const paused = (): HeatmapWeek => ({ ...wk("past", "behind", 0), paused: true });

  it("does not count time off as a completed week or a miss", () => {
    const h = buildHeatmap([wk("past", "onTrack"), paused(), wk("past", "onTrack")]);
    // Two weeks were expected, two were hit — the illness is not a 0/3.
    expect(h.weeksCompleted).toBe(2);
    expect(h.weeksHit).toBe(2);
  });

  it("keeps a streak alive across time off rather than breaking it", () => {
    // The pause feature promises time off never counts against you; a streak
    // reset would contradict the "Paused" pill the same page renders.
    const h = buildHeatmap([
      wk("past", "onTrack"),
      wk("past", "onTrack"),
      paused(),
      paused(),
      wk("past", "onTrack"),
    ]);
    expect(h.currentStreak).toBe(3);
    expect(h.bestStreak).toBe(3);
  });

  it("still breaks a streak on a genuinely missed week", () => {
    const h = buildHeatmap([wk("past", "onTrack"), wk("past", "behind"), wk("past", "onTrack")]);
    expect(h.currentStreak).toBe(1);
  });

  it("marks the cell as paused so it can render as neither hit nor miss", () => {
    const h = buildHeatmap([paused()]);
    expect(h.cells[0]!.paused).toBe(true);
    expect(h.cells[0]!.hit).toBe(false);
  });

  it("a plan spent entirely on the sofa reports nothing expected, not total failure", () => {
    const h = buildHeatmap([paused(), paused()]);
    expect(h.weeksCompleted).toBe(0);
    expect(h.weeksHit).toBe(0);
    expect(h.currentStreak).toBe(0);
  });
});
