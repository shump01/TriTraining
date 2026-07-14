"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { computeWeeklyTargets, startOfWeek } from "@/lib/weekly-targets";

import { VolumeChart } from "./[id]/charts";
import type { DiscKey, PlanFormValues } from "./plan-form-values";

export type { PlanFormValues } from "./plan-form-values";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DISC = [
  {
    key: "SWIM",
    label: "Swim",
    color: "var(--swim)",
    unit: "m",
    factor: 1,
    event: "3800",
    start: "2200",
  },
  {
    key: "BIKE",
    label: "Bike",
    color: "var(--bike)",
    unit: "km",
    factor: 1000,
    event: "180",
    start: "42",
  },
  {
    key: "RUN",
    label: "Run",
    color: "var(--run)",
    unit: "km",
    factor: 1000,
    event: "42.2",
    start: "16",
  },
] as const;

type Field = "event" | "start";

const inputClass =
  "w-full rounded-[10px] border border-border bg-input px-3 py-[10px] text-[14px] text-text outline-none focus:border-brand";

// value = JS getUTCDay() index (0=Sunday). Ordered Monday-first for display.
const WEEKDAYS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const;

// Standard triathlon race distances — event distances in each sport's DISPLAY
// unit (swim m, bike/run km), matching the form inputs.
const RACE_PRESETS = [
  { key: "sprint", label: "Sprint", event: { SWIM: "750", BIKE: "20", RUN: "5" } },
  { key: "olympic", label: "Olympic", event: { SWIM: "1500", BIKE: "40", RUN: "10" } },
  { key: "half", label: "Half (70.3)", event: { SWIM: "1900", BIKE: "90", RUN: "21.1" } },
  { key: "full", label: "Full (Ironman)", event: { SWIM: "3800", BIKE: "180", RUN: "42.2" } },
] as const;

const PRIORITIES = [
  { value: "A", label: "A — goal race" },
  { value: "B", label: "B — secondary" },
  { value: "C", label: "C — tune-up" },
] as const;

function minEventDate(): string {
  return new Date(Date.now() + ONE_WEEK_MS).toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Shared create/edit form. When `planId` is set it edits that plan (PUT);
 * otherwise it creates a new one (POST). Distances are shown in each sport's
 * display unit (km for bike/run, m for swim) and converted to meters on submit.
 */
export function PlanForm({
  planId,
  initial,
  stravaConnected = false,
}: {
  planId?: string;
  initial: PlanFormValues;
  /** Whether the user has a Strava connection — only relevant when creating a new plan. */
  stravaConnected?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(planId);

  const [name, setName] = useState(initial.name);
  const [eventDate, setEventDate] = useState(initial.eventDate);
  const [startDate, setStartDate] = useState(initial.startDate || todayIso());
  const [capMultiple, setCapMultiple] = useState(initial.capMultiple || "1.5");
  const [weekStartDay, setWeekStartDay] = useState(initial.weekStartDay || "1");
  const [taperWeeks, setTaperWeeks] = useState(initial.taperWeeks || "2");
  const [priority, setPriority] = useState(initial.priority || "A");
  const [preset, setPreset] = useState("");
  const [values, setValues] = useState<Record<DiscKey, Record<Field, string>>>(() => ({
    SWIM: { event: initial.disciplines.SWIM.event, start: initial.disciplines.SWIM.start },
    BIKE: { event: initial.disciplines.BIKE.event, start: initial.disciplines.BIKE.start },
    RUN: { event: initial.disciplines.RUN.event, start: initial.disciplines.RUN.start },
  }));
  const [enabled, setEnabled] = useState<Record<DiscKey, boolean>>(() => ({
    SWIM: initial.disciplines.SWIM.enabled,
    BIKE: initial.disciplines.BIKE.enabled,
    RUN: initial.disciplines.RUN.enabled,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [stravaStatus, setStravaStatus] = useState<"idle" | "loading" | "loaded" | "unavailable">(
    () => (!isEdit && stravaConnected ? "loading" : "idle"),
  );
  const [autofilled, setAutofilled] = useState<Partial<Record<DiscKey, boolean>>>({});

  // New plans only: check for recent Strava activity and prefill blank
  // "starting weekly" fields with the last 4 weeks' average per discipline.
  useEffect(() => {
    if (isEdit || !stravaConnected) return;
    let cancelled = false;
    fetch("/api/strava/weekly-average")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((data: { connected: boolean; averages: Record<DiscKey, number> }) => {
        if (cancelled) return;
        if (!data.connected) {
          setStravaStatus("unavailable");
          return;
        }
        setStravaStatus("loaded");
        const filled: Partial<Record<DiscKey, boolean>> = {};
        setValues((prev) => {
          const next = { ...prev };
          for (const d of DISC) {
            const avgMeters = data.averages[d.key];
            if (avgMeters > 0 && prev[d.key].start.trim() === "") {
              const display =
                d.factor === 1 ? String(Math.round(avgMeters)) : (avgMeters / d.factor).toFixed(1);
              next[d.key] = { ...next[d.key], start: display };
              filled[d.key] = true;
            }
          }
          return next;
        });
        setAutofilled((prev) => ({ ...prev, ...filled }));
      })
      .catch(() => {
        if (!cancelled) setStravaStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount — a new plan's Strava connection state doesn't change mid-form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set(key: DiscKey, field: Field, value: string) {
    setValues((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    if (field === "start" && autofilled[key]) {
      setAutofilled((prev) => ({ ...prev, [key]: false }));
    }
  }

  // A race preset fills the standard event distances and enables all sports;
  // it never touches the (personal) starting weekly volumes.
  function applyPreset(key: string) {
    setPreset(key);
    const p = RACE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setValues((prev) => ({
      SWIM: { ...prev.SWIM, event: p.event.SWIM },
      BIKE: { ...prev.BIKE, event: p.event.BIKE },
      RUN: { ...prev.RUN, event: p.event.RUN },
    }));
    setEnabled({ SWIM: true, BIKE: true, RUN: true });
  }

  // Live preview of the generated weekly-volume curve (total across enabled
  // sports), recomputed as inputs change with the same pure engine the server
  // persists — including the taper. Incomplete/invalid inputs yield no preview.
  const preview = useMemo(() => {
    if (!startDate || !eventDate) return null;
    const sd = new Date(startDate);
    const ed = new Date(eventDate);
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) return null;
    const cap = Number(capMultiple);
    if (!(cap >= 1)) return null;
    const taper = Number(taperWeeks) || 0;

    let startWeek: Date;
    try {
      startWeek = startOfWeek(sd, Number(weekStartDay));
    } catch {
      return null;
    }
    if (startWeek.getTime() >= ed.getTime()) return null;

    const totals = new Map<number, number>();
    for (const d of DISC) {
      if (!enabled[d.key]) continue;
      const eventM = Number(values[d.key].event) * d.factor;
      const startM = Number(values[d.key].start) * d.factor;
      if (!(eventM > 0) || !(startM > 0)) continue;
      let rows;
      try {
        rows = computeWeeklyTargets({
          startDate: startWeek,
          eventDate: ed,
          startingWeeklyMeters: startM,
          eventDistanceMeters: eventM,
          capMultiple: cap,
          taperWeeks: taper,
        });
      } catch {
        continue;
      }
      for (const t of rows) {
        const ms = t.weekStartDate.getTime();
        totals.set(ms, (totals.get(ms) ?? 0) + t.targetMeters);
      }
    }
    if (totals.size === 0) return null;
    const chartRows = [...totals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, target]) => ({ weekStartMs: ms, target, actual: null as number | null }));
    return { rows: chartRows, startVol: chartRows[0]?.target ?? null };
  }, [startDate, eventDate, weekStartDay, capMultiple, taperWeeks, values, enabled]);

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    if (!eventDate) {
      next.eventDate = "Event date is required";
    } else {
      const d = new Date(eventDate);
      if (Number.isNaN(d.getTime())) next.eventDate = "Enter a valid date";
      else if (d.getTime() <= Date.now()) next.eventDate = "Must be in the future";
      else if (d.getTime() - Date.now() < ONE_WEEK_MS) next.eventDate = "At least 1 week away";
    }
    if (!startDate) {
      next.startDate = "Start date is required";
    } else if (Number.isNaN(new Date(startDate).getTime())) {
      next.startDate = "Enter a valid date";
    } else if (eventDate && new Date(startDate).getTime() >= new Date(eventDate).getTime()) {
      next.startDate = "Must be before the event date";
    }
    if (capMultiple.trim() === "") {
      next.capMultiple = "Required";
    } else {
      const n = Number(capMultiple);
      if (!(n >= 1 && n <= 5)) next.capMultiple = "Must be between 1× and 5×";
    }
    if (taperWeeks.trim() === "") {
      next.taperWeeks = "Required";
    } else {
      const n = Number(taperWeeks);
      if (!Number.isInteger(n) || n < 0 || n > 4) next.taperWeeks = "Must be 0–4 weeks";
    }
    if (!DISC.some((d) => enabled[d.key])) {
      next.disciplines = "Select at least one sport";
    }
    for (const d of DISC) {
      if (!enabled[d.key]) continue;
      for (const f of ["event", "start"] as const) {
        const raw = values[d.key][f];
        const key = `${d.key}.${f}`;
        if (raw.trim() === "") next[key] = "Required";
        else if (!(Number(raw) > 0)) next[key] = "Must be greater than 0";
      }
    }
    return next;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const disciplines = Object.fromEntries(
        DISC.filter((d) => enabled[d.key]).map((d) => [
          d.key,
          {
            eventDistanceMeters: Math.round(Number(values[d.key].event) * d.factor),
            startingWeeklyMeters: Math.round(Number(values[d.key].start) * d.factor),
          },
        ]),
      );
      const res = await fetch(isEdit ? `/api/plans/${planId}` : "/api/plans", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          eventDate,
          startDate,
          capMultiple: Number(capMultiple),
          weekStartDay: Number(weekStartDay),
          taperWeeks: Number(taperWeeks),
          priority,
          disciplines,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { plan?: { id: string } };
        const targetId = isEdit ? planId : data.plan?.id;
        if (targetId) {
          router.push(`/plans/${targetId}`);
          router.refresh();
          return;
        }
      }
      if (res.status === 401) {
        const back = isEdit ? `/plans/${planId}/edit` : "/plans/new";
        window.location.href = `/login?callbackUrl=${back}`;
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { message: string }[];
      };
      setFormError(data.issues?.[0]?.message ?? data.error ?? "Something went wrong.");
    } catch {
      setFormError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelClass = "mb-[7px] block text-[13px] font-semibold text-muted";
  const subLabelClass = "mb-1.5 block text-[12px] text-muted";

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-[16px] border border-border bg-card p-6"
    >
      {!isEdit && !stravaConnected && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[13px] border border-border bg-card2 p-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#fc4c02] font-display text-[14px] font-black text-white">
            ≈
          </div>
          <p className="m-0 flex-1 text-[13px] leading-[1.4] text-muted">
            Connect Strava to prefill your starting weekly volume from your last 4 weeks of
            training.
          </p>
          <a
            href="/api/strava/connect"
            className="shrink-0 cursor-pointer rounded-[10px] bg-[#fc4c02] px-3.5 py-2 text-[13px] font-bold text-white hover:brightness-110"
          >
            Connect Strava
          </a>
        </div>
      )}
      {!isEdit &&
        stravaConnected &&
        stravaStatus === "loaded" &&
        Object.keys(autofilled).length > 0 && (
          <p className="m-0 mb-5 text-[13px] text-muted">
            Prefilled your starting weekly volume from your last 4 weeks on Strava — feel free to
            adjust it.
          </p>
        )}
      {!isEdit &&
        stravaConnected &&
        stravaStatus === "loaded" &&
        Object.keys(autofilled).length === 0 && (
          <p className="m-0 mb-5 text-[13px] text-muted">
            No recent Strava activity found in the last 4 weeks — enter your starting volume
            manually.
          </p>
        )}
      <div className="grid gap-4">
        <div>
          <label className={labelClass}>Plan name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ironman Nice 2026"
            className={inputClass}
          />
          {errors.name && <p className="mt-1 mb-0 text-[12px] text-behind">{errors.name}</p>}
        </div>
        <div>
          <label className={labelClass}>Race preset (optional)</label>
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Custom…</option>
            {RACE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-1 mb-0 text-[12px] text-faint">
            Fills the standard swim/bike/run distances for a common race — tweak them below if
            needed.
          </p>
        </div>
        <div className="grid gap-4 app:grid-cols-2">
          <div>
            <label className={labelClass}>Start date</label>
            <input
              type="date"
              value={startDate}
              max={eventDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
            {errors.startDate ? (
              <p className="mt-1 mb-0 text-[12px] text-behind">{errors.startDate}</p>
            ) : (
              <p className="mt-1 mb-0 text-[12px] text-faint">
                Defaults to this week. Set it earlier if you&apos;ve already been training.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>Event date</label>
            <input
              type="date"
              value={eventDate}
              min={minEventDate()}
              onChange={(e) => setEventDate(e.target.value)}
              className={inputClass}
            />
            {errors.eventDate && (
              <p className="mt-1 mb-0 text-[12px] text-behind">{errors.eventDate}</p>
            )}
          </div>
        </div>
        <div className="grid gap-4 app:grid-cols-2">
          <div>
            <label className={labelClass}>Peak week cap (×)</label>
            <input
              type="number"
              min={1}
              max={5}
              step="0.1"
              value={capMultiple}
              onChange={(e) => setCapMultiple(e.target.value)}
              className={`${inputClass} font-mono max-w-[140px]`}
            />
            {errors.capMultiple ? (
              <p className="mt-1 mb-0 text-[12px] text-behind">{errors.capMultiple}</p>
            ) : (
              <p className="mt-1 mb-0 text-[12px] text-faint">
                Weekly volume never exceeds this multiple of each sport&apos;s event distance.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>Week starts on</label>
            <select
              value={weekStartDay}
              onChange={(e) => setWeekStartDay(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <p className="mt-1 mb-0 text-[12px] text-faint">
              Each week rolls over on this day, re-planning ahead from your actual training.
            </p>
          </div>
        </div>
        <div className="grid gap-4 app:grid-cols-2">
          <div>
            <label className={labelClass}>Race-week taper (weeks)</label>
            <input
              type="number"
              min={0}
              max={4}
              step="1"
              value={taperWeeks}
              onChange={(e) => setTaperWeeks(e.target.value)}
              className={`${inputClass} font-mono max-w-[140px]`}
            />
            {errors.taperWeeks ? (
              <p className="mt-1 mb-0 text-[12px] text-behind">{errors.taperWeeks}</p>
            ) : (
              <p className="mt-1 mb-0 text-[12px] text-faint">
                The final weeks ramp down from your peak into race day so you arrive fresh. 0 = no
                taper.
              </p>
            )}
          </div>
          <div>
            <label className={labelClass}>Season priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 mb-0 text-[12px] text-faint">
              How this race ranks in your season — shown on the season timeline.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-[22px] mb-2 flex items-baseline justify-between">
        <span className={labelClass}>Sports</span>
        <span className="text-[12px] text-faint">Uncheck any you&apos;re not training for.</span>
      </div>
      <div className="flex flex-col gap-3.5">
        {DISC.map((d) => {
          const on = enabled[d.key];
          return (
            <div
              key={d.key}
              className="rounded-[13px] border border-border p-4"
              style={{ borderLeft: `3px solid ${on ? d.color : "var(--border)"}` }}
            >
              <label className="flex cursor-pointer items-center gap-2.5 select-none">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setEnabled((p) => ({ ...p, [d.key]: e.target.checked }))}
                  className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                />
                <span
                  className="font-display text-[15px] font-bold tracking-[0.02em]"
                  style={{ color: on ? d.color : "var(--muted)" }}
                >
                  {d.label.toUpperCase()}
                </span>
              </label>
              {on && (
                <div className="mt-3 grid grid-cols-2 gap-3.5">
                  <div>
                    <label className={subLabelClass}>Event distance ({d.unit})</label>
                    <input
                      type="number"
                      min={0}
                      step={d.unit === "km" ? "0.1" : "1"}
                      value={values[d.key].event}
                      placeholder={d.event}
                      onChange={(e) => set(d.key, "event", e.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                    {errors[`${d.key}.event`] && (
                      <p className="mt-1 mb-0 text-[12px] text-behind">
                        {errors[`${d.key}.event`]}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className={subLabelClass}>
                      Starting weekly ({d.unit})
                      {autofilled[d.key] && (
                        <span className="ml-1.5 text-[11px] font-normal text-[#fc4c02]">
                          from Strava
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={d.unit === "km" ? "0.1" : "1"}
                      value={values[d.key].start}
                      placeholder={d.start}
                      onChange={(e) => set(d.key, "start", e.target.value)}
                      className={`${inputClass} font-mono`}
                    />
                    {errors[`${d.key}.start`] && (
                      <p className="mt-1 mb-0 text-[12px] text-behind">
                        {errors[`${d.key}.start`]}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {errors.disciplines && (
        <p className="mt-2 mb-0 text-[12px] text-behind">{errors.disciplines}</p>
      )}

      {preview && (
        <div className="mt-6 rounded-[14px] border border-border bg-card2 p-4">
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className={labelClass}>Preview — total weekly volume</span>
            <span className="font-mono text-[11.5px] text-faint">
              {preview.rows.length} weeks
              {Number(taperWeeks) > 0 ? " · tapers into race day" : ""}
            </span>
          </div>
          <VolumeChart
            rows={preview.rows}
            currentIndex={-1}
            color="var(--brand)"
            unit="km"
            startVol={preview.startVol}
            labelOf={shortDate}
          />
        </div>
      )}

      {formError && <p className="mt-4 mb-0 text-[13.5px] text-behind">{formError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="mt-5 cursor-pointer rounded-[11px] bg-brand px-[22px] py-[13px] font-display text-[15px] font-bold text-white hover:brightness-110 disabled:opacity-70"
      >
        {submitting ? "Saving…" : isEdit ? "Save changes" : "Create plan →"}
      </button>
    </form>
  );
}
