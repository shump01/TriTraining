import { describe, expect, it } from "vitest";

import { MAX_CHECKIN_EASING, checkinReadinessFactor } from "@/lib/checkin";

describe("checkinReadinessFactor", () => {
  it("does not change the ramp for a fresh, well-rested week", () => {
    // load = 1 + 1 + (6-5) = 3 → below the easing threshold.
    expect(checkinReadinessFactor({ fatigue: 1, sleep: 5, soreness: 1 })).toBe(1);
  });

  it("does not ease until load exceeds 7", () => {
    // load = 3 + 3 + (6-5) = 7 → still no change.
    expect(checkinReadinessFactor({ fatigue: 3, sleep: 5, soreness: 3 })).toBe(1);
  });

  it("applies the maximum easing when maximally beat-up", () => {
    // fatigue 5, soreness 5, sleep 1 → load 15 → floor.
    expect(checkinReadinessFactor({ fatigue: 5, sleep: 1, soreness: 5 })).toBeCloseTo(
      1 - MAX_CHECKIN_EASING,
      10,
    );
  });

  it("eases proportionally in between", () => {
    // load = 4 + 4 + (6-3) = 11 → over = 4 → 1 - (4/8)*0.2 = 0.9.
    expect(checkinReadinessFactor({ fatigue: 4, sleep: 3, soreness: 4 })).toBeCloseTo(0.9, 10);
  });

  it("never eases below the floor and never boosts above 1", () => {
    for (let f = 1; f <= 5; f++) {
      for (let s = 1; s <= 5; s++) {
        for (let so = 1; so <= 5; so++) {
          const factor = checkinReadinessFactor({ fatigue: f, sleep: s, soreness: so });
          expect(factor).toBeLessThanOrEqual(1);
          expect(factor).toBeGreaterThanOrEqual(1 - MAX_CHECKIN_EASING);
        }
      }
    }
  });
});
