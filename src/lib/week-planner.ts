import { sessionTemplate, type SessionDiscipline } from "@/lib/sessions";

/**
 * The week planner: a week's suggested sessions laid onto actual days, so the
 * weekly volume number becomes "what am I doing today?".
 *
 * Pure and dependency-free. Sessions are SHARE-based (fraction of the week's
 * discipline target), so distances always reflect the current targets — a
 * re-ramp rewriting the week rescales every session for free. Untouched weeks
 * are never stored: the default layout below is computed on demand, and rows
 * materialize only when the athlete moves or ticks something (see
 * replaceWeekSessions in src/lib/training-plan.ts).
 *
 * Completion has two channels: a stored manual tick, and a derived auto-tick
 * when a synced activity of the same discipline landed on the same day
 * (count-based, so one ride doesn't tick a double day twice). Auto-ticks are
 * recomputed at read time and never stored — the same doctrine as actual
 * precedence and TSS.
 */

const DAY_MS = 86_400_000;

export interface PlannerSessionSpec {
  discipline: SessionDiscipline;
  /** Stable ordinal within (week, discipline) — identity across day moves. */
  slot: number;
  label: string;
  /** Fraction (0..1] of the week's discipline target. */
  share: number;
  /** 0..6 — day within the plan's training week (0 = the week-start day). */
  dayOffset: number;
}

export interface PlannerSessionView extends PlannerSessionSpec {
  /** Concrete distance under the week's CURRENT targets. */
  meters: number;
  /** Stored manual tick. */
  done: boolean;
  /** Derived from a synced same-day, same-discipline activity. */
  auto: boolean;
}

/**
 * Default calendar day-of-week (0=Sun..6=Sat) per template slot. Anchored to
 * CALENDAR days, not week-relative ones: long sessions belong to the athlete's
 * actual weekend whatever day their training week starts on. Cross-discipline
 * clashes (a swim and a run on Tuesday) are normal triathlon doubling.
 */
const DEFAULT_DOW: Record<SessionDiscipline, number[]> = {
  SWIM: [2, 4, 6], // Endurance Tue · Threshold Thu · Technique Sat
  BIKE: [6, 3, 5], // Long ride Sat · Tempo Wed · Recovery spin Fri
  RUN: [0, 2, 4], // Long run Sun · Tempo Tue · Easy Thu
};

/** Rotated day names for the board's columns: index = dayOffset. */
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export function dayLabels(weekStartDay: number): string[] {
  return Array.from({ length: 7 }, (_, i) => DOW_NAMES[(weekStartDay + i + 7) % 7]!);
}

/**
 * The computed default layout for a week nobody has touched: the suggested
 * split of each discipline's target, each session on its conventional day.
 */
export function defaultWeekLayout(
  targets: { discipline: SessionDiscipline; weekMeters: number }[],
  weekStartDay: number,
): PlannerSessionSpec[] {
  const specs: PlannerSessionSpec[] = [];
  for (const t of targets) {
    if (!(t.weekMeters > 0)) continue;
    sessionTemplate(t.discipline).forEach((tpl, i) => {
      const dow = DEFAULT_DOW[t.discipline][i] ?? DEFAULT_DOW[t.discipline][0]!;
      specs.push({
        discipline: t.discipline,
        slot: i,
        label: tpl.label,
        share: tpl.frac,
        dayOffset: (dow - weekStartDay + 7) % 7,
      });
    });
  }
  return specs;
}

/** Synced activities bucketed onto the week's days. */
export interface DayActivityCount {
  dayOffset: number;
  discipline: SessionDiscipline;
  count: number;
}

/**
 * Bucket per-activity load rows (UTC-midnight local dates) onto a week's day
 * offsets. Rows outside the week are dropped.
 */
export function activityCountsForWeek(
  rows: { date: Date; discipline: string }[],
  weekStartMs: number,
): DayActivityCount[] {
  const counts = new Map<string, DayActivityCount>();
  for (const row of rows) {
    const offset = Math.floor((row.date.getTime() - weekStartMs) / DAY_MS);
    if (offset < 0 || offset > 6) continue;
    const key = `${row.discipline}|${offset}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        dayOffset: offset,
        discipline: row.discipline as SessionDiscipline,
        count: 1,
      });
    }
  }
  return [...counts.values()];
}

/**
 * Which sessions a week's synced activities tick, as `discipline|slot` keys.
 * Slot-order within each (day, discipline), consuming the day's activity
 * count: two sessions on one day need two activities to both tick. Exported
 * separately so the client board can recompute auto-ticks after a local move
 * without a round-trip (the counts themselves only change on sync).
 */
export function assignAutoTicks(
  sessions: PlannerSessionSpec[],
  activityCounts: DayActivityCount[],
): Set<string> {
  const remaining = new Map<string, number>();
  for (const c of activityCounts) {
    remaining.set(`${c.discipline}|${c.dayOffset}`, c.count);
  }
  const autoKeys = new Set<string>();
  const ordered = [...sessions].sort(
    (a, b) => a.discipline.localeCompare(b.discipline) || a.slot - b.slot,
  );
  for (const s of ordered) {
    const key = `${s.discipline}|${s.dayOffset}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      autoKeys.add(`${s.discipline}|${s.slot}`);
    }
  }
  return autoKeys;
}

/**
 * Resolve a week's sessions into the view the UI renders: concrete distances
 * (shares × current targets, last slot absorbing the rounding remainder so a
 * discipline's sessions sum exactly to its target) and completion state.
 */
export function buildWeekView(
  sessions: (PlannerSessionSpec & { done: boolean })[],
  targetByDiscipline: Partial<Record<SessionDiscipline, number>>,
  activityCounts: DayActivityCount[],
): PlannerSessionView[] {
  // Distances: per discipline, in slot order, remainder on the last slot.
  const byDiscipline = new Map<SessionDiscipline, (PlannerSessionSpec & { done: boolean })[]>();
  for (const s of sessions) {
    const list = byDiscipline.get(s.discipline) ?? [];
    list.push(s);
    byDiscipline.set(s.discipline, list);
  }

  const metersByKey = new Map<string, number>();
  for (const [discipline, list] of byDiscipline) {
    const weekMeters = Math.max(0, targetByDiscipline[discipline] ?? 0);
    const sorted = [...list].sort((a, b) => a.slot - b.slot);
    let allocated = 0;
    sorted.forEach((s, i) => {
      const meters =
        i === sorted.length - 1
          ? Math.max(weekMeters - allocated, 0)
          : Math.round(weekMeters * s.share);
      allocated += meters;
      metersByKey.set(`${discipline}|${s.slot}`, meters);
    });
  }

  const autoKeys = assignAutoTicks(sessions, activityCounts);

  return sessions
    .map((s) => ({
      ...s,
      meters: metersByKey.get(`${s.discipline}|${s.slot}`) ?? 0,
      auto: autoKeys.has(`${s.discipline}|${s.slot}`),
    }))
    .sort(
      (a, b) =>
        a.dayOffset - b.dayOffset || a.discipline.localeCompare(b.discipline) || a.slot - b.slot,
    );
}

/**
 * Assemble one week's planner view from plan data: the stored sessions when
 * the athlete has taken ownership of the week, else the computed default
 * layout — plus distances under the week's current targets and auto-ticks
 * from the synced activities that landed inside the week.
 */
export function assembleWeekView(input: {
  weekStartMs: number;
  weekStartDay: number;
  /** Stored PlannedSession rows for THIS week (may be empty). */
  stored: {
    discipline: string;
    slot: number;
    label: string;
    share: number;
    dayOffset: number;
    completedAt: Date | null;
  }[];
  /** The week's targets, one entry per discipline. */
  targets: { discipline: string; weekMeters: number }[];
  /** Per-activity load rows (any range — filtered to the week here). */
  loadRows: { date: Date; discipline: string }[];
}): PlannerSessionView[] {
  // Per-discipline merge: stored rows win for disciplines the athlete has
  // placed; a discipline added to the plan after the week materialized falls
  // back to its default layout slice; and stored rows whose discipline no
  // longer has a target are dropped (plan edits clean those up, but a stale
  // row must never brick the board).
  const storedByDiscipline = new Map<string, typeof input.stored>();
  const targetDisciplines = new Set(input.targets.map((t) => t.discipline));
  for (const r of input.stored) {
    if (!targetDisciplines.has(r.discipline)) continue;
    const list = storedByDiscipline.get(r.discipline) ?? [];
    list.push(r);
    storedByDiscipline.set(r.discipline, list);
  }

  const specs: (PlannerSessionSpec & { done: boolean })[] = [];
  for (const t of input.targets) {
    const rows = storedByDiscipline.get(t.discipline);
    if (rows && rows.length > 0) {
      specs.push(
        ...rows.map((r) => ({
          discipline: r.discipline as SessionDiscipline,
          slot: r.slot,
          label: r.label,
          share: r.share,
          dayOffset: r.dayOffset,
          done: r.completedAt != null,
        })),
      );
    } else {
      specs.push(
        ...defaultWeekLayout(
          [{ discipline: t.discipline as SessionDiscipline, weekMeters: t.weekMeters }],
          input.weekStartDay,
        ).map((s) => ({ ...s, done: false })),
      );
    }
  }

  const targetByDiscipline: Partial<Record<SessionDiscipline, number>> = {};
  for (const t of input.targets) {
    targetByDiscipline[t.discipline as SessionDiscipline] = t.weekMeters;
  }

  return buildWeekView(
    specs,
    targetByDiscipline,
    activityCountsForWeek(input.loadRows, input.weekStartMs),
  );
}
