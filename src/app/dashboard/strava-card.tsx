"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

export function StravaCard({
  connection,
}: {
  connection: { athleteId: string; scope: string; lastSyncedAt: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"disconnect" | "sync" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function disconnect() {
    setBusy("disconnect");
    try {
      await fetch("/api/strava/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    setSyncMessage(null);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        activities?: number;
        weeksWritten?: number;
        rateLimited?: boolean;
        error?: string;
      };
      if (res.ok) {
        setSyncMessage(
          `Synced ${data.activities ?? 0} activities → ${data.weeksWritten ?? 0} weekly totals` +
            (data.rateLimited ? " (partial — rate limited)" : ""),
        );
        router.refresh();
      } else {
        setSyncMessage(data.error ?? "Sync failed.");
      }
    } catch {
      setSyncMessage("Sync failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={cardStyle}>
      <strong>Strava</strong>
      {connection ? (
        <>
          <p style={{ margin: 0 }}>
            Connected (athlete <code>{connection.athleteId}</code>)
            <br />
            <span style={{ color: "#666", fontSize: "0.85rem" }}>scope: {connection.scope}</span>
            <br />
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              last sync:{" "}
              {connection.lastSyncedAt
                ? new Date(connection.lastSyncedAt).toLocaleString()
                : "never"}
            </span>
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={sync} disabled={busy !== null} style={primaryButton}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" onClick={disconnect} disabled={busy !== null} style={buttonStyle}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          {syncMessage && (
            <p role="status" style={{ margin: 0, fontSize: "0.85rem", color: "#333" }}>
              {syncMessage}
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: "#666" }}>Not connected.</p>
          {/* Plain link: the GET route redirects to Strava's authorize screen. */}
          <a href="/api/strava/connect" style={connectStyle}>
            Connect Strava
          </a>
        </>
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: "1rem",
  maxWidth: 380,
};
const buttonStyle: CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.95rem",
  cursor: "pointer",
};
const primaryButton: CSSProperties = {
  ...buttonStyle,
  background: "#fc4c02",
  color: "#fff",
  border: "none",
  borderRadius: 4,
};
const connectStyle: CSSProperties = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  fontSize: "0.95rem",
  background: "#fc4c02",
  color: "#fff",
  borderRadius: 4,
  textDecoration: "none",
  alignSelf: "flex-start",
};
