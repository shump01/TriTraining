import { describe, expect, it } from "vitest";

import { buildPlanProgressInputs } from "./plan-progress";

const wk = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("buildPlanProgressInputs — optional disciplines", () => {
  it("includes only disciplines that have targets (run-only plan)", () => {
    const out = buildPlanProgressInputs({
      weeklyTargets: [
        { discipline: "RUN", weekStartDate: wk("2026-01-05"), targetMeters: 10_000 },
        { discipline: "RUN", weekStartDate: wk("2026-01-12"), targetMeters: 11_000 },
      ],
      weeklyActuals: [],
    });

    expect(out.disciplines).toEqual(["RUN"]);
    expect(out.byDiscipline.SWIM).toBeUndefined();
    expect(out.byDiscipline.BIKE).toBeUndefined();
    expect(out.byDiscipline.RUN).toHaveLength(2);
    // TOTAL equals the single discipline's targets.
    expect(out.total.map((w) => w.target)).toEqual([10_000, 11_000]);
  });

  it("orders present disciplines canonically and totals across them", () => {
    const out = buildPlanProgressInputs({
      weeklyTargets: [
        { discipline: "RUN", weekStartDate: wk("2026-01-05"), targetMeters: 5_000 },
        { discipline: "SWIM", weekStartDate: wk("2026-01-05"), targetMeters: 2_000 },
      ],
      weeklyActuals: [],
    });

    expect(out.disciplines).toEqual(["SWIM", "RUN"]);
    expect(out.total[0]!.target).toBe(7_000);
  });
});
