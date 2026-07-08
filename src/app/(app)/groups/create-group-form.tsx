"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const inputClass =
  "w-full rounded-[10px] border border-border bg-input px-3 py-[10px] text-[14px] text-text outline-none focus:border-brand";

/** Inline "create a group" form. Posts to /api/groups and routes to the new group. */
export function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        group?: { id: string };
        error?: string;
        issues?: { message: string }[];
      };
      if (res.ok && data.group) {
        router.push(`/groups/${data.group.id}`);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        window.location.href = "/login?callbackUrl=/groups";
        return;
      }
      setError(data.issues?.[0]?.message ?? data.error ?? "Could not create the group.");
    } catch {
      setError("Could not create the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[16px] border border-border bg-card p-4 sm:flex sm:items-end sm:gap-3"
    >
      <div className="flex-1">
        <label className="mb-1.5 block text-[12.5px] font-semibold text-muted">
          Create a group
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Tuesday Club"
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="mt-3 w-full cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-60 sm:mt-0 sm:w-auto"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      {error && <p className="mt-2 mb-0 text-[12.5px] text-behind sm:w-full">{error}</p>}
    </form>
  );
}
