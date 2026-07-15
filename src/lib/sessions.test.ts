import { describe, expect, it } from "vitest";

import { suggestSessions, type SessionDiscipline } from "@/lib/sessions";

describe("suggestSessions", () => {
  it("returns no sessions for a non-positive weekly target", () => {
    expect(suggestSessions("RUN", 0)).toEqual([]);
    expect(suggestSessions("BIKE", -100)).toEqual([]);
  });

  it.each(["SWIM", "BIKE", "RUN"] as SessionDiscipline[])(
    "splits %s into sessions that sum back to the weekly total exactly",
    (discipline) => {
      const week = 43_210;
      const sessions = suggestSessions(discipline, week);
      expect(sessions.length).toBeGreaterThanOrEqual(3);
      expect(sessions.reduce((sum, s) => sum + s.meters, 0)).toBe(week);
      for (const s of sessions) expect(s.meters).toBeGreaterThanOrEqual(0);
    },
  );

  it("leads with the long session as the biggest chunk", () => {
    const sessions = suggestSessions("RUN", 40_000);
    const max = Math.max(...sessions.map((s) => s.meters));
    expect(sessions[0]!.label).toBe("Long run");
    expect(sessions[0]!.meters).toBe(max);
  });
});
