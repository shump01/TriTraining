"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import {
  assignAutoTicks,
  type DayActivityCount,
  type PlannerSessionView,
} from "@/lib/week-planner";
import { DISCIPLINE_META, formatDistance, type DisciplineKey } from "@/lib/ui/theme";

/**
 * The week board: this week's sessions laid onto days. Drag a session to
 * another day (or use the ◀ ▶ buttons — the primary control on touch, where
 * HTML5 drag doesn't fire), tick it off when done; sessions matched to a
 * synced activity tick themselves and are shown as "synced".
 *
 * Saves send the whole week (the server's replace-week write) and are
 * SERIALIZED: rapid moves queue behind the in-flight request and collapse
 * into one trailing save of the latest state; on failure the board reverts to
 * the last server-acknowledged week, never a mid-sequence snapshot.
 * Auto-ticks are day-dependent, so they're recomputed locally after every
 * move from the week's activity counts (which only change on sync).
 */

type Session = PlannerSessionView;

const DAY_MS = 86_400_000;

const sessionKey = (s: { discipline: string; slot: number }) => `${s.discipline}|${s.slot}`;

const emptySubscribe = () => () => {};

/** Today's dayOffset by the BROWSER's local calendar day, or null outside the week. */
function localTodayOffset(weekStartDate: string): number | null {
  const [y, m, d] = weekStartDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const weekStartLocal = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const offset = Math.round((todayLocal - weekStartLocal) / DAY_MS);
  return offset >= 0 && offset <= 6 ? offset : null;
}

export function WeekPlannerCard({
  planId,
  weekStartDate,
  dayLabels,
  todayOffset,
  activityCounts,
  initial,
}: {
  planId: string;
  weekStartDate: string;
  dayLabels: string[];
  /** Server's (UTC) idea of today — refined to the browser's local day below. */
  todayOffset: number | null;
  activityCounts: DayActivityCount[];
  initial: Session[];
}) {
  const [sessions, setSessions] = useState<Session[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  // "Today" by the athlete's clock, not the server's: activity dates are the
  // athlete's local days, and a server east or west of them would highlight
  // the wrong column around midnight. Server snapshot keeps hydration stable.
  const today = useSyncExternalStore(
    emptySubscribe,
    () => localTodayOffset(weekStartDate),
    () => todayOffset,
  );

  const latestRef = useRef(initial);
  const ackedRef = useRef(initial);
  const inflightRef = useRef(false);
  const queuedRef = useRef(false);

  if (sessions.length === 0) return null;

  function withAuto(list: Session[]): Session[] {
    const auto = assignAutoTicks(list, activityCounts);
    return list.map((s) => ({ ...s, auto: auto.has(sessionKey(s)) }));
  }

  async function putWeek(snapshot: Session[]): Promise<boolean> {
    try {
      const res = await fetch(`/api/plans/${planId}/sessions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStartDate,
          sessions: snapshot.map((s) => ({
            discipline: s.discipline,
            slot: s.slot,
            label: s.label,
            share: s.share,
            dayOffset: s.dayOffset,
            done: s.done,
          })),
        }),
      });
      if (res.ok) return true;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't save the week.");
      return false;
    } catch {
      setError("Couldn't save the week.");
      return false;
    }
  }

  async function pump() {
    if (inflightRef.current) {
      queuedRef.current = true;
      return;
    }
    inflightRef.current = true;
    setBusy(true);
    try {
      let ok = true;
      do {
        queuedRef.current = false;
        const snapshot = latestRef.current;
        ok = await putWeek(snapshot);
        if (ok) ackedRef.current = snapshot;
      } while (ok && queuedRef.current);
      if (!ok) {
        latestRef.current = ackedRef.current;
        setSessions(withAuto(ackedRef.current));
      }
    } finally {
      inflightRef.current = false;
      setBusy(false);
    }
  }

  function apply(match: string, mutate: (s: Session) => Session) {
    setError(null);
    const next = latestRef.current.map((s) => (sessionKey(s) === match ? mutate(s) : s));
    latestRef.current = next;
    setSessions(withAuto(next));
    void pump();
  }

  function moveTo(key: string, dayOffset: number) {
    if (dayOffset < 0 || dayOffset > 6) return;
    apply(key, (s) => ({ ...s, dayOffset }));
  }

  return (
    <div className="mt-[18px] max-w-[1100px] rounded-[16px] border border-border bg-card p-[22px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-display text-[16px] font-bold">This week, day by day</h3>
        <span className="font-mono text-[12px] text-faint">
          {busy ? "saving…" : "drag, or tap ◀ ▶, to move a session"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {dayLabels.map((label, day) => (
          <div
            key={day}
            onDragOver={(e) => {
              if (dragKey) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) moveTo(dragKey, day);
              setDragKey(null);
            }}
            className={`min-h-[88px] rounded-[12px] border p-2 ${
              day === today ? "border-brand bg-bg2" : "border-border bg-bg2/50"
            }`}
          >
            <div
              className={`mb-1.5 font-mono text-[11px] tracking-[0.06em] uppercase ${
                day === today ? "font-bold text-brand" : "text-faint"
              }`}
            >
              {label}
              {day === today && " · today"}
            </div>
            <div className="flex flex-col gap-1.5">
              {sessions
                .filter((s) => s.dayOffset === day)
                .map((s) => {
                  const key = sessionKey(s);
                  const complete = s.done || s.auto;
                  const meta = DISCIPLINE_META[s.discipline as DisciplineKey];
                  return (
                    <div
                      key={key}
                      draggable
                      onDragStart={() => setDragKey(key)}
                      onDragEnd={() => setDragKey(null)}
                      className={`cursor-grab rounded-[10px] border border-border bg-card p-2 ${
                        complete ? "opacity-75" : ""
                      }`}
                      style={{ borderLeft: `3px solid ${meta?.color ?? "var(--brand)"}` }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span
                          className={`text-[12.5px] leading-[1.3] font-semibold ${
                            complete ? "text-muted line-through" : "text-text"
                          }`}
                        >
                          {s.label}
                        </span>
                        {s.auto ? (
                          <span
                            className="mt-[1px] shrink-0 font-mono text-[10px] font-bold"
                            style={{ color: "var(--on-track)" }}
                            title="Matched to a synced activity"
                          >
                            ✓ synced
                          </span>
                        ) : (
                          <label className="-m-1.5 shrink-0 cursor-pointer p-1.5">
                            <input
                              type="checkbox"
                              checked={s.done}
                              onChange={(e) =>
                                apply(key, (v) => ({ ...v, done: e.target.checked }))
                              }
                              aria-label={`Mark ${s.label} done`}
                              className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                            />
                          </label>
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <span className="font-mono text-[11.5px] text-muted">
                          {formatDistance(s.meters, s.discipline as DisciplineKey)}
                        </span>
                        <span className="flex">
                          <button
                            type="button"
                            onClick={() => moveTo(key, s.dayOffset - 1)}
                            disabled={s.dayOffset === 0}
                            aria-label={`Move ${s.label} a day earlier`}
                            className="grid h-7 w-7 cursor-pointer place-items-center rounded text-[12px] text-faint hover:text-text disabled:opacity-30"
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTo(key, s.dayOffset + 1)}
                            disabled={s.dayOffset === 6}
                            aria-label={`Move ${s.label} a day later`}
                            className="grid h-7 w-7 cursor-pointer place-items-center rounded text-[12px] text-faint hover:text-text disabled:opacity-30"
                          >
                            ▶
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-2.5 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
      <p className="mt-2.5 mb-0 text-[12px] leading-[1.5] text-faint">
        Distances follow the week&apos;s current targets — if the plan re-ramps, they rescale.
        &ldquo;Synced&rdquo; ticks come from HR-recorded activities on the same day and sport, from
        your active sync source (Strava when connected, else Garmin, else Apple Health). Activities
        without heart rate — most pool swims — still count toward weekly totals but won&apos;t
        auto-tick; use the checkbox.
      </p>
    </div>
  );
}
