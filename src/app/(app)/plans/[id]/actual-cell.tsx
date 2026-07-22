"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ActualCellProps {
  planId: string;
  discipline: string;
  weekStartDate: string; // YYYY-MM-DD
  /** Existing MANUAL value (what the input edits), or null. */
  manualMeters: number | null;
  /** The currently effective actual + its primary source, or null if none yet. */
  effective: { meters: number; source: "MANUAL" | "STRAVA" | "GARMIN" | "APPLE_HEALTH" } | null;
}

export function ActualCell({
  planId,
  discipline,
  weekStartDate,
  manualMeters,
  effective,
}: ActualCellProps) {
  const router = useRouter();
  const [value, setValue] = useState(manualMeters?.toString() ?? "");
  const [state, setState] = useState<"idle" | "saving" | "removing" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (value.trim() === "") return; // nothing to save
    const meters = Number(value);
    if (!Number.isInteger(meters) || meters < 0) {
      setState("error");
      setError("Whole number ≥ 0");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/actuals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discipline, weekStartDate, actualMeters: meters }),
      });
      if (res.ok) {
        setState("saved");
        router.refresh();
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: { message: string }[];
        };
        setState("error");
        setError(body.issues?.[0]?.message ?? body.error ?? "Failed");
      }
    } catch {
      setState("error");
      setError("Failed");
    }
  }

  async function remove() {
    setState("removing");
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/actuals`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discipline, weekStartDate }),
      });
      if (res.ok) {
        setValue("");
        setState("saved");
        router.refresh();
      } else {
        setState("error");
        setError("Failed");
      }
    } catch {
      setState("error");
      setError("Failed");
    }
  }

  // effective.meters is the total (synced + manual); split out the synced part.
  const synced = effective ? Math.max(0, effective.meters - (manualMeters ?? 0)) : 0;
  const busy = state === "saving" || state === "removing";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setState("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="+ meters"
          aria-label={`Manual actual meters to add for ${discipline} week ${weekStartDate}`}
          className="w-[88px] rounded-[8px] border border-border bg-input px-2 py-1 text-right font-mono text-[13px] text-text outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="cursor-pointer rounded-[8px] border border-border bg-card2 px-2 py-1 text-[12px] font-bold hover:border-brand disabled:opacity-60"
        >
          {state === "saving" ? "…" : "Save"}
        </button>
        {manualMeters != null && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label={`Remove manual entry for ${discipline} week ${weekStartDate}`}
            className="cursor-pointer rounded-[8px] border border-border bg-card2 px-2 py-1 text-[12px] font-bold text-muted hover:border-behind hover:text-behind disabled:opacity-60"
          >
            {state === "removing" ? "…" : "Remove"}
          </button>
        )}
      </div>
      <span className="text-[11.5px]">
        {state === "error" ? (
          <span className="text-behind">{error}</span>
        ) : effective ? (
          <span className="text-faint">
            {effective.meters.toLocaleString()} m{" "}
            {manualMeters != null && synced > 0 ? (
              <em className="text-muted">
                ({synced.toLocaleString()} synced + {manualMeters.toLocaleString()} manual)
              </em>
            ) : (
              <em className={effective.source === "MANUAL" ? "text-ahead" : "text-muted"}>
                ({effective.source.replace("_", " ").toLowerCase()})
              </em>
            )}
          </span>
        ) : (
          <span className="text-faint">no data</span>
        )}
      </span>
    </div>
  );
}
