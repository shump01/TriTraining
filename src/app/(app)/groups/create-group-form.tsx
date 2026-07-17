"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";

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
      className="card lit"
      style={{ "--accent": "var(--swim)" } as CSSProperties}
    >
      <div className="sm:flex sm:items-end sm:gap-3.5">
        <div className="flex-1">
          <label className="label" htmlFor="group-name">
            Start a group
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Tuesday Club"
            className="input"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="btn mt-3 w-full sm:mt-0 sm:w-auto"
        >
          <span>{busy ? "Creating…" : "Create"}</span>
        </button>
      </div>
      {error && <p className="err">{error}</p>}
    </form>
  );
}
