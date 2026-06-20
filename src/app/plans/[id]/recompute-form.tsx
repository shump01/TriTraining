"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";

export interface RecomputeDiscipline {
  discipline: string;
  startingWeeklyMeters: number;
}

export function RecomputeForm({
  planId,
  eventDate,
  disciplines,
}: {
  planId: string;
  eventDate: string; // YYYY-MM-DD
  disciplines: RecomputeDiscipline[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(eventDate);
  const [starts, setStarts] = useState<Record<string, string>>(
    Object.fromEntries(disciplines.map((d) => [d.discipline, String(d.startingWeeklyMeters)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/plans/${planId}/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventDate: date,
          disciplines: Object.fromEntries(
            disciplines.map((d) => [
              d.discipline,
              { startingWeeklyMeters: Number(starts[d.discipline] ?? "") },
            ]),
          ),
        }),
      });

      if (res.ok) {
        // Re-fetch the server component so the table + chart reflect new targets.
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { message: string }[];
      };
      setError(body.issues?.[0]?.message ?? body.error ?? "Something went wrong.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      <strong>Recompute targets</strong>
      <label style={rowStyle}>
        <span>Event date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
      </label>
      {disciplines.map((d) => (
        <label key={d.discipline} style={rowStyle}>
          <span>{d.discipline} starting weekly (m)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={starts[d.discipline] ?? ""}
            onChange={(e) => setStarts((prev) => ({ ...prev, [d.discipline]: e.target.value }))}
            style={input}
          />
        </label>
      ))}
      {error && (
        <span role="alert" style={{ color: "#b00020" }}>
          {error}
        </span>
      )}
      <button type="submit" disabled={busy} style={button}>
        {busy ? "Recomputing…" : "Recompute"}
      </button>
    </form>
  );
}

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: "1rem",
  maxWidth: 360,
};
const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  fontSize: "0.9rem",
};
const input: CSSProperties = { padding: "0.4rem", fontSize: "0.95rem" };
const button: CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.95rem",
  cursor: "pointer",
  alignSelf: "flex-start",
};
