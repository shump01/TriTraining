"use client";

import { useState } from "react";

/**
 * Owner control to mint / revoke a plan's public read-only share link. Shows the
 * link with copy + stop-sharing once enabled.
 */
export function SharePlanButton({
  planId,
  initialToken,
}: {
  planId: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url =
    token && typeof window !== "undefined" ? `${window.location.origin}/shared/${token}` : "";

  async function toggle(enabled: boolean) {
    setBusy(true);
    setCopied(false);
    try {
      const res = await fetch(`/api/plans/${planId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { token?: string | null };
        setToken(data.token ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked — the input is selectable as a fallback.
    }
  }

  if (!token) {
    return (
      <button
        type="button"
        onClick={() => toggle(true)}
        disabled={busy}
        className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-text hover:border-brand disabled:opacity-70"
      >
        {busy ? "Creating…" : "Share plan"}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-[240px] rounded-[10px] border border-border bg-input px-3 py-[9px] font-mono text-[12.5px] text-muted outline-none"
      />
      <button
        type="button"
        onClick={copy}
        className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-text hover:border-brand"
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <button
        type="button"
        onClick={() => toggle(false)}
        disabled={busy}
        className="cursor-pointer rounded-[10px] px-[14px] py-[9px] text-[13.5px] font-bold text-behind hover:underline disabled:opacity-70"
      >
        Stop sharing
      </button>
    </div>
  );
}
