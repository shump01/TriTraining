/**
 * Heart-rate zones and the intensity distribution — the "at what intensity?"
 * companion to training-load's "how much?". Pure and dependency-free; the data
 * layer supplies the activities to score.
 *
 * Zones are the standard Friel LTHR bands, expressed as a fraction of the
 * athlete's threshold HR. The distribution then collapses to the three bands the
 * polarized-training literature actually argues about:
 *
 *   easy (Z1–Z2)  — below the aerobic threshold; the bulk of a healthy week
 *   grey (Z3)     — tempo: too hard to recover from, too easy to drive adaptation
 *   hard (Z4–Z5)  — at/above threshold; the part that's meant to hurt
 *
 * The usual target is roughly 80% easy / 20% hard with little time in between.
 *
 * IMPORTANT — the method's limit. Strava gives us a session's AVERAGE HR, not its
 * HR stream, so each activity is scored as a whole by that single number. Steady
 * sessions score honestly; an interval session does not — Z1 warm-up plus Z5 reps
 * averages out to Z3, so interval work lands in the grey zone it never actually
 * trained. That biases this distribution *toward* the middle. Read it as "where
 * my average efforts sat", not as true time-in-zone, and treat a grey-zone
 * reading as a prompt to look rather than a verdict. Real time-in-zone needs the
 * HR stream per activity (Strava's /activities/{id}/streams).
 *
 * One further approximation, inherited from training-load: a single thresholdHr
 * is used for every discipline, though LTHR genuinely differs between swim, bike
 * and run.
 */

export type Zone = 1 | 2 | 3 | 4 | 5;

/** Each zone's lower bound as a fraction of threshold HR (Friel LTHR bands). */
const ZONE_FLOOR: Record<Zone, number> = { 1: 0, 2: 0.81, 3: 0.9, 4: 0.94, 5: 1.0 };

export const ZONE_META: Record<Zone, { label: string; blurb: string; band: Band }> = {
  1: { label: "Z1", blurb: "Recovery", band: "easy" },
  2: { label: "Z2", blurb: "Endurance", band: "easy" },
  3: { label: "Z3", blurb: "Tempo", band: "grey" },
  4: { label: "Z4", blurb: "Threshold", band: "hard" },
  5: { label: "Z5", blurb: "VO₂max", band: "hard" },
};

export type Band = "easy" | "grey" | "hard";

/** Days of training the distribution looks back over — one four-week block. */
export const INTENSITY_WINDOW_DAYS = 28;

/** The share of time the polarized model wants spent easy. */
export const EASY_TARGET_PCT = 80;

export const ZONES: Zone[] = [1, 2, 3, 4, 5];

/**
 * The zone an activity's AVERAGE heart rate falls in. Null when either input is
 * unusable. See the module note: this scores a whole session by one number.
 */
export function hrZone(avgHr: number, thresholdHr: number): Zone | null {
  if (!(avgHr > 0) || !(thresholdHr > 0)) return null;
  const ratio = avgHr / thresholdHr;
  if (ratio >= ZONE_FLOOR[5]) return 5;
  if (ratio >= ZONE_FLOOR[4]) return 4;
  if (ratio >= ZONE_FLOOR[3]) return 3;
  if (ratio >= ZONE_FLOOR[2]) return 2;
  return 1;
}

export interface ZoneBucket {
  zone: Zone;
  seconds: number;
  /** Share of the window's total time, rounded. */
  pct: number;
}

export type IntensityVerdict = "polarized" | "balanced" | "greyZone" | "tooHard";

export interface IntensityDistribution {
  /** One bucket per zone, Z1…Z5, always all five (zeroes included). */
  buckets: ZoneBucket[];
  totalSeconds: number;
  activityCount: number;
  /** Rounded shares of the three polarized bands. */
  easyPct: number;
  greyPct: number;
  hardPct: number;
  verdict: { key: IntensityVerdict; label: string; detail: string };
}

/** Thresholds for the verdict, on the raw (unrounded) band shares. */
const GREY_HIGH = 25;
const EASY_LOW = 65;
const EASY_GOOD = 75;
const GREY_LOW = 15;

function verdictFor(
  easyPct: number,
  greyPct: number,
): { key: IntensityVerdict; label: string; detail: string } {
  if (greyPct > GREY_HIGH) {
    return {
      key: "greyZone",
      label: "Heavy on the grey zone",
      detail:
        "A lot of your time averages out at tempo — the pace that's too hard to recover from and too easy to drive much adaptation. Worth checking your easy days are genuinely easy.",
    };
  }
  if (easyPct < EASY_LOW) {
    return {
      key: "tooHard",
      label: "Not much easy volume",
      detail:
        "Under two thirds of your training is easy. Most endurance volume is meant to be conversational, with the hard work saved for fewer, better sessions.",
    };
  }
  if (easyPct >= EASY_GOOD && greyPct <= GREY_LOW) {
    return {
      key: "polarized",
      label: "Nicely polarized",
      detail:
        "Plenty of easy volume, and what's left is kept genuinely hard — the shape the research keeps pointing at.",
    };
  }
  return {
    key: "balanced",
    label: "Reasonably balanced",
    detail: `Roughly the 80/20 shape. Nudging a little more time into the easy band would sharpen it.`,
  };
}

/**
 * Time-in-zone across the supplied activities. Returns null when there's nothing
 * usable to score (no threshold, or no activity with both HR and duration).
 *
 * The caller decides the window (see INTENSITY_WINDOW_DAYS) — this is pure.
 */
export function buildIntensityDistribution(
  activities: { movingSeconds: number; avgHr: number }[],
  thresholdHr: number,
): IntensityDistribution | null {
  if (!(thresholdHr > 0)) return null;

  const seconds: Record<Zone, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let totalSeconds = 0;
  let activityCount = 0;

  for (const a of activities) {
    const zone = hrZone(a.avgHr, thresholdHr);
    if (zone == null || !(a.movingSeconds > 0)) continue;
    seconds[zone] += a.movingSeconds;
    totalSeconds += a.movingSeconds;
    activityCount += 1;
  }
  if (totalSeconds === 0) return null;

  const share = (s: number) => (s / totalSeconds) * 100;
  // The verdict reads the raw shares; only the reported numbers are rounded.
  const rawEasy = share(seconds[1] + seconds[2]);
  const rawGrey = share(seconds[3]);
  const rawHard = share(seconds[4] + seconds[5]);

  return {
    buckets: ZONES.map((zone) => ({
      zone,
      seconds: seconds[zone],
      pct: Math.round(share(seconds[zone])),
    })),
    totalSeconds,
    activityCount,
    easyPct: Math.round(rawEasy),
    greyPct: Math.round(rawGrey),
    hardPct: Math.round(rawHard),
    verdict: verdictFor(rawEasy, rawGrey),
  };
}
