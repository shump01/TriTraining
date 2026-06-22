"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StravaCard({ connection }: { connection: { lastSyncedAt: string | null } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setBusy("sync");
    setMessage(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        activities?: number;
        weeksWritten?: number;
        rateLimited?: boolean;
        error?: string;
      };
      if (res.ok) {
        setMessage(
          `Synced ${data.activities ?? 0} activities → ${data.weeksWritten ?? 0} weekly totals` +
            (data.rateLimited ? " (partial — rate limited)" : ""),
        );
        router.refresh();
      } else {
        setMessage(data.error ?? "Sync failed.");
      }
    } catch {
      setMessage("Sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await fetch("/api/strava/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[18px] border border-border bg-card p-[22px]">
      <div className="mb-3.5 flex items-center gap-[9px]">
        <div className="grid h-[30px] w-[30px] place-items-center rounded-[8px] bg-[#fc4c02] font-display text-[15px] font-black text-white">
          ≈
        </div>
        <span className="font-display text-[16px] font-bold">Strava</span>
        {connection && (
          <span
            className="ml-auto rounded-[20px] px-[9px] py-1 text-[11px] font-bold text-ahead"
            style={{ background: "color-mix(in srgb, var(--ahead) 14%, transparent)" }}
          >
            Connected
          </span>
        )}
      </div>

      {connection ? (
        <>
          <p className="m-0 mb-4 text-[13.5px] leading-[1.5] text-muted">
            Last synced{" "}
            {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "never"}
            .
          </p>
          <button
            type="button"
            onClick={sync}
            disabled={busy !== null}
            className="w-full cursor-pointer rounded-[10px] border border-border bg-card2 py-[11px] text-[14px] font-bold text-text hover:border-brand disabled:opacity-70"
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          {message && <p className="m-0 mt-2 text-[12.5px] text-muted">{message}</p>}
          <button
            type="button"
            onClick={disconnect}
            disabled={busy !== null}
            className="mt-2 cursor-pointer text-[12px] text-faint hover:text-text"
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        </>
      ) : (
        <>
          <p className="m-0 mb-4 text-[13.5px] leading-[1.5] text-muted">
            Connect Strava to sync your activities into weekly totals.
          </p>
          <a
            href="/api/strava/connect"
            className="inline-block w-full rounded-[10px] bg-[#fc4c02] py-[11px] text-center text-[14px] font-bold text-white hover:brightness-110"
          >
            Connect Strava
          </a>
        </>
      )}
    </div>
  );
}
