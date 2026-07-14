"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

const inputClass =
  "w-full rounded-[11px] border border-border bg-input px-[14px] py-[13px] text-[15px] text-text outline-none focus:border-brand";
const labelClass = "mb-[7px] block text-[13px] font-semibold text-muted";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div>
        <p className="mb-5 rounded-[12px] border border-border bg-card p-4 text-[14px] leading-[1.55] text-muted">
          Your password has been updated. For your security, any existing sessions have been signed
          out.
        </p>
        <Link
          href="/login"
          className="block w-full cursor-pointer rounded-[11px] bg-brand py-[14px] text-center font-display text-[16px] font-bold text-white hover:brightness-110"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label className={labelClass}>New password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
        className={`${inputClass} mb-2`}
      />
      <p className="mt-0 mb-[18px] text-[12.5px] text-faint">
        At least 12 characters, including an uppercase letter, a lowercase letter, a number, and a
        symbol.
      </p>
      <label className={labelClass}>Confirm new password</label>
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
        className={`${inputClass} mb-6`}
      />
      {error && (
        <p role="alert" className="mt-0 mb-4 text-[13.5px] text-behind">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full cursor-pointer rounded-[11px] bg-brand py-[14px] font-display text-[16px] font-bold text-white hover:brightness-110 disabled:opacity-70"
      >
        {loading ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
