import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, mailer, maybeRecalculatePlanForUser, getUserFormTsb } = vi.hoisted(() => ({
  prisma: {
    user: { findMany: vi.fn(), update: vi.fn() },
    trainingPlan: { findMany: vi.fn(), findFirst: vi.fn() },
  },
  mailer: { isMailerConfigured: vi.fn(), sendEmail: vi.fn() },
  maybeRecalculatePlanForUser: vi.fn(),
  getUserFormTsb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/mailer", () => mailer);
vi.mock("@/lib/training-plan", () => ({ maybeRecalculatePlanForUser }));
vi.mock("@/lib/load-data", () => ({ getUserFormTsb }));

import {
  buildDigestForUser,
  createUnsubscribeToken,
  isDigestDue,
  renderDigestEmail,
  sendWeeklyDigests,
  verifyUnsubscribeToken,
  type DigestModel,
} from "./digest";

// Monday-start plan; "now" is Monday 2026-07-20 06:15 UTC (week start day).
const WEEK_START = new Date("2026-07-20T00:00:00.000Z");
const LAST_WEEK = new Date("2026-07-13T00:00:00.000Z");
const MONDAY_MORNING = new Date("2026-07-20T06:15:00.000Z");

const USER = { id: "user-1", email: "athlete@example.com", name: "Sam", lastDigestWeek: null };

const PLAN_LIST_ROW = {
  id: "plan-1",
  name: "Ironman Hamburg",
  eventDate: new Date("2026-09-06T00:00:00.000Z"),
  startDate: new Date("2026-06-29T00:00:00.000Z"),
  createdAt: new Date("2026-06-20T00:00:00.000Z"),
  weekStartDay: 1,
  priority: "A",
};

const PLAN_DETAIL = {
  weekStartDay: 1,
  disciplines: [
    { discipline: "RUN", startingWeeklyMeters: 20_000 },
    { discipline: "BIKE", startingWeeklyMeters: 80_000 },
  ],
  weeklyTargets: [
    { discipline: "RUN", weekStartDate: LAST_WEEK, targetMeters: 22_000 },
    { discipline: "BIKE", weekStartDate: LAST_WEEK, targetMeters: 88_000 },
    { discipline: "RUN", weekStartDate: WEEK_START, targetMeters: 24_000 },
    { discipline: "BIKE", weekStartDate: WEEK_START, targetMeters: 96_000 },
  ],
  weeklyActuals: [
    { discipline: "RUN", weekStartDate: LAST_WEEK, actualMeters: 21_500, source: "STRAVA" },
    { discipline: "BIKE", weekStartDate: LAST_WEEK, actualMeters: 60_000, source: "STRAVA" },
  ],
  weeklyPauses: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mailer.isMailerConfigured.mockReturnValue(true);
  mailer.sendEmail.mockResolvedValue(true);
  maybeRecalculatePlanForUser.mockResolvedValue(false);
  getUserFormTsb.mockResolvedValue(-4.2);
  prisma.trainingPlan.findMany.mockResolvedValue([PLAN_LIST_ROW]);
  prisma.trainingPlan.findFirst.mockResolvedValue(PLAN_DETAIL);
  prisma.user.findMany.mockResolvedValue([USER]);
  prisma.user.update.mockResolvedValue({});
});

describe("isDigestDue", () => {
  it("is due on the week-start day when that week hasn't been digested", () => {
    expect(isDigestDue(MONDAY_MORNING, 1, null)).toBe(true);
    expect(isDigestDue(MONDAY_MORNING, 1, LAST_WEEK)).toBe(true);
  });

  it("allows one catch-up day for a missed cron run", () => {
    expect(isDigestDue(new Date("2026-07-21T06:15:00.000Z"), 1, LAST_WEEK)).toBe(true);
  });

  it("stays quiet later in the week — a Thursday 'week ahead' email is noise", () => {
    expect(isDigestDue(new Date("2026-07-23T06:15:00.000Z"), 1, LAST_WEEK)).toBe(false);
    expect(isDigestDue(new Date("2026-07-23T06:15:00.000Z"), 1, null)).toBe(false);
  });

  it("never sends the same training week twice", () => {
    expect(isDigestDue(MONDAY_MORNING, 1, WEEK_START)).toBe(false);
    expect(isDigestDue(new Date("2026-07-21T06:15:00.000Z"), 1, WEEK_START)).toBe(false);
  });

  it("respects a non-Monday week start", () => {
    // weekStartDay 0 (Sunday): on Monday the 20th, the week began Sunday the
    // 19th — one day in, still inside the catch-up window.
    expect(isDigestDue(MONDAY_MORNING, 0, null)).toBe(true);
    expect(isDigestDue(new Date("2026-07-22T06:15:00.000Z"), 0, null)).toBe(false);
  });

  it("a featured-plan grid switch can't send twice in one calendar week", () => {
    // Digest went out on Sunday's grid (week start Jul 19); on Monday the
    // featured plan switches to a Monday grid — Jul 20 is a "new week" on that
    // grid but only one day after the last digest. The calendar backstop wins.
    const sundayGridWeek = new Date("2026-07-19T00:00:00.000Z");
    expect(isDigestDue(MONDAY_MORNING, 1, sundayGridWeek)).toBe(false);
    // A genuine next week (7 days on) still fires.
    expect(isDigestDue(new Date("2026-07-27T06:15:00.000Z"), 1, sundayGridWeek)).toBe(true);
  });
});

describe("unsubscribe token", () => {
  it("round-trips", () => {
    expect(verifyUnsubscribeToken(createUnsubscribeToken("user-1"))).toBe("user-1");
  });

  it("rejects a tampered signature", () => {
    const token = createUnsubscribeToken("user-1");
    expect(verifyUnsubscribeToken(token.slice(0, -2) + "xx")).toBeNull();
  });

  it("rejects a token re-pointed at another user", () => {
    const token = createUnsubscribeToken("user-1");
    const mac = token.slice(token.lastIndexOf(".") + 1);
    expect(verifyUnsubscribeToken(`user-2.${mac}`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("no-dot")).toBeNull();
    expect(verifyUnsubscribeToken(".just-a-mac")).toBeNull();
  });
});

describe("buildDigestForUser", () => {
  it("builds the model: last week vs targets, this week's targets, countdown", async () => {
    const model = await buildDigestForUser(USER, MONDAY_MORNING);

    expect(model).not.toBeNull();
    expect(model!.planName).toBe("Ironman Hamburg");
    expect(model!.currentWeekStart).toEqual(WEEK_START);
    expect(model!.daysToRace).toBe(48);
    expect(model!.weeksToRace).toBe(7);
    expect(model!.form).toBe(-4);
    expect(model!.firstWeek).toBe(false);

    const run = model!.disciplines.find((d) => d.key === "RUN");
    expect(run).toMatchObject({
      lastWeekTarget: 22_000,
      lastWeekActual: 21_500,
      thisWeekTarget: 24_000,
    });
    const bike = model!.disciplines.find((d) => d.key === "BIKE");
    expect(bike?.lastWeekStatus).toBe("behind"); // 60km of 88km
  });

  it("rolls the week forward BEFORE reading targets", async () => {
    const order: string[] = [];
    maybeRecalculatePlanForUser.mockImplementation(async () => {
      order.push("recalc");
      return true;
    });
    prisma.trainingPlan.findFirst.mockImplementation(async () => {
      order.push("read");
      return PLAN_DETAIL;
    });

    await buildDigestForUser(USER, MONDAY_MORNING);

    expect(maybeRecalculatePlanForUser).toHaveBeenCalledWith("user-1", "plan-1");
    expect(order).toEqual(["recalc", "read"]);
  });

  it("returns null when not due, and never triggers a recalc", async () => {
    const model = await buildDigestForUser({ ...USER, lastDigestWeek: WEEK_START }, MONDAY_MORNING);
    expect(model).toBeNull();
    expect(maybeRecalculatePlanForUser).not.toHaveBeenCalled();
  });

  it("returns null with no live plan", async () => {
    prisma.trainingPlan.findMany.mockResolvedValue([]);
    expect(await buildDigestForUser(USER, MONDAY_MORNING)).toBeNull();
  });

  it("flags a paused current week", async () => {
    prisma.trainingPlan.findFirst.mockResolvedValue({
      ...PLAN_DETAIL,
      weeklyPauses: [{ weekStartDate: WEEK_START, reason: "ILLNESS" }],
    });
    const model = await buildDigestForUser(USER, MONDAY_MORNING);
    expect(model!.currentWeekPaused).toBe(true);
  });

  it("goes silent from the second consecutive paused week of a layoff", async () => {
    prisma.trainingPlan.findFirst.mockResolvedValue({
      ...PLAN_DETAIL,
      weeklyPauses: [
        { weekStartDate: LAST_WEEK, reason: "INJURY" },
        { weekStartDate: WEEK_START, reason: "INJURY" },
      ],
    });
    expect(await buildDigestForUser(USER, MONDAY_MORNING)).toBeNull();
  });

  it("still sends on race-day morning — the race is live through its whole day", async () => {
    // Sunday-grid plan whose race IS a Sunday: race-day morning is the first
    // day of a training week, and the cron runs at 06:15, hours after the
    // race date's UTC midnight. The plan must still rank as live.
    const raceDay = new Date("2026-07-26T00:00:00.000Z"); // a Sunday
    prisma.trainingPlan.findMany.mockResolvedValue([
      {
        ...PLAN_LIST_ROW,
        eventDate: raceDay,
        startDate: new Date("2026-06-28T00:00:00.000Z"),
        weekStartDay: 0,
      },
    ]);
    prisma.trainingPlan.findFirst.mockResolvedValue({
      ...PLAN_DETAIL,
      weekStartDay: 0,
      weeklyTargets: [
        {
          discipline: "RUN",
          weekStartDate: new Date("2026-07-19T00:00:00.000Z"),
          targetMeters: 12_000,
        },
        { discipline: "RUN", weekStartDate: raceDay, targetMeters: 8_000 },
      ],
      weeklyActuals: [],
    });

    const model = await buildDigestForUser(USER, new Date("2026-07-26T06:15:00.000Z"));

    expect(model).not.toBeNull();
    expect(model!.daysToRace).toBe(0);
    const rendered = renderDigestEmail(model!, {
      dashboardUrl: "https://x/dashboard",
      unsubscribeUrl: "https://x/u",
    });
    expect(rendered.subject).toContain("Race day is HERE");
  });
});

describe("renderDigestEmail", () => {
  const URLS = {
    dashboardUrl: "https://app.example/dashboard",
    unsubscribeUrl: "https://app.example/api/email/unsubscribe?token=t",
  };

  function model(overrides: Partial<DigestModel> = {}): DigestModel {
    return {
      userId: "user-1",
      email: "athlete@example.com",
      greetingName: "Sam",
      planId: "plan-1",
      planName: "Ironman Hamburg",
      currentWeekStart: WEEK_START,
      daysToRace: 48,
      weeksToRace: 7,
      lastWeekPaused: false,
      currentWeekPaused: false,
      firstWeek: false,
      disciplines: [
        {
          key: "RUN",
          label: "Run",
          lastWeekTarget: 22_000,
          lastWeekActual: 21_500,
          lastWeekStatus: "onTrack",
          thisWeekTarget: 24_000,
        },
      ],
      form: -4,
      currentStreak: 3,
      weeksCompleted: 3,
      ...overrides,
    };
  }

  it("carries the countdown, both weeks, form, streak, and the unsubscribe link", () => {
    const r = renderDigestEmail(model(), URLS);
    expect(r.subject).toContain("7 weeks to race day");
    expect(r.subject).toContain("Ironman Hamburg");
    expect(r.text).toContain("Run: 21.5 km of 22.0 km (on track)");
    expect(r.text).toContain("Run: 24.0 km");
    expect(r.text).toContain("Form (freshness): -4");
    expect(r.text).toContain("Streak: 3 weeks on target");
    expect(r.text).toContain(URLS.unsubscribeUrl);
    expect(r.html).toContain(URLS.unsubscribeUrl);
    expect(r.html).toContain(URLS.dashboardUrl);
  });

  it("escapes user-controlled strings in the HTML variant", () => {
    const r = renderDigestEmail(
      model({ planName: '<script>alert("x")</script>', greetingName: "<b>Sam</b>" }),
      URLS,
    );
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
  });

  it("swaps the tables for time-off copy on a paused week", () => {
    const r = renderDigestEmail(model({ currentWeekPaused: true }), URLS);
    expect(r.text).toContain("time off");
    expect(r.text).not.toContain("Run: 24.0 km");
  });

  it("omits the last-week section on the plan's first week", () => {
    const r = renderDigestEmail(model({ firstWeek: true }), URLS);
    expect(r.text).not.toContain("LAST WEEK");
    expect(r.text).toContain("THIS WEEK");
  });
});

describe("sendWeeklyDigests", () => {
  it("does nothing when the mailer is unconfigured", async () => {
    mailer.isMailerConfigured.mockReturnValue(false);
    const result = await sendWeeklyDigests(MONDAY_MORNING);
    expect(result).toEqual({ considered: 0, sent: 0, skipped: 0, failures: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("sends to a due user and only then advances lastDigestWeek", async () => {
    const result = await sendWeeklyDigests(MONDAY_MORNING);

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
    const sent = mailer.sendEmail.mock.calls[0]?.[0] as { to: string; listUnsubscribeUrl: string };
    expect(sent.to).toBe("athlete@example.com");
    expect(sent.listUnsubscribeUrl).toContain("/api/email/unsubscribe?token=");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastDigestWeek: WEEK_START },
    });
    expect(result).toMatchObject({ considered: 1, sent: 1, failures: 0 });
  });

  it("does NOT advance lastDigestWeek when the send fails — next run retries", async () => {
    mailer.sendEmail.mockResolvedValue(false);
    const result = await sendWeeklyDigests(MONDAY_MORNING);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.failures).toBe(1);
  });

  it("one athlete's failure never blocks the rest of the batch", async () => {
    prisma.user.findMany.mockResolvedValue([
      { ...USER, id: "user-bad", email: "bad@example.com" },
      USER,
    ]);
    prisma.trainingPlan.findMany
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([PLAN_LIST_ROW]);

    const result = await sendWeeklyDigests(MONDAY_MORNING);

    expect(result.failures).toBe(1);
    expect(result.sent).toBe(1);
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("skips users whose week isn't due without touching lastDigestWeek", async () => {
    prisma.user.findMany.mockResolvedValue([{ ...USER, lastDigestWeek: WEEK_START }]);
    const result = await sendWeeklyDigests(MONDAY_MORNING);
    expect(result).toMatchObject({ considered: 1, sent: 0, skipped: 1 });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
