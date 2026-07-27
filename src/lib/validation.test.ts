import { describe, expect, it } from "vitest";

import { createPlanSchema } from "./validation";

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
});
