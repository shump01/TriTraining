"use client";

import { useState } from "react";

export interface CheckinData {
  fatigue: number;
  sleep: number;
  soreness: number;
  note: string | null;
}

function Rating({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-text">{label}</span>
        <span className="text-[11px] text-faint">{hint}</span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className="h-9 flex-1 cursor-pointer rounded-[8px] border text-[13px] font-bold"
              style={
                on
                  ? {
                      borderColor: "var(--brand)",
                      background: "color-mix(in srgb, var(--brand) 16%, transparent)",
                      color: "var(--text)",
                    }
                  : { borderColor: "var(--border)", color: "var(--muted)" }
              }
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * This-week wellness check-in. Saving upserts the check-in; a fatigued/sore week
 * eases the plan's next re-ramp (see checkinReadinessFactor).
 */
export function CheckinCard({
  planId,
  weekStartDate,
  initial,
}: {
  planId: string;
  weekStartDate: string; // YYYY-MM-DD of the current week
  initial: CheckinData | null;
}) {
  const [fatigue, setFatigue] = useState(initial?.fatigue ?? 3);
  const [sleep, setSleep] = useState(initial?.sleep ?? 3);
  const [soreness, setSoreness] = useState(initial?.soreness ?? 3);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setSaved(false);
    };
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/plans/${planId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStartDate,
          fatigue,
          sleep,
          soreness,
          note: note.trim() || undefined,
        }),
      });
      if (res.ok) {
        setSaved(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { message: string }[];
      };
      setError(data.issues?.[0]?.message ?? data.error ?? "Something went wrong.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 max-w-[1100px] rounded-[18px] border border-border bg-card p-[22px]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="m-0 font-display text-[16px] font-bold">This week&apos;s check-in</h3>
        {saved && (
          <span className="text-[12px] font-bold" style={{ color: "var(--on-track)" }}>
            Saved ✓
          </span>
        )}
      </div>
      <p className="mt-0 mb-4 text-[13px] text-muted">
        How&apos;s your body this week? A rough week automatically eases next week&apos;s targets.
      </p>
      <div className="grid gap-4 app:grid-cols-3">
        <Rating
          label="Fatigue"
          hint="1 fresh · 5 spent"
          value={fatigue}
          onChange={touch(setFatigue)}
        />
        <Rating label="Sleep" hint="1 poor · 5 great" value={sleep} onChange={touch(setSleep)} />
        <Rating
          label="Soreness"
          hint="1 none · 5 very"
          value={soreness}
          onChange={touch(setSoreness)}
        />
      </div>
      <input
        value={note}
        onChange={(e) => touch(setNote)(e.target.value)}
        placeholder="Optional note…"
        maxLength={500}
        className="mt-4 w-full rounded-[10px] border border-border bg-input px-3 py-[10px] text-[14px] text-text outline-none focus:border-brand"
      />
      {error && <p className="mt-2 mb-0 text-[13px] text-behind">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-70"
      >
        {saving ? "Saving…" : "Save check-in"}
      </button>
    </div>
  );
}
