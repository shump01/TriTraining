"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type CSSProperties } from "react";

function useOrigin(): string {
  // SSR-safe read of window.location.origin without a set-state-in-effect.
  return useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
}

/** Owner-only: shows the shareable invite link with copy + rotate controls. */
export function InvitePanel({ groupId, token }: { groupId: string; token: string }) {
  const router = useRouter();
  const origin = useOrigin();
  const [current, setCurrent] = useState(token);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const path = `/groups/join/${current}`;
  const url = origin ? `${origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/regenerate-invite`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { token?: string };
      if (res.ok && data.token) {
        setCurrent(data.token);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card lit" style={{ "--accent": "var(--bike)" } as CSSProperties}>
      <div className="label">Invite link</div>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="input mono-field min-w-0 flex-1"
        />
        <div className="flex gap-2.5">
          <button type="button" onClick={copy} className="btn small">
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="btn ghost small"
            title="Revoke old links by issuing a new one"
          >
            <span>{busy ? "…" : "Reset"}</span>
          </button>
        </div>
      </div>
      <p className="hint">
        Anyone signed in who opens this link joins the group. Reset it to revoke old links.
      </p>
    </div>
  );
}

/** Owner-only: remove another member from the group. */
export function RemoveMemberButton({
  groupId,
  userId,
  name,
}: {
  groupId: string;
  userId: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Remove ${name} from the group?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/remove-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="btn danger"
      style={{ padding: "6px 13px", fontSize: 11.5 }}
    >
      <span>Remove</span>
    </button>
  );
}

/** Owner deletes the group; a member leaves it. Both return to /groups. */
export function LeaveOrDeleteButton({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    const msg = isOwner
      ? "Delete this group for everyone? This can't be undone."
      : "Leave this group?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const res = await fetch(isOwner ? `/api/groups/${groupId}` : `/api/groups/${groupId}/leave`, {
        method: isOwner ? "DELETE" : "POST",
      });
      if (res.ok) {
        router.push("/groups");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy} className="btn danger small">
      <span>{isOwner ? "Delete group" : "Leave group"}</span>
    </button>
  );
}
