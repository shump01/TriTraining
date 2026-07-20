import { prisma } from "@/lib/prisma";
import {
  activityTss,
  buildLoadSeries,
  summarizeLoad,
  type LoadPoint,
  type LoadSummary,
} from "@/lib/training-load";
import { requireUserId } from "@/lib/training-plan";
import {
  INTENSITY_WINDOW_DAYS,
  buildIntensityDistribution,
  type IntensityDistribution,
} from "@/lib/zones";

/**
 * User-scoped read/write for HR training load. TSS is computed at read time from
 * stored movingSeconds + avgHr and the athlete's *current* thresholdHr, so
 * updating the threshold recomputes the whole history.
 */

const DAY_MS = 86_400_000;

export interface TrainingLoad {
  /** The athlete's lactate-threshold HR, or null if not set. */
  thresholdHr: number | null;
  /** Whether any HR-recorded activities have been synced (from the chosen source). */
  hasActivities: boolean;
  /** Which sync feeds the load numbers — see the one-source rule in readUserLoad. */
  loadSource: "STRAVA" | "GARMIN" | "APPLE_HEALTH";
  series: LoadPoint[];
  summary: LoadSummary | null;
  /** Time-in-zone over the last INTENSITY_WINDOW_DAYS. Null with nothing to score. */
  intensity: IntensityDistribution | null;
}

/** Read + compute a specific user's training load. Shared by the callers below. */
async function readUserLoad(userId: string): Promise<TrainingLoad> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      thresholdHr: true,
      stravaConnection: { select: { id: true } },
      garminConnection: { select: { id: true } },
    },
  });

  // ONE source feeds load — the same "never summed" doctrine as weekly actuals,
  // applied at read time. A workout can reach us from several syncs (Garmin
  // users often auto-mirror to Strava); summing them would double its TSS into
  // CTL/ATL/TSB, the zones, and the re-ramp's Form factor. Rule: Strava when
  // connected (the athlete-chosen integration, and the incumbent — connecting
  // Garmin must never silently change a Strava user's numbers), else Garmin,
  // else Apple Health. Mirrors SOURCE_RANK in actuals.ts. A per-user override
  // is a deliberate non-feature until someone actually needs it.
  const loadSource = user?.stravaConnection
    ? ("STRAVA" as const)
    : user?.garminConnection
      ? ("GARMIN" as const)
      : ("APPLE_HEALTH" as const);

  const loads = await prisma.activityLoad.findMany({
    where: { userId, source: loadSource },
    select: { date: true, movingSeconds: true, avgHr: true },
    orderBy: { date: "asc" },
  });

  const thresholdHr = user?.thresholdHr ?? null;
  const hasActivities = loads.length > 0;

  // Nothing to chart until both a threshold and some HR activities exist.
  if (!thresholdHr || !hasActivities) {
    return { thresholdHr, hasActivities, loadSource, series: [], summary: null, intensity: null };
  }

  const now = Date.now();
  const daily = loads.map((l) => ({
    dateMs: l.date.getTime(),
    tss: activityTss(l.movingSeconds, l.avgHr, thresholdHr),
  }));
  const series = buildLoadSeries(daily, now);

  // The intensity distribution looks at a recent block only — "am I training at
  // the right intensities *lately*" — and reuses the rows already fetched above.
  const windowStart = now - INTENSITY_WINDOW_DAYS * DAY_MS;
  const recent = loads.filter((l) => l.date.getTime() >= windowStart);

  return {
    thresholdHr,
    hasActivities,
    loadSource,
    series,
    summary: summarizeLoad(series),
    intensity: buildIntensityDistribution(recent, thresholdHr),
  };
}

export async function getTrainingLoad(): Promise<TrainingLoad> {
  return readUserLoad(await requireUserId());
}

/**
 * A user's current Form (TSB), or null when it can't be computed yet (no
 * threshold HR set, or no HR-recorded activities). Takes an explicit userId so
 * the adaptive re-ramp can fold Form into the ramp without re-reading the
 * session. See [formLoadFactor](src/lib/training-load.ts).
 */
export async function getUserFormTsb(userId: string): Promise<number | null> {
  const { summary } = await readUserLoad(userId);
  return summary?.form ?? null;
}

/** Set (or clear) the athlete's threshold HR. Scoped to the session user. */
export async function setThresholdHr(thresholdHr: number | null): Promise<void> {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { thresholdHr } });
}
