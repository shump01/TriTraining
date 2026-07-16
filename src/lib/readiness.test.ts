import { describe, expect, it } from "vitest";

import { computeFormReadiness, computeReadiness, type ReadinessSeriesInput } from "@/lib/readiness";

// A "feels fine" check-in (low load → no subjective easing) and a "wrecked" one.
const FEELS_FINE = { fatigue: 1, sleep: 5, soreness: 1 };
const WRECKED = { fatigue: 5, sleep: 1, soreness: 5 };

type Phase = "past" | "current" | "future";
const wk = (target: number, actual: number | null, phase: Phase) => ({ target, actual, phase });

function series(
  key: ReadinessSeriesInput["key"],
  weeks: ReadinessSeriesInput["weeks"],
): ReadinessSeriesInput {
  return { key, label: key === "TOTAL" ? "Total" : key, weeks };
}

/** Six weeks: three completed (past), one current, peak two weeks ahead. */
function buildingWeeks(pastActuals: [number, number, number]): ReadinessSeriesInput["weeks"] {
  return [
    wk(100, pastActuals[0], "past"),
    wk(110, pastActuals[1], "past"),
    wk(120, pastActuals[2], "past"),
    wk(130, 0, "current"),
    wk(140, null, "future"),
    wk(150, null, "future"), // peak (index 5)
  ];
}

describe("computeReadiness — projection while building", () => {
  it("projects on-track when actuals track the plan", () => {
    const { overall } = computeReadiness([series("RUN", buildingWeeks([100, 110, 120]))]);
    expect(overall?.basis).toBe("projection");
    expect(overall?.status).toBe("onTrack");
    expect(overall?.pct).toBe(100); // trend reaches the 150 peak
    expect(overall?.recommendedPerWeekMeters).toBeNull();
    expect(overall?.weeksToPeak).toBe(2);
  });

  it("flags at-risk with a concrete weekly recommendation when trending under", () => {
    const { overall } = computeReadiness([series("RUN", buildingWeeks([80, 88, 96]))]);
    // Trend (slope 8, intercept 80) → projects 120 at the 150 peak = 80%.
    expect(overall?.status).toBe("atRisk");
    expect(overall?.pct).toBe(80);
    // Shortfall 30 over 2 weeks → add ~15/week.
    expect(overall?.recommendedPerWeekMeters).toBe(15);
  });

  it("reports ahead (no recommendation) when trending over the peak", () => {
    const { overall } = computeReadiness([series("RUN", buildingWeeks([110, 125, 140]))]);
    expect(overall?.status).toBe("ahead");
    expect(overall?.pct).toBeGreaterThan(110);
    expect(overall?.recommendedPerWeekMeters).toBeNull();
  });

  it("is insufficient with fewer than two completed weeks", () => {
    const weeks = [wk(100, 100, "past"), wk(110, 0, "current"), wk(150, null, "future")];
    const { overall } = computeReadiness([series("RUN", weeks)]);
    expect(overall?.status).toBe("insufficient");
    expect(overall?.pct).toBeNull();
  });

  it("is insufficient before the plan has started (all future)", () => {
    const weeks = [wk(100, null, "future"), wk(150, null, "future")];
    const { overall } = computeReadiness([series("RUN", weeks)]);
    expect(overall?.status).toBe("insufficient");
  });
});

describe("computeReadiness — adherence to date", () => {
  it("switches to plan-to-date once the peak is passed (taper)", () => {
    // Peak at index 1; current week is index 4, well past it.
    const weeks = [
      wk(100, 100, "past"),
      wk(150, 150, "past"), // peak
      wk(120, 120, "past"),
      wk(90, 90, "past"),
      wk(70, 35, "current"), // taper week, half done
    ];
    const { overall } = computeReadiness([series("RUN", weeks)]);
    expect(overall?.basis).toBe("toDate");
    expect(overall?.weeksToPeak).toBeNull();
    // 495 / 530 ≈ 93% → on track.
    expect(overall?.status).toBe("onTrack");
  });

  it("reports final adherence for a finished plan", () => {
    const weeks = [wk(100, 60, "past"), wk(150, 90, "past"), wk(120, 70, "past")];
    const { overall } = computeReadiness([series("RUN", weeks)]);
    expect(overall?.basis).toBe("toDate");
    expect(overall?.status).toBe("atRisk"); // 220/370 ≈ 59%
    expect(overall?.pct).toBe(59);
  });
});

describe("computeReadiness — overall vs disciplines", () => {
  it("uses TOTAL as overall and excludes it from disciplines (multi-sport)", () => {
    const result = computeReadiness([
      series("TOTAL", buildingWeeks([100, 110, 120])),
      series("SWIM", buildingWeeks([80, 88, 96])),
      series("BIKE", buildingWeeks([110, 125, 140])),
    ]);
    expect(result.overall?.key).toBe("TOTAL");
    expect(result.disciplines.map((d) => d.key)).toEqual(["SWIM", "BIKE"]);
    expect(result.disciplines.find((d) => d.key === "SWIM")?.status).toBe("atRisk");
  });

  it("uses the sole discipline as overall for single-sport plans", () => {
    const result = computeReadiness([series("RUN", buildingWeeks([100, 110, 120]))]);
    expect(result.overall?.key).toBe("RUN");
    expect(result.disciplines.map((d) => d.key)).toEqual(["RUN"]);
  });
});

describe("computeReadiness — paused weeks (time off)", () => {
  const pausedWk = (target: number) => ({
    target,
    actual: 0,
    phase: "past" as const,
    paused: true,
  });

  it("ignores a paused week in the trend instead of reading it as a collapse", () => {
    // Three good weeks, then a week off sick — the projection should follow the
    // build, not be dragged to zero by the layoff.
    const withPause = computeReadiness([
      series("RUN", [
        wk(100, 100, "past"),
        wk(110, 110, "past"),
        wk(120, 120, "past"),
        pausedWk(130),
        wk(140, 0, "current"),
        wk(150, null, "future"), // peak
      ]),
    ]);
    expect(withPause.overall?.status).toBe("onTrack");
    // Without the pause flag the same zero week would drag the slope down…
    const asMissed = computeReadiness([
      series("RUN", [
        wk(100, 100, "past"),
        wk(110, 110, "past"),
        wk(120, 120, "past"),
        wk(130, 0, "past"),
        wk(140, 0, "current"),
        wk(150, null, "future"),
      ]),
    ]);
    expect(asMissed.overall!.pct!).toBeLessThan(withPause.overall!.pct!);
  });

  it("does not tell the athlete to train more on the way back from a layoff", () => {
    const { overall } = computeReadiness([
      series("RUN", [
        wk(100, 100, "past"),
        wk(110, 110, "past"),
        wk(120, 120, "past"),
        pausedWk(130),
        pausedWk(140),
        wk(150, 0, "current"),
        wk(160, null, "future"), // peak
      ]),
    ]);
    expect(overall?.status).not.toBe("atRisk");
    expect(overall?.recommendedPerWeekMeters).toBeNull();
  });

  it("excludes paused weeks from adherence — nothing expected, nothing owed", () => {
    // Peak passed, so this reports plan-to-date. The paused week must not count
    // against the athlete on either side of the ratio.
    const { overall } = computeReadiness([
      series("RUN", [
        wk(100, 100, "past"),
        wk(150, 150, "past"), // peak
        pausedWk(120), // ill — 0 done, but nothing was expected
        wk(90, 90, "current"),
      ]),
    ]);
    expect(overall?.basis).toBe("toDate");
    expect(overall?.pct).toBe(100); // 340/340 — the paused week is out of both sums
    expect(overall?.status).toBe("onTrack");
  });
});

describe("computeFormReadiness", () => {
  it("maps Form to a status and rounds the TSB", () => {
    const f = computeFormReadiness(12.6);
    expect(f.tsb).toBe(13);
    expect(f.status).toBe("neutral");
    expect(f.eases).toBe(false);
    expect(f.note).toBeNull();
  });

  it("eases (and only eases) when Form is overreaching", () => {
    expect(computeFormReadiness(-40).eases).toBe(true);
    expect(computeFormReadiness(-40).status).toBe("overreaching");
    expect(computeFormReadiness(-20).eases).toBe(false); // productive, not overreaching
  });

  it("flags the objective override: feels fine, but Form is overreaching", () => {
    const f = computeFormReadiness(-38, FEELS_FINE);
    expect(f.note).toMatch(/numbers say ease back/i);
  });

  it("reassures when the check-in flags fatigue but Form is fresh", () => {
    const f = computeFormReadiness(22, WRECKED);
    expect(f.status).toBe("fresh");
    expect(f.note).toMatch(/won't set your build back/i);
  });

  it("stays quiet when the two signals agree", () => {
    // Overreaching Form AND a wrecked check-in both point the same way → no cross-check.
    expect(computeFormReadiness(-38, WRECKED).note).toBeNull();
    // Fresh Form and a fine check-in also agree.
    expect(computeFormReadiness(22, FEELS_FINE).note).toBeNull();
    // No check-in → nothing to cross-check.
    expect(computeFormReadiness(-38).note).toBeNull();
  });
});
