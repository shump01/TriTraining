import { describe, expect, it } from "vitest";

import {
  countdownLabel,
  formatRemaining,
  nextLocalMidnightMs,
  raceCountdown,
  type RaceCountdown,
} from "./race-countdown";

/**
 * Every instant below is LOCAL, built from parts the same way the module
 * builds its own — so the expectations hold in any zone, including the DST
 * cases, which assert against values derived from the local clock rather
 * than zone-dependent literals.
 */
const localMs = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).getTime();

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sunday 13 December 2026, as the API ships it. */
const EVT = "2026-12-13T00:00:00.000Z";

const at = (nowMs: number, event: string | number = EVT): RaceCountdown => {
  const cd = raceCountdown(event, nowMs);
  if (!cd) throw new Error("expected a countdown");
  return cd;
};

describe("raceCountdown", () => {
  it("counts weeks far out, with the day count and the next midnight alongside", () => {
    const cd = at(localMs(2026, 5, 24, 10));
    expect(cd.phase).toBe("weeks");
    expect(cd.days).toBe(203);
    expect(cd.weeks).toBe(29);
    expect(cd.isRaceWeek).toBe(false);
    expect(cd.nextChangeMs).toBe(localMs(2026, 5, 25));
  });

  it("switches from weeks to days inside the taper", () => {
    expect(at(localMs(2026, 11, 28, 9)).phase).toBe("weeks"); // 15 days
    expect(at(localMs(2026, 11, 28, 9)).weeks).toBe(3);
    expect(at(localMs(2026, 11, 29, 9)).phase).toBe("days"); // 14 days
    expect(at(localMs(2026, 12, 5, 9)).weeks).toBe(2); // 8 days: never "1 week"
  });

  it("flags race week from six days out, not seven", () => {
    expect(at(localMs(2026, 12, 6, 9)).isRaceWeek).toBe(false);
    expect(at(localMs(2026, 12, 7, 9)).isRaceWeek).toBe(true);
  });

  it("rolls the day count at LOCAL midnight", () => {
    expect(at(localMs(2026, 9, 6, 23, 59, 59)).days).toBe(98);
    expect(at(localMs(2026, 9, 7, 0, 0, 0)).days).toBe(97);
  });

  it("ticks by the minute on the eve, landing on whole minutes", () => {
    const six = at(localMs(2026, 12, 12, 18, 0, 0));
    expect(six.phase).toBe("eve");
    expect([six.hours, six.minutes, six.seconds]).toEqual([6, 0, 0]);
    expect(six.nextChangeMs).toBe(localMs(2026, 12, 12, 18, 0, 0) + 60_000);
    const later = at(localMs(2026, 12, 12, 18, 0, 30));
    expect(later.nextChangeMs).toBe(localMs(2026, 12, 12, 18, 1));
  });

  it("ticks by the second only inside the final hour, aligned to whole seconds", () => {
    const cd = at(localMs(2026, 12, 12, 23, 30, 15));
    expect([cd.minutes, cd.seconds]).toEqual([29, 45]);
    expect(cd.nextChangeMs).toBe(localMs(2026, 12, 12, 23, 30, 15) + 1000);
    const mid = at(localMs(2026, 12, 12, 23, 30, 15, 400));
    expect(mid.seconds).toBe(44);
    expect(mid.nextChangeMs).toBe(localMs(2026, 12, 12, 23, 30, 15, 400) + 600);
    // Exactly one hour out the unit switches.
    const hour = at(localMs(2026, 12, 12, 23, 0, 0));
    expect(hour.nextChangeMs).toBe(localMs(2026, 12, 12, 23, 0, 0) + 60_000);
    const under = at(localMs(2026, 12, 12, 23, 0, 0, 1));
    expect(under.nextChangeMs).toBe(localMs(2026, 12, 12, 23, 0, 0, 1) + 999);
  });

  it("is still the eve at the last millisecond, reading 00:00", () => {
    const cd = at(localMs(2026, 12, 12, 23, 59, 59, 999));
    expect(cd.phase).toBe("eve");
    expect(formatRemaining(cd.remainingMs)).toBe("00:00");
  });

  it("is race day from exact local midnight through the whole day", () => {
    const start = at(localMs(2026, 12, 13, 0, 0, 0));
    expect(start.phase).toBe("raceDay");
    expect(start.days).toBe(0);
    expect(start.weeks).toBe(0);
    expect(start.remainingMs).toBe(0);
    expect(start.nextChangeMs).toBe(localMs(2026, 12, 14));
    expect(at(localMs(2026, 12, 13, 23, 59, 59)).phase).toBe("raceDay");
  });

  it("is done the day after, with nothing left to schedule", () => {
    const cd = at(localMs(2026, 12, 14, 0, 0, 1));
    expect(cd.phase).toBe("done");
    expect(cd.days).toBe(-1);
    expect(cd.nextChangeMs).toBeNull();
    expect(at(localMs(2026, 12, 15, 12)).days).toBe(-2);
  });

  it("counts calendar days across a spring-forward, where a raw floor would lose one", () => {
    const now = localMs(2026, 3, 23, 12);
    const cd = at(now, "2026-03-30T00:00:00.000Z");
    expect(cd.days).toBe(7);
    // Document why: the raw span is an hour short wherever the zone springs
    // forward in between (Europe does on 29 March 2026).
    const offsetShift =
      new Date(localMs(2026, 3, 23)).getTimezoneOffset() -
      new Date(localMs(2026, 3, 30)).getTimezoneOffset();
    const naive = Math.floor((cd.raceStartMs - localMs(2026, 3, 23)) / DAY_MS);
    expect(naive).toBe(offsetShift > 0 ? 6 : 7);
  });

  it("counts calendar days across a fall-back", () => {
    const cd = at(localMs(2026, 10, 5, 12), "2026-11-02T00:00:00.000Z");
    expect(cd.days).toBe(28);
    expect(cd.weeks).toBe(4);
  });

  it("shows the real length of a fall-back eve rather than wrapping the hours", () => {
    const now = localMs(2026, 10, 25, 0, 0);
    const cd = at(now, "2026-10-26T00:00:00.000Z");
    expect(cd.phase).toBe("eve");
    expect(cd.remainingMs).toBe(cd.raceStartMs - now);
    const eveHours = (localMs(2026, 10, 26) - localMs(2026, 10, 25)) / (60 * 60 * 1000);
    expect(cd.hours).toBe(eveHours); // 25 in London, 24 in a fixed-offset zone
    expect(formatRemaining(cd.remainingMs)).toBe(`${eveHours}h 00m`);
  });

  it("hands out a race-day instant that formats as the right calendar day in any zone", () => {
    const cd = at(localMs(2026, 6, 1, 12));
    const shown = new Date(cd.raceDayMs);
    expect(shown.getMonth()).toBe(11);
    expect(shown.getDate()).toBe(13);
  });

  it("treats the plan detail’s UTC-midnight ms exactly like the ISO string", () => {
    const ms = Date.UTC(2026, 11, 13);
    for (const now of [
      localMs(2026, 5, 24, 10),
      localMs(2026, 12, 12, 18, 0, 30),
      localMs(2026, 12, 13, 8),
    ]) {
      expect(raceCountdown(ms, now)).toEqual(raceCountdown(EVT, now));
    }
  });

  it("returns null for anything that is not a date", () => {
    const now = localMs(2026, 6, 1);
    expect(raceCountdown("not-a-date", now)).toBeNull();
    expect(raceCountdown("", now)).toBeNull();
    expect(raceCountdown(Number.NaN, now)).toBeNull();
    expect(raceCountdown("2026-13-45T00:00:00.000Z", now)).toBeNull();
    expect(raceCountdown(EVT, Number.NaN)).toBeNull();
  });
});

describe("nextLocalMidnightMs", () => {
  it("is the coming midnight, strictly after an exact midnight, and 25h across a fall-back", () => {
    expect(nextLocalMidnightMs(localMs(2026, 9, 6, 13))).toBe(localMs(2026, 9, 7));
    expect(nextLocalMidnightMs(localMs(2026, 9, 7))).toBe(localMs(2026, 9, 8));
    expect(nextLocalMidnightMs(localMs(2026, 10, 25, 0, 30))).toBe(localMs(2026, 10, 26));
  });
});

describe("countdownLabel", () => {
  it("reads naturally in both styles across every phase", () => {
    const weeks = at(localMs(2026, 5, 24, 10));
    expect([countdownLabel(weeks, "short"), countdownLabel(weeks, "long")]).toEqual([
      "29 wks",
      "29 wks to go",
    ]);
    const oneWeek: RaceCountdown = { ...weeks, weeks: 1 };
    expect(countdownLabel(oneWeek, "short")).toBe("1 wk");
    const days = at(localMs(2026, 12, 1, 9));
    expect([countdownLabel(days, "short"), countdownLabel(days, "long")]).toEqual([
      "12 days",
      "12 days to go",
    ]);
    const eve = at(localMs(2026, 12, 12, 9));
    expect([countdownLabel(eve, "short"), countdownLabel(eve, "long")]).toEqual([
      "Tomorrow",
      "Tomorrow",
    ]);
    const raceDay = at(localMs(2026, 12, 13, 9));
    expect([countdownLabel(raceDay, "short"), countdownLabel(raceDay, "long")]).toEqual([
      "Today",
      "Race day",
    ]);
    const done = at(localMs(2026, 12, 14, 9));
    expect([countdownLabel(done, "short"), countdownLabel(done, "long")]).toEqual([
      "Raced",
      "Raced",
    ]);
  });
});

describe("invariants across the race weekend", () => {
  it("always schedules strictly ahead, and calls race day exactly the local calendar day", () => {
    const raceStart = localMs(2026, 12, 13);
    const dayAfter = localMs(2026, 12, 14);
    for (let t = localMs(2026, 12, 11); t < localMs(2026, 12, 15); t += 60 * 60 * 1000) {
      const cd = at(t);
      expect(cd.nextChangeMs === null || cd.nextChangeMs > t).toBe(true);
      expect(cd.phase === "raceDay").toBe(t >= raceStart && t < dayAfter);
    }
  });
});
