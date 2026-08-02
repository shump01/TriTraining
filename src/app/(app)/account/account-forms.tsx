"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

/**
 * The account page's client islands: screen name, password change, sign out,
 * and deletion. Fetch + error conventions follow the rest of the app (JSON
 * routes returning { error, issues }); errors render with role="alert" and the
 * inputs carry aria-invalid/aria-describedby, matching the plan form's a11y.
 */

const inputClass =
  "w-full rounded-[10px] border border-border bg-input px-3 py-[10px] text-[14px] text-text outline-none focus:border-brand";
const labelClass = "mb-1.5 block text-[12.5px] font-semibold text-muted";
const primaryBtn =
  "cursor-pointer rounded-[11px] bg-brand px-[18px] py-[10px] font-display text-[14px] font-bold text-white hover:brightness-110 disabled:opacity-60";

type ApiIssueResponse = { error?: string; issues?: { message: string }[] };

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as ApiIssueResponse;
  return data.issues?.[0]?.message ?? data.error ?? "Something went wrong.";
}

/** Update (or clear) the screen name shown on the dashboard and in groups. */
export function ScreenNameForm({ initial }: { initial: string | null }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setSaved(true);
        // The greeting, rail avatar and group lists all read the name.
        router.refresh();
        return;
      }
      setError(await readError(res));
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label className={labelClass} htmlFor={id}>
        Screen name
      </label>
      <div className="flex flex-wrap gap-2.5">
        <input
          id={id}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          maxLength={40}
          placeholder="How you appear to your groups"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className={`${inputClass} max-w-[320px] flex-1`}
        />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-faint">
        Shown on your dashboard and to your training groups. Leave empty to fall back to your email
        name.
      </p>
      {saved && (
        <p className="mt-2 mb-0 text-[12.5px] font-bold" style={{ color: "var(--on-track)" }}>
          Saved ✓
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-2 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
    </form>
  );
}

/** Change password: current + new + confirm; other sessions are revoked. */
export function ChangePasswordForm() {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.ok) {
        setDone(true);
        setCurrent("");
        setNext("");
        setConfirm("");
        return;
      }
      setError(await readError(res));
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="grid gap-4">
        <div>
          <label className={labelClass} htmlFor={`${id}-cur`}>
            Current password
          </label>
          <input
            id={`${id}-cur`}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`${id}-new`}>
              New password
            </label>
            <input
              id={`${id}-new`}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-err` : `${id}-hint`}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`${id}-confirm`}>
              Confirm new password
            </label>
            <input
              id={`${id}-confirm`}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </div>
      <p id={`${id}-hint`} className="mt-2 mb-0 text-[12px] leading-[1.5] text-faint">
        At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.
        Changing it signs out your other devices.
      </p>
      {done && (
        <p className="mt-2.5 mb-0 text-[12.5px] font-bold" style={{ color: "var(--on-track)" }}>
          Password updated — other devices have been signed out.
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-2.5 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next || !confirm}
        className={`${primaryBtn} mt-4`}
      >
        {busy ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

/** Weekly digest on/off. Saves on toggle — no separate save button needed. */
export function DigestToggle({ initial }: { initial: boolean }) {
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setEnabled(next); // optimistic — reverted on failure
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digestEnabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        setError(await readError(res));
      }
    } catch {
      setEnabled(!next);
      setError("Something went wrong.");
    }
  }

  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-[3px] h-4 w-4 accent-[var(--brand)]"
        />
        <span>
          <span className="block text-[14px] font-bold text-text">Weekly digest</span>
          <span className="mt-0.5 block max-w-[52ch] text-[12.5px] leading-[1.5] text-muted">
            One email at the start of each training week: last week&apos;s result, this week&apos;s
            targets, your Form, and the race countdown. Every digest has an unsubscribe link too.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Plan-view density. SIMPLE trims every plan's week table to the current week
 * — for athletes who don't want the full past/future list on screen each
 * time. A display filter only: nothing is hidden that can't be brought back
 * by flipping the toggle, and Detailed remains the default.
 */
export function ViewModeToggle({ initial }: { initial: "SIMPLE" | "DETAILED" }) {
  const id = useId();
  const [simple, setSimple] = useState(initial === "SIMPLE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    if (busy) return; // rapid re-toggles would race PATCHes out of order
    setBusy(true);
    setSimple(next); // optimistic — reverted on failure
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewMode: next ? "SIMPLE" : "DETAILED" }),
      });
      if (!res.ok) {
        setSimple(!next);
        setError(await readError(res));
      }
    } catch {
      setSimple(!next);
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={simple}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-[3px] h-4 w-4 accent-[var(--brand)]"
        />
        <span>
          <span className="block text-[14px] font-bold text-text">Simple plan view</span>
          <span className="mt-0.5 block max-w-[52ch] text-[12.5px] leading-[1.5] text-muted">
            Show only the current week&apos;s targets on plan pages, instead of the full
            week-by-week list. The charts and everything else stay; flip this off any time to see
            the whole season again. Applies on the web and in the app.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="cursor-pointer rounded-[11px] border border-border px-[16px] py-[9px] text-[13.5px] font-bold text-text hover:border-brand disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

/** Typed-confirmation deletion. The server cascades everything; this is final. */
export function DeleteAccountCard({ email }: { email: string }) {
  const id = useId();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = confirm.trim().toLowerCase() === email.toLowerCase();

  async function onDelete() {
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (res.ok) {
        // The user row (and every session) is gone; land on the public site.
        window.location.href = "/";
        return;
      }
      setError(await readError(res));
      setBusy(false);
    } catch {
      setError("Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[18px] border bg-card p-6"
      style={{ borderColor: "color-mix(in srgb, var(--behind) 35%, var(--border))" }}
    >
      <p className="m-0 mb-1 text-[14px] font-bold text-text">Delete account</p>
      <p className="mt-0 mb-4 max-w-[56ch] text-[13px] leading-[1.55] text-muted">
        Permanently deletes your account and everything in it: plans, targets and actuals,
        check-ins, training load, group memberships — and any groups you own, for every member.
        There is no undo.
      </p>
      <label className={labelClass} htmlFor={id}>
        Type <b className="font-mono text-text">{email}</b> to confirm
      </label>
      <div className="flex flex-wrap gap-2.5">
        <input
          id={id}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          className={`${inputClass} max-w-[320px] flex-1`}
        />
        <button
          type="button"
          onClick={onDelete}
          disabled={!armed || busy}
          className="cursor-pointer rounded-[11px] px-[18px] py-[10px] font-display text-[14px] font-bold text-white disabled:opacity-40"
          style={{ background: "var(--behind)" }}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2.5 mb-0 text-[12.5px] text-behind">
          {error}
        </p>
      )}
    </div>
  );
}
