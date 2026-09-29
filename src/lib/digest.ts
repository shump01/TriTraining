import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env";
import { displayNameFor } from "@/lib/display-name";
import { pickFeaturedPlan } from "@/lib/featured-plan";
import { buildHeatmap } from "@/lib/heatmap";
import { getUserFormTsb } from "@/lib/load-data";
import { logger } from "@/lib/logger";
import { isMailerConfigured, sendEmail } from "@/lib/mailer";
import { buildPlanSeries, type SeriesData } from "@/lib/plan-series";
import { prisma } from "@/lib/prisma";
import { maybeRecalculatePlanForUser } from "@/lib/training-plan";
import { formatDistance } from "@/lib/ui/theme";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

/**
 * The weekly digest email: on the first day of an athlete's training week, one
 * email with last week's result, this week's (freshly re-ramped) targets, Form,
 * streak, and the race countdown — for the featured plan, the same one the
 * dashboard leads with.
 *
 * Driven by a daily cron hitting POST /api/cron/weekly-digest. Everything here
 * takes explicit userIds (no session): the cron is a trusted server context.
 * Opt-out is a User flag, flippable on the Account page or via the signed
 * unsubscribe link every digest carries.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Due = this training week hasn't been digested yet AND we're within its first
 * two days (the week-start day itself, plus one catch-up day so a single missed
 * cron run doesn't cost the whole week). Later in the week we stay quiet — a
 * "week ahead" email arriving on Thursday is noise, and a brand-new user's
 * first digest waits for their first full week boundary.
 */
export function isDigestDue(now: Date, weekStartDay: number, lastDigestWeek: Date | null): boolean {
  const currentWeekStart = startOfWeek(now, weekStartDay);
  if (lastDigestWeek && lastDigestWeek.getTime() >= currentWeekStart.getTime()) return false;
  // Calendar backstop: lastDigestWeek is stored on the FEATURED plan's week
  // grid, and the featured plan (or its weekStartDay) can change mid-season.
  // Without this, a Sunday-grid digest followed by a Monday-grid feature would
  // send twice in two days. A genuine next week is always ≥7 days on, so <6
  // days since the last digested week-start can only be a grid switch.
  if (lastDigestWeek && utcMidnight(now).getTime() - lastDigestWeek.getTime() < 6 * DAY_MS) {
    return false;
  }
  const daysIntoWeek = Math.round(
    (utcMidnight(now).getTime() - currentWeekStart.getTime()) / DAY_MS,
  );
  return daysIntoWeek <= 1;
}

// ── Unsubscribe token ────────────────────────────────────────────────────────
// `${userId}.${hmac}` signed with AUTH_SECRET. No expiry: an unsubscribe link
// in an old email must keep working. Worst case a leaked token lets someone
// turn a digest OFF — an acceptable failure mode (never ON, never data access).

const UNSUB_PURPOSE = "digest-unsub.v1";

export function createUnsubscribeToken(userId: string): string {
  const mac = createHmac("sha256", env.AUTH_SECRET)
    .update(`${UNSUB_PURPOSE}.${userId}`)
    .digest("base64url");
  return `${userId}.${mac}`;
}

/** The userId the token vouches for, or null if it doesn't verify. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", env.AUTH_SECRET)
    .update(`${UNSUB_PURPOSE}.${userId}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

// ── Digest model ─────────────────────────────────────────────────────────────

export interface DigestDiscipline {
  key: "SWIM" | "BIKE" | "RUN";
  label: string;
  lastWeekTarget: number | null;
  lastWeekActual: number | null;
  lastWeekStatus: "ahead" | "onTrack" | "behind" | null;
  thisWeekTarget: number | null;
}

export interface DigestModel {
  userId: string;
  email: string;
  greetingName: string;
  planId: string;
  planName: string;
  currentWeekStart: Date;
  daysToRace: number;
  weeksToRace: number;
  lastWeekPaused: boolean;
  currentWeekPaused: boolean;
  /** True on the plan's very first week — there is no "last week" to report. */
  firstWeek: boolean;
  disciplines: DigestDiscipline[];
  /** Current Form (TSB), rounded — null when load can't be computed. */
  form: number | null;
  currentStreak: number;
  weeksCompleted: number;
}

interface DigestUser {
  id: string;
  email: string;
  name: string | null;
  lastDigestWeek: Date | null;
}

function weekRow(series: SeriesData, weekMs: number) {
  return series.weeks.find((w) => w.ms === weekMs) ?? null;
}

/**
 * Build the digest for one user, or null when there's nothing to send: no live
 * plan, the featured plan hasn't started, or this week's digest isn't due.
 * Rolls the featured plan's week forward FIRST, so the targets in the email
 * are the targets the athlete finds when they open the app.
 */
export async function buildDigestForUser(user: DigestUser, now: Date): Promise<DigestModel | null> {
  const today = utcMidnight(now);

  const candidates = await prisma.trainingPlan.findMany({
    where: { userId: user.id, eventDate: { gte: today } },
    select: {
      id: true,
      name: true,
      eventDate: true,
      startDate: true,
      createdAt: true,
      weekStartDay: true,
      priority: true,
    },
  });
  const featured = pickFeaturedPlan(
    candidates.map((p) => ({
      ...p,
      eventMs: p.eventDate.getTime(),
      startMs: planStartWeek(p).getTime(),
    })),
    // Day-granular "now": eventDate is a UTC-midnight date, so ranking against
    // the real cron time (e.g. 06:15) would drop a plan on race-day morning —
    // exactly the "Race day is HERE" digest. Midnight keeps it live all day,
    // matching the eventDate >= today filter on the query above.
    today.getTime(),
  );
  if (!featured) return null;

  const currentWeekStart = startOfWeek(now, featured.weekStartDay);
  // Nothing to say before the plan's first week begins.
  if (currentWeekStart.getTime() < featured.startMs) return null;
  if (!isDigestDue(now, featured.weekStartDay, user.lastDigestWeek)) return null;

  // First view of the new week may be this very email — roll it forward so the
  // emailed targets match the app (fetch the plan only AFTER this).
  await maybeRecalculatePlanForUser(user.id, featured.id);

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: featured.id, userId: user.id },
    select: {
      weekStartDay: true,
      disciplines: { select: { discipline: true, startingWeeklyMeters: true } },
      weeklyTargets: { select: { discipline: true, weekStartDate: true, targetMeters: true } },
      weeklyActuals: {
        select: { discipline: true, weekStartDate: true, actualMeters: true, source: true },
      },
      weeklyPauses: { select: { weekStartDate: true, reason: true } },
    },
  });
  if (!plan) return null;

  const series = buildPlanSeries(plan, now);
  const lead = series[0];
  if (!lead) return null;

  const lastWeekMs = currentWeekStart.getTime() - WEEK_MS;
  const firstWeek = lastWeekMs < featured.startMs;

  const pausedWeeks = new Set(plan.weeklyPauses.map((p) => p.weekStartDate.getTime()));

  // A long layoff shouldn't mean a weekly "you're not training" email. The
  // FIRST paused week still sends (the recover-well copy is a kindness); from
  // the second consecutive paused week on, stay silent until training resumes.
  if (pausedWeeks.has(currentWeekStart.getTime()) && pausedWeeks.has(lastWeekMs)) {
    return null;
  }

  const disciplines: DigestDiscipline[] = series
    .filter((s) => s.key !== "TOTAL")
    .map((s) => {
      const last = weekRow(s, lastWeekMs);
      const current = weekRow(s, currentWeekStart.getTime());
      return {
        key: s.key as "SWIM" | "BIKE" | "RUN",
        label: s.label,
        lastWeekTarget: last?.target ?? null,
        lastWeekActual: last?.actual ?? null,
        lastWeekStatus: last?.status ?? null,
        thisWeekTarget: current?.target ?? null,
      };
    });

  const heatmap = buildHeatmap(lead.weeks);
  const form = await getUserFormTsb(user.id);

  const daysToRace = Math.max(
    0,
    Math.round((utcMidnight(featured.eventDate).getTime() - today.getTime()) / DAY_MS),
  );

  return {
    userId: user.id,
    email: user.email,
    greetingName: displayNameFor(user),
    planId: featured.id,
    planName: featured.name,
    currentWeekStart,
    daysToRace,
    weeksToRace: Math.ceil(daysToRace / 7),
    lastWeekPaused: pausedWeeks.has(lastWeekMs),
    currentWeekPaused: pausedWeeks.has(currentWeekStart.getTime()),
    firstWeek,
    disciplines,
    form: form == null ? null : Math.round(form),
    currentStreak: heatmap.currentStreak,
    weeksCompleted: heatmap.weeksCompleted,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmt(meters: number | null, key: "SWIM" | "BIKE" | "RUN"): string {
  return meters == null ? "—" : formatDistance(meters, key);
}

function statusWord(status: "ahead" | "onTrack" | "behind" | null): string {
  switch (status) {
    case "ahead":
      return "ahead";
    case "onTrack":
      return "on track";
    case "behind":
      return "behind";
    default:
      return "";
  }
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

/**
 * Render the digest as plain text + minimal table-based HTML (inline styles
 * only — email clients strip everything else). All user-controlled strings are
 * escaped in the HTML variant.
 */
export function renderDigestEmail(
  model: DigestModel,
  urls: { dashboardUrl: string; unsubscribeUrl: string },
): RenderedDigest {
  const race =
    model.daysToRace === 0
      ? "Race day is HERE"
      : model.weeksToRace <= 1
        ? `${model.daysToRace} day${model.daysToRace === 1 ? "" : "s"} to race day`
        : `${model.weeksToRace} weeks to race day`;

  const subject = `${race} — your training week (${model.planName})`;

  const lastWeekLines = model.lastWeekPaused
    ? ["Last week was marked as time off — no targets counted."]
    : model.disciplines
        .filter((d) => d.lastWeekTarget != null || d.lastWeekActual != null)
        .map((d) => {
          const word = statusWord(d.lastWeekStatus);
          return `${d.label}: ${fmt(d.lastWeekActual, d.key)} of ${fmt(d.lastWeekTarget, d.key)}${word ? ` (${word})` : ""}`;
        });

  const thisWeekLines = model.currentWeekPaused
    ? ["This week is marked as time off — recover well; the plan re-ramps when you're back."]
    : model.disciplines
        .filter((d) => d.thisWeekTarget != null)
        .map((d) => `${d.label}: ${fmt(d.thisWeekTarget, d.key)}`);

  const extras: string[] = [];
  if (model.form != null) {
    extras.push(
      `Form (freshness): ${model.form > 0 ? "+" : ""}${model.form}${model.form < -20 ? " — deep fatigue, this week's plan eases off" : ""}`,
    );
  }
  if (model.currentStreak >= 2) {
    // "On target" here is always distance-based — email has no access to the
    // reader's balanced-% display preference (see src/lib/total-pct.ts).
    extras.push(`Streak: ${model.currentStreak} weeks on target (by distance) — keep it alive.`);
  }

  const text = [
    `Hi ${model.greetingName},`,
    ``,
    `${race} · ${model.planName}`,
    ``,
    ...(model.firstWeek ? [] : [`LAST WEEK`, ...lastWeekLines, ``]),
    `THIS WEEK`,
    ...thisWeekLines,
    ...(extras.length ? [``, ...extras] : []),
    ``,
    `Open your dashboard: ${urls.dashboardUrl}`,
    ``,
    `--`,
    `You get this each new training week. Turn it off: ${urls.unsubscribeUrl}`,
  ].join("\n");

  const td = 'style="padding:6px 12px 6px 0;font-size:14px;color:#333"';
  const row = (cells: string[]) => `<tr>${cells.map((c) => `<td ${td}>${c}</td>`).join("")}</tr>`;

  const lastWeekHtml = model.firstWeek
    ? ""
    : `<h3 style="margin:20px 0 6px;font-size:13px;letter-spacing:.08em;color:#888">LAST WEEK</h3>` +
      (model.lastWeekPaused
        ? `<p style="margin:0;font-size:14px;color:#333">Marked as time off — no targets counted.</p>`
        : `<table cellpadding="0" cellspacing="0">${model.disciplines
            .filter((d) => d.lastWeekTarget != null || d.lastWeekActual != null)
            .map((d) =>
              row([
                `<b>${d.label}</b>`,
                `${fmt(d.lastWeekActual, d.key)} of ${fmt(d.lastWeekTarget, d.key)}`,
                statusWord(d.lastWeekStatus),
              ]),
            )
            .join("")}</table>`);

  const thisWeekHtml =
    `<h3 style="margin:20px 0 6px;font-size:13px;letter-spacing:.08em;color:#888">THIS WEEK</h3>` +
    (model.currentWeekPaused
      ? `<p style="margin:0;font-size:14px;color:#333">Marked as time off — recover well; the plan re-ramps when you're back.</p>`
      : `<table cellpadding="0" cellspacing="0">${model.disciplines
          .filter((d) => d.thisWeekTarget != null)
          .map((d) => row([`<b>${d.label}</b>`, fmt(d.thisWeekTarget, d.key)]))
          .join("")}</table>`);

  const extrasHtml = extras.length
    ? `<p style="margin:16px 0 0;font-size:14px;color:#333">${extras.map(escapeHtml).join("<br>")}</p>`
    : "";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px 4px">` +
    `<p style="font-size:14px;color:#333;margin:0 0 4px">Hi ${escapeHtml(model.greetingName)},</p>` +
    `<h2 style="margin:4px 0 0;font-size:20px;color:#111">${escapeHtml(race)}</h2>` +
    `<p style="margin:2px 0 0;font-size:13px;color:#888">${escapeHtml(model.planName)}</p>` +
    lastWeekHtml +
    thisWeekHtml +
    extrasHtml +
    `<p style="margin:24px 0 0"><a href="${urls.dashboardUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px">Open your dashboard</a></p>` +
    `<p style="margin:28px 0 0;font-size:12px;color:#999">You get this at the start of each training week. ` +
    `<a href="${urls.unsubscribeUrl}" style="color:#999">Unsubscribe</a> · manage in your <a href="${urls.dashboardUrl.replace(/\/dashboard$/, "/account")}" style="color:#999">account</a>.</p>` +
    `</div>`;

  return { subject, text, html };
}

// ── Batch orchestration ──────────────────────────────────────────────────────

export interface DigestBatchResult {
  considered: number;
  sent: number;
  skipped: number;
  failures: number;
}

/**
 * Send every due digest. Called by the daily cron route. Per-user isolation:
 * one athlete's bad data or SMTP hiccup never blocks the rest of the batch.
 * `lastDigestWeek` is only advanced after a successful send, so a failed send
 * retries on the next (catch-up) cron run.
 */
export async function sendWeeklyDigests(now: Date = new Date()): Promise<DigestBatchResult> {
  if (!isMailerConfigured()) {
    logger.warn("Weekly digest run skipped: mailer not configured");
    return { considered: 0, sent: 0, skipped: 0, failures: 0 };
  }

  const users = await prisma.user.findMany({
    where: {
      digestEnabled: true,
      trainingPlans: { some: { eventDate: { gte: utcMidnight(now) } } },
    },
    select: { id: true, email: true, name: true, lastDigestWeek: true },
  });

  const result: DigestBatchResult = { considered: users.length, sent: 0, skipped: 0, failures: 0 };

  for (const user of users) {
    try {
      const model = await buildDigestForUser(user, now);
      if (!model) {
        result.skipped += 1;
        continue;
      }
      const rendered = renderDigestEmail(model, {
        dashboardUrl: `${env.NEXTAUTH_URL}/dashboard`,
        unsubscribeUrl: `${env.NEXTAUTH_URL}/api/email/unsubscribe?token=${createUnsubscribeToken(user.id)}`,
      });
      const sent = await sendEmail({
        kind: "digest",
        to: user.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        listUnsubscribeUrl: `${env.NEXTAUTH_URL}/api/email/unsubscribe?token=${createUnsubscribeToken(user.id)}`,
      });
      if (sent) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastDigestWeek: model.currentWeekStart },
        });
        result.sent += 1;
      } else {
        result.failures += 1;
      }
    } catch (error) {
      logger.error("Weekly digest failed for user", { error, userId: user.id });
      result.failures += 1;
    }
  }

  logger.info("Weekly digest run finished", { ...result });
  return result;
}
