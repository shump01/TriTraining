"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Confirms an invite: joins the group by token, then opens the group. */
export function JoinButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        group?: { id: string };
        error?: string;
      };
      if (res.ok && data.group) {
        router.push(`/groups/${data.group.id}`);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=/groups/join/${token}`;
        return;
      }
      setError(data.error ?? "Could not join the group.");
    } catch {
      setError("Could not join the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={join}
        disabled={busy}
        className="btn"
        style={{ fontSize: 16, padding: "15px 30px" }}
      >
        <span>{busy ? "Joining…" : "Join group"}</span>
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
