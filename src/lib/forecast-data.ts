import { resolveEffectiveActuals } from "@/lib/actuals";
import { pickFeaturedPlan } from "@/lib/featured-plan";
import {
  buildRaceForecast,
  deriveTssPerMeter,
  type ForecastDiscipline,
  type ForecastVerdict,
  type ForecastWeek,
  type WeekSample,
} from "@/lib/forecast";
import { getLoadRows, getLoadUser, pickLoadSource } from "@/lib/load-data";
import { prisma } from "@/lib/prisma";
import { activityTss, type DailyTss, type LoadPoint } from "@/lib/training-load";
import { requireUserId } from "@/lib/training-plan";
import { planStartWeek, startOfWeek } from "@/lib/weekly-targets";

/**
 * Data assembly for the race forecast (see src/lib/forecast.ts): the featured
 * plan's remaining weekly targets + the athlete's real load history, with the
 * meters→TSS rates calibrated from their own recent completed weeks.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** How far back athlete-rate calibration looks. */
const CALIBRATION_WEEKS = 8;

export interface RaceForecastView {
  planName: string;
  raceDayMs: number;
  daysToRace: number;
  anchor: LoadPoint;
  projection: LoadPoint[];
  raceDay: { fitness: number; fatigue: number; form: number };
  verdict: ForecastVerdict;
  peakFitness: number;
  /** Discipline labels calibrated from the athlete's own weeks (may be empty). */
  calibrated: string[];
  /** Discipline labels that fell back to standard rates (may be empty). */
  assumed: string[];
}

const DISCIPLINE_LABEL: Record<ForecastDiscipline, string> = {
  SWIM: "swim",
  BIKE: "bike",
  RUN: "run",
};

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The session user's race forecast, or null when it can't be computed: no
 * threshold HR, no HR-recorded history, no live featured plan, or the race is
 * today/past. The Load page hides the card on null.
 */
export async function getRaceForecast(now: Date = new Date()): Promise<RaceForecastView | null> {
  const userId = await requireUserId();
  const todayMs = utcMidnight(now.getTime());

  // Per-request memoized (see load-data.ts) — the /load page reads the same
  // user row and load rows for the PMC, so these don't hit the DB twice.
  const user = await getLoadUser(userId);
  const thresholdHr = user?.thresholdHr ?? null;
  if (!user || !thresholdHr) return null;

  const loadSource = pickLoadSource(user);
  const loads = await getLoadRows(userId, loadSource);
  if (loads.length === 0) return null;

  const candidates = await prisma.trainingPlan.findMany({
    where: { userId, eventDate: { gte: new Date(todayMs) } },
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
  // Day-granular ranking: eventDate is a UTC-midnight date, so ranking against
  // the wall clock would drop the plan on race-day morning.
  const featured = pickFeaturedPlan(
    candidates.map((p) => ({
      ...p,
      eventMs: p.eventDate.getTime(),
      startMs: planStartWeek(p).getTime(),
    })),
    todayMs,
  );
  if (!featured) return null;

  const raceDayMs = utcMidnight(featured.eventDate.getTime());
  if (raceDayMs <= todayMs) return null;

  const plan = await prisma.trainingPlan.findFirst({
    where: { id: featured.id, userId },
    select: {
      weekStartDay: true,
      weeklyTargets: { select: { discipline: true, weekStartDate: true, targetMeters: true } },
      weeklyActuals: {
        select: { discipline: true, weekStartDate: true, actualMeters: true, source: true },
      },
      weeklyPauses: { select: { weekStartDate: true } },
    },
  });
  if (!plan) return null;

  const currentWeekMs = startOfWeek(now, plan.weekStartDay).getTime();

  // ── Athlete calibration: TSS and effective meters per completed week ──────
  const history: DailyTss[] = [];
  const weekTss = new Map<string, number>(); // `${discipline}|${weekMs}` → tss
  for (const row of loads) {
    const tss = activityTss(row.movingSeconds, row.avgHr, thresholdHr);
    history.push({ dateMs: row.date.getTime(), tss });
    const weekMs = startOfWeek(row.date, plan.weekStartDay).getTime();
    const key = `${row.discipline}|${weekMs}`;
    weekTss.set(key, (weekTss.get(key) ?? 0) + tss);
  }

  const effective = resolveEffectiveActuals(plan.weeklyActuals);
  const samples: WeekSample[] = [];
  for (const [key, tss] of weekTss) {
    const [discipline, weekMsStr] = key.split("|");
    const weekMs = Number(weekMsStr);
    // Completed, recent weeks only — the current week is still being lived.
    if (weekMs >= currentWeekMs || weekMs < currentWeekMs - CALIBRATION_WEEKS * WEEK_MS) continue;
    const eff = effective.get(key);
    // The ratio is only meaningful when numerator and denominator describe the
    // SAME sessions: TSS comes from the one load source, so the meters must
    // too (or be the athlete's own manual override). A week whose effective
    // meters came from a different provider would skew the rate.
    if (!eff || (eff.source !== loadSource && eff.source !== "MANUAL")) continue;
    if (eff.meters > 0 && tss > 0) {
      samples.push({ discipline: discipline as ForecastDiscipline, meters: eff.meters, tss });
    }
  }
  const { rates, derived } = deriveTssPerMeter(samples);

  // ── Remaining plan weeks (current week through race week) ─────────────────
  const pausedWeeks = new Set(plan.weeklyPauses.map((p) => p.weekStartDate.getTime()));
  const weekMap = new Map<number, ForecastWeek>();
  for (const t of plan.weeklyTargets) {
    const weekMs = t.weekStartDate.getTime();
    if (weekMs < currentWeekMs) continue;
    let entry = weekMap.get(weekMs);
    if (!entry) {
      entry = { weekStartMs: weekMs, targets: [], paused: pausedWeeks.has(weekMs) };
      weekMap.set(weekMs, entry);
    }
    entry.targets.push({
      discipline: t.discipline as ForecastDiscipline,
      targetMeters: t.targetMeters,
    });
  }
  const weeks = [...weekMap.values()];

  const forecast = buildRaceForecast({
    history,
    nowMs: now.getTime(),
    raceDayMs,
    weeks,
    rates,
  });
  if (!forecast) return null;

  // Only report calibration for disciplines the remaining plan actually contains.
  const futureDisciplines = new Set<ForecastDiscipline>(
    weeks.flatMap((w) => w.targets.map((t) => t.discipline)),
  );
  const calibrated: string[] = [];
  const assumed: string[] = [];
  for (const d of futureDisciplines) {
    (derived[d] ? calibrated : assumed).push(DISCIPLINE_LABEL[d]);
  }

  return {
    planName: featured.name,
    raceDayMs,
    daysToRace: Math.round((raceDayMs - todayMs) / DAY_MS),
    ...forecast,
    calibrated: calibrated.sort(),
    assumed: assumed.sort(),
  };
}
