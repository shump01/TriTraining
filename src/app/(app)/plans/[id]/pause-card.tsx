"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type PauseReasonKey = "ILLNESS" | "INJURY" | "TRAVEL" | "OTHER";

export interface PauseData {
  reason: PauseReasonKey;
  note: string | null;
}

const REASONS: { key: PauseReasonKey; label: string }[] = [
  { key: "ILLNESS", label: "Ill" },
  { key: "INJURY", label: "Injured" },
  { key: "TRAVEL", label: "Away" },
  { key: "OTHER", label: "Other" },
];

export const REASON_LABEL: Record<PauseReasonKey, string> = {
  ILLNESS: "Illness",
  INJURY: "Injury",
  TRAVEL: "Away",
  OTHER: "Time off",
};

/**
 * "Life happens" — mark the current week as time off. A paused week is left out
 * of the readiness trend and adherence, and the plan comes back on a reduced
 * return-to-training ramp instead of resuming at the pre-pause target.
 */
export function PauseCard({
  planId,
  weekStartDate,
  initial,
}: {
  planId: string;
  weekStartDate: string; // YYYY-MM-DD of the current week
  initial: PauseData | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<PauseReasonKey>(initial?.reason ?? "ILLNESS");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paused = initial != null;

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}/pause`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          method === "POST"
            ? { weekStartDate, reason, note: note.trim() || undefined }
            : { weekStartDate },
        ),
      });
      if (res.ok) {
        // The pause changes readiness + the week's row, so re-render from the server.
        router.refresh();
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
      setBusy(false);
    }
  }

  if (paused) {
    return (
      <div className="mt-6 max-w-[1100px] rounded-[18px] border border-border bg-card p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="m-0 font-display text-[16px] font-bold">
              This week is marked as {REASON_LABEL[initial.reason].toLowerCase()}
            </h3>
            <p className="mt-1 mb-0 max-w-[62ch] text-[13px] text-muted">
              It won&apos;t count against your readiness, and when you come back the plan restarts
              on a lighter ramp rather than the volume you left off at.
            </p>
            {initial.note && <p className="mt-1.5 mb-0 text-[12.5px] text-faint">{initial.note}</p>}
          </div>
          <button
            type="button"
            onClick={() => send("DELETE")}
            disabled={busy}
            className="cursor-pointer rounded-[11px] border border-border px-[16px] py-[10px] text-[13.5px] font-bold text-text hover:border-brand disabled:opacity-70"
          >
            {busy ? "Working…" : "I trained after all"}
          </button>
        </div>
        {error && <p className="mt-2 mb-0 text-[13px] text-behind">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-[1100px] rounded-[18px] border border-border bg-card p-[22px]">
      <h3 className="m-0 font-display text-[16px] font-bold">Can&apos;t train this week?</h3>
      <p className="mt-1 mb-4 max-w-[62ch] text-[13px] text-muted">
        Mark the week off so it isn&apos;t read as a missed target. Your plan will pick back up on a
        reduced ramp — the longer the break, the gentler the return.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => {
          const on = reason === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setReason(r.key)}
              className="h-9 cursor-pointer rounded-[8px] border px-4 text-[13px] font-bold"
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
              {r.label}
            </button>
          );
        })}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note…"
        maxLength={500}
        className="mt-4 w-full rounded-[10px] border border-border bg-input px-3 py-[10px] text-[14px] text-text outline-none focus:border-brand"
      />
      {error && <p className="mt-2 mb-0 text-[13px] text-behind">{error}</p>}
      <button
        type="button"
        onClick={() => send("POST")}
        disabled={busy}
        className="mt-4 cursor-pointer rounded-[11px] border border-border px-[18px] py-[11px] font-display text-[14px] font-bold text-text hover:border-brand disabled:opacity-70"
      >
        {busy ? "Saving…" : "Mark week as time off"}
      </button>
    </div>
  );
}
