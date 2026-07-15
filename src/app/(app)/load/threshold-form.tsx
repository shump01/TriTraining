"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Set / update the athlete's threshold HR; refreshes the page to recompute load. */
export function ThresholdForm({ initial, cta = "Save" }: { initial: number | null; cta?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ? String(initial) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/load/threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdHr: Number(value) }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong.");
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-muted">
          Threshold heart rate (bpm)
        </label>
        <input
          type="number"
          min={100}
          max={220}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 165"
          required
          className="w-[150px] rounded-[10px] border border-border bg-input px-3 py-[10px] font-mono text-[15px] text-text outline-none focus:border-brand"
        />
      </div>
      <button
        type="submit"
        disabled={saving}
        className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-70"
      >
        {saving ? "Saving…" : cta}
      </button>
      {error && <span className="pb-2 text-[13px] text-behind">{error}</span>}
    </form>
  );
}
