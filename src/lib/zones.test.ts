import { describe, expect, it } from "vitest";

import { buildIntensityDistribution, hrZone } from "@/lib/zones";

// Every case uses an LTHR of 150, so the Friel band floors land on:
//   Z2 121.5 (81%) · Z3 135 (90%) · Z4 141 (94%) · Z5 150 (100%)
const LTHR = 150;
const HOUR = 3600;

/** N one-hour sessions at a given average HR. */
const hours = (n: number, avgHr: number) =>
  Array.from({ length: n }, () => ({ movingSeconds: HOUR, avgHr }));

describe("hrZone", () => {
  it("bands average HR against threshold", () => {
    expect(hrZone(110, LTHR)).toBe(1); // 73%
    expect(hrZone(128, LTHR)).toBe(2); // 85%
    expect(hrZone(137, LTHR)).toBe(3); // 91%
    expect(hrZone(145, LTHR)).toBe(4); // 97%
    expect(hrZone(158, LTHR)).toBe(5); // 105%
  });

  it("puts each band floor in the higher zone", () => {
    expect(hrZone(121.5, LTHR)).toBe(2);
    expect(hrZone(135, LTHR)).toBe(3);
    expect(hrZone(141, LTHR)).toBe(4);
    expect(hrZone(150, LTHR)).toBe(5);
  });

  it("returns null for unusable inputs", () => {
    expect(hrZone(0, LTHR)).toBeNull();
    expect(hrZone(140, 0)).toBeNull();
  });
});

describe("buildIntensityDistribution", () => {
  it("returns null without a threshold or anything to score", () => {
    expect(buildIntensityDistribution(hours(3, 120), 0)).toBeNull();
    expect(buildIntensityDistribution([], LTHR)).toBeNull();
    // HR-less or zero-length activities are not scorable.
    expect(buildIntensityDistribution([{ movingSeconds: HOUR, avgHr: 0 }], LTHR)).toBeNull();
    expect(buildIntensityDistribution([{ movingSeconds: 0, avgHr: 120 }], LTHR)).toBeNull();
  });

  it("splits time across the three polarized bands", () => {
    // Four easy hours + one hard hour = the textbook 80/20.
    const d = buildIntensityDistribution([...hours(4, 110), ...hours(1, 158)], LTHR)!;
    expect(d.easyPct).toBe(80);
    expect(d.greyPct).toBe(0);
    expect(d.hardPct).toBe(20);
    expect(d.totalSeconds).toBe(5 * HOUR);
    expect(d.activityCount).toBe(5);
    expect(d.verdict.key).toBe("polarized");
  });

  it("always reports all five zones, zeroes included", () => {
    const d = buildIntensityDistribution(hours(2, 110), LTHR)!;
    expect(d.buckets.map((b) => b.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(d.buckets.find((b) => b.zone === 1)!.pct).toBe(100);
    expect(d.buckets.find((b) => b.zone === 5)!.seconds).toBe(0);
  });

  it("flags a grey-zone-heavy block", () => {
    // Half the time averaging at tempo.
    const d = buildIntensityDistribution([...hours(2, 110), ...hours(2, 137)], LTHR)!;
    expect(d.greyPct).toBe(50);
    expect(d.verdict.key).toBe("greyZone");
  });

  it("flags a block with too little easy volume", () => {
    const d = buildIntensityDistribution([...hours(1, 110), ...hours(2, 145)], LTHR)!;
    expect(d.easyPct).toBe(33);
    expect(d.verdict.key).toBe("tooHard");
  });

  it("calls a near-80/20 block balanced rather than polarized", () => {
    // 70% easy / 10% grey / 20% hard — fine, but not the polarized shape.
    const d = buildIntensityDistribution(
      [
        { movingSeconds: 7000, avgHr: 110 },
        { movingSeconds: 1000, avgHr: 137 },
        { movingSeconds: 2000, avgHr: 145 },
      ],
      LTHR,
    )!;
    expect([d.easyPct, d.greyPct, d.hardPct]).toEqual([70, 10, 20]);
    expect(d.verdict.key).toBe("balanced");
  });

  it("weights by duration, not by session count", () => {
    // One long easy ride outweighs two short hard efforts.
    const d = buildIntensityDistribution(
      [
        { movingSeconds: 4 * HOUR, avgHr: 110 },
        { movingSeconds: 600, avgHr: 158 },
        { movingSeconds: 600, avgHr: 158 },
      ],
      LTHR,
    )!;
    expect(d.easyPct).toBeGreaterThan(85);
    expect(d.activityCount).toBe(3);
  });

  it("skips unscorable activities without dropping the rest", () => {
    const d = buildIntensityDistribution(
      [...hours(2, 110), { movingSeconds: HOUR, avgHr: 0 }],
      LTHR,
    )!;
    expect(d.activityCount).toBe(2);
    expect(d.totalSeconds).toBe(2 * HOUR);
  });
});
