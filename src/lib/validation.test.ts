import { describe, expect, it } from "vitest";

import { actualEntrySchema, createPlanSchema } from "./validation";

/**
 * Date bounds on plan creation are a RESOURCE control, not just input hygiene:
 * the plan's week count is (eventDate − startDate) / 1 week, and every week
 * becomes rows in memory and in the database. `z.coerce.date()` accepts a raw
 * JSON number as epoch-ms, so without an upper bound one small POST could
 * generate millions of weeks. These tests pin the bounds.
 */

const DAY = 24 * 60 * 60 * 1000;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test plan",
    eventDate: new Date(Date.now() + 120 * DAY).toISOString(),
    disciplines: {
      RUN: { eventDistanceMeters: 42_195, startingWeeklyMeters: 20_000 },
    },
    ...overrides,
  };
}

describe("createPlanSchema — date bounds", () => {
  it("accepts a normal plan", () => {
    expect(createPlanSchema.safeParse(plan()).success).toBe(true);
  });

  it("rejects the DoS payload: a far-future event date as raw epoch-ms", () => {
    // 8.64e15 is the maximum representable Date — ~14 million weeks out.
    const result = createPlanSchema.safeParse(plan({ eventDate: 8_640_000_000_000_000 }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/within the next 5 years/);
  });

  it("rejects an event date beyond 5 years", () => {
    const result = createPlanSchema.safeParse(
      plan({ eventDate: new Date(Date.now() + 6 * 365 * DAY).toISOString() }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a wildly back-dated start date (the quiet row-bloat variant)", () => {
    const result = createPlanSchema.safeParse(plan({ startDate: "1000-01-01" }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/within the last 5 years/);
  });

  it("still allows legitimate back-dating to when training began", () => {
    const result = createPlanSchema.safeParse(
      plan({ startDate: new Date(Date.now() - 30 * DAY).toISOString() }),
    );
    expect(result.success).toBe(true);
  });

  it("still enforces the existing lower bounds on the event date", () => {
    expect(createPlanSchema.safeParse(plan({ eventDate: "2020-01-01" })).success).toBe(false);
    // Less than a week away.
    expect(
      createPlanSchema.safeParse(plan({ eventDate: new Date(Date.now() + 2 * DAY).toISOString() }))
        .success,
    ).toBe(false);
  });

  it("rejects a COMBINED span over MAX_PLAN_WEEKS even when each date is in bounds", () => {
    // 4 years back + 4 years out: both dates pass their own ±5-year checks,
    // but the ~417-week span would make the progression engine throw — which
    // surfaced as a 500 before this cross-field check made it a clean 400.
    const result = createPlanSchema.safeParse(
      plan({
        startDate: new Date(Date.now() - 4 * 365 * DAY).toISOString(),
        eventDate: new Date(Date.now() + 4 * 365 * DAY).toISOString(),
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/at most 300 weeks/);
  });

  it("accepts a span just under MAX_PLAN_WEEKS", () => {
    // ~295 weeks: long, but the engine accepts it and so must validation.
    const result = createPlanSchema.safeParse(
      plan({
        startDate: new Date(Date.now() - 2 * 365 * DAY).toISOString(),
        eventDate: new Date(Date.now() + (295 - 2 * 52) * 7 * DAY).toISOString(),
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("weekStartDate bounds", () => {
  const entry = (weekStartDate: unknown) => ({
    discipline: "RUN" as const,
    weekStartDate,
    actualMeters: 10_000,
  });

  it("accepts a normal week", () => {
    expect(actualEntrySchema.safeParse(entry("2026-07-20")).success).toBe(true);
  });

  it("rejects an extreme-but-parseable week that would become an Invalid Date", () => {
    // Survives z.coerce.date(), then goes Invalid once aligned to a week start
    // server-side — slipping past range checks and 500ing inside Prisma.
    const result = actualEntrySchema.safeParse(entry(8_640_000_000_000_000));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/outside the supported range/);
  });

  it("rejects a week far outside the plan window in either direction", () => {
    expect(actualEntrySchema.safeParse(entry("1500-01-01")).success).toBe(false);
    expect(actualEntrySchema.safeParse(entry("2200-01-01")).success).toBe(false);
  });
});
