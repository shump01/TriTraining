import { describe, expect, it } from "vitest";

import { linearTrend, trendAt } from "./trend";

describe("linearTrend", () => {
  it("returns null with fewer than 2 points", () => {
    expect(linearTrend([])).toBeNull();
    expect(linearTrend([{ x: 0, y: 5 }])).toBeNull();
  });

  it("returns null when every x is identical (no slope)", () => {
    expect(
      linearTrend([
        { x: 2, y: 1 },
        { x: 2, y: 9 },
      ]),
    ).toBeNull();
  });

  it("recovers a perfect upward line and projects it forward", () => {
    const trend = linearTrend([
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ])!;
    expect(trend.slope).toBeCloseTo(10);
    expect(trend.intercept).toBeCloseTo(0);
    expect(trendAt(trend, 5)).toBeCloseTo(50); // projection beyond the data
  });

  it("recovers a downward line", () => {
    const trend = linearTrend([
      { x: 0, y: 100 },
      { x: 1, y: 80 },
      { x: 2, y: 60 },
    ])!;
    expect(trend.slope).toBeCloseTo(-20);
    expect(trendAt(trend, 4)).toBeCloseTo(20);
  });

  it("fits a best line through noisy points (least squares)", () => {
    // (0,1)(1,3)(2,3)(3,5): slope 1.2, intercept 1.2 by hand.
    const trend = linearTrend([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 5 },
    ])!;
    expect(trend.slope).toBeCloseTo(1.2);
    expect(trend.intercept).toBeCloseTo(1.2);
    expect(trendAt(trend, 4)).toBeCloseTo(6);
  });
});
