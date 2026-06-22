"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeletePlanButton({ planId, planName }: { planId: string; planName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/plans");
        router.refresh();
        return;
      }
      setError("Couldn't delete the plan. Please try again.");
    } catch {
      setError("Couldn't delete the plan. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-behind hover:border-behind"
      >
        Delete plan
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-[13px] text-muted">
        Delete <span className="font-semibold text-text">{planName}</span> and all its data?
      </span>
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className="cursor-pointer rounded-[10px] bg-behind px-[14px] py-[9px] text-[13.5px] font-bold text-white hover:brightness-110 disabled:opacity-70"
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="cursor-pointer rounded-[10px] border border-border px-[14px] py-[9px] text-[13.5px] font-bold text-muted hover:text-text"
      >
        Cancel
      </button>
      {error && <span className="text-[12.5px] text-behind">{error}</span>}
    </div>
  );
}
