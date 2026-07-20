import { describe, expect, it } from "vitest";

import {
  activityCountsForWeek,
  buildWeekView,
  dayLabels,
  defaultWeekLayout,
  type PlannerSessionSpec,
} from "./week-planner";

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 6, 20); // Monday 2026-07-20

function spec(overrides: Partial<PlannerSessionSpec> & { done?: boolean } = {}) {
  return {
    discipline: "RUN" as const,
    slot: 0,
    label: "Long run",
    share: 0.4,
    dayOffset: 6,
    done: false,
    ...overrides,
  };
}

describe("dayLabels", () => {
  it("rotates the calendar names to the plan's week start", () => {
    expect(dayLabels(1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(dayLabels(0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(dayLabels(6)).toEqual(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  });
});

describe("defaultWeekLayout", () => {
  it("lays each discipline's template onto its conventional calendar days", () => {
    const specs = defaultWeekLayout(
      [
        { discipline: "RUN", weekMeters: 40_000 },
        { discipline: "BIKE", weekMeters: 120_000 },
      ],
      1, // Monday-start week
    );
    // Long run belongs on Sunday — offset 6 in a Monday week.
    const longRun = specs.find((s) => s.label === "Long run");
    expect(longRun).toMatchObject({ discipline: "RUN", slot: 0, share: 0.4, dayOffset: 6 });
    // Long ride on Saturday — offset 5 in a Monday week.
    expect(specs.find((s) => s.label === "Long ride")).toMatchObject({ dayOffset: 5 });
    // 3 sessions per discipline with volume.
    expect(specs).toHaveLength(6);
  });

  it("anchors to CALENDAR days regardless of week start", () => {
    // Sunday-start week: the Sunday long run is day 0, Saturday ride day 6.
    const specs = defaultWeekLayout([{ discipline: "RUN", weekMeters: 1 }], 0);
    expect(specs.find((s) => s.label === "Long run")!.dayOffset).toBe(0);
    const bike = defaultWeekLayout([{ discipline: "BIKE", weekMeters: 1 }], 0);
    expect(bike.find((s) => s.label === "Long ride")!.dayOffset).toBe(6);
  });

  it("skips disciplines without volume", () => {
    expect(defaultWeekLayout([{ discipline: "SWIM", weekMeters: 0 }], 1)).toEqual([]);
  });
});

describe("buildWeekView — distances", () => {
  it("shares × target with the remainder on the last slot, summing exactly", () => {
    const sessions = [
      spec({ slot: 0, share: 0.4 }),
      spec({ slot: 1, label: "Tempo", share: 0.3, dayOffset: 1 }),
      spec({ slot: 2, label: "Easy", share: 0.3, dayOffset: 3 }),
    ];
    const view = buildWeekView(sessions, { RUN: 40_001 }, []);
    const meters = view.map((v) => v.meters);
    expect(meters.reduce((a, b) => a + b, 0)).toBe(40_001);
    expect(view.find((v) => v.slot === 0)!.meters).toBe(16_000);
  });

  it("re-ramped targets rescale stored sessions automatically", () => {
    const sessions = [spec({ slot: 0, share: 0.5 }), spec({ slot: 1, share: 0.5, dayOffset: 2 })];
    const before = buildWeekView(sessions, { RUN: 30_000 }, []);
    const after = buildWeekView(sessions, { RUN: 24_000 }, []);
    expect(before.find((v) => v.slot === 0)!.meters).toBe(15_000);
    expect(after.find((v) => v.slot === 0)!.meters).toBe(12_000);
  });

  it("a discipline with no target yields zero-distance sessions, not crashes", () => {
    const view = buildWeekView([spec()], {}, []);
    expect(view[0]!.meters).toBe(0);
  });
});

describe("buildWeekView — auto-completion", () => {
  it("ticks a session when an activity of that discipline landed that day", () => {
    const view = buildWeekView([spec({ dayOffset: 6 })], { RUN: 16_000 }, [
      { dayOffset: 6, discipline: "RUN", count: 1 },
    ]);
    expect(view[0]!.auto).toBe(true);
    expect(view[0]!.done).toBe(false); // manual tick untouched
  });

  it("is count-based: one activity cannot tick a double day twice", () => {
    const sessions = [
      spec({ slot: 0, dayOffset: 2 }),
      spec({ slot: 1, label: "Easy", share: 0.3, dayOffset: 2 }),
    ];
    const one = buildWeekView(sessions, { RUN: 30_000 }, [
      { dayOffset: 2, discipline: "RUN", count: 1 },
    ]);
    expect(one.filter((v) => v.auto)).toHaveLength(1);
    // The earlier slot ticks first.
    expect(one.find((v) => v.auto)!.slot).toBe(0);

    const two = buildWeekView(sessions, { RUN: 30_000 }, [
      { dayOffset: 2, discipline: "RUN", count: 2 },
    ]);
    expect(two.filter((v) => v.auto)).toHaveLength(2);
  });

  it("never crosses disciplines or days", () => {
    const view = buildWeekView([spec({ dayOffset: 3 })], { RUN: 16_000 }, [
      { dayOffset: 3, discipline: "BIKE", count: 1 },
      { dayOffset: 4, discipline: "RUN", count: 1 },
    ]);
    expect(view[0]!.auto).toBe(false);
  });
});

describe("assembleWeekView — per-discipline merge", () => {
  const storedRun = [
    {
      discipline: "RUN",
      slot: 0,
      label: "Long run",
      share: 0.4,
      dayOffset: 5,
      completedAt: new Date(),
    },
    { discipline: "RUN", slot: 1, label: "Tempo", share: 0.3, dayOffset: 1, completedAt: null },
    { discipline: "RUN", slot: 2, label: "Easy", share: 0.3, dayOffset: 3, completedAt: null },
  ];

  it("a discipline added to the plan AFTER the week materialized still shows", async () => {
    const { assembleWeekView } = await import("./week-planner");
    const view = assembleWeekView({
      weekStartMs: MONDAY,
      weekStartDay: 1,
      stored: storedRun, // only RUN was materialized
      targets: [
        { discipline: "RUN", weekMeters: 40_000 },
        { discipline: "BIKE", weekMeters: 90_000 }, // added later via plan edit
      ],
      loadRows: [],
    });
    // RUN keeps the athlete's customized layout (long run moved to Saturday)…
    expect(view.find((v) => v.discipline === "RUN" && v.slot === 0)).toMatchObject({
      dayOffset: 5,
      done: true,
    });
    // …and BIKE falls back to its default layout instead of vanishing.
    expect(view.filter((v) => v.discipline === "BIKE")).toHaveLength(3);
  });

  it("stored rows for a discipline with no target are dropped, never rendered as ghosts", async () => {
    const { assembleWeekView } = await import("./week-planner");
    const view = assembleWeekView({
      weekStartMs: MONDAY,
      weekStartDay: 1,
      stored: storedRun,
      targets: [{ discipline: "BIKE", weekMeters: 90_000 }], // RUN removed from plan
      loadRows: [],
    });
    expect(view.some((v) => v.discipline === "RUN")).toBe(false);
    expect(view.filter((v) => v.discipline === "BIKE")).toHaveLength(3);
  });
});

describe("activityCountsForWeek", () => {
  it("buckets rows onto day offsets and drops rows outside the week", () => {
    const rows = [
      { date: new Date(MONDAY), discipline: "RUN" },
      { date: new Date(MONDAY + 2 * DAY_MS), discipline: "BIKE" },
      { date: new Date(MONDAY + 2 * DAY_MS), discipline: "BIKE" },
      { date: new Date(MONDAY - DAY_MS), discipline: "RUN" }, // previous week
      { date: new Date(MONDAY + 7 * DAY_MS), discipline: "RUN" }, // next week
    ];
    const counts = activityCountsForWeek(rows, MONDAY);
    expect(counts).toHaveLength(2);
    expect(counts.find((c) => c.discipline === "RUN")).toMatchObject({ dayOffset: 0, count: 1 });
    expect(counts.find((c) => c.discipline === "BIKE")).toMatchObject({ dayOffset: 2, count: 2 });
  });
});
