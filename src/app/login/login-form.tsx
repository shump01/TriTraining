"use client";

import { useState, type FormEvent } from "react";

const inputClass =
  "w-full rounded-[11px] border border-border bg-input px-[14px] py-[13px] text-[15px] text-text outline-none focus:border-brand";
const labelClass = "mb-[7px] block text-[13px] font-semibold text-muted";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        window.location.href = callbackUrl || "/dashboard";
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

  return (
    <form onSubmit={onSubmit}>
      <label className={labelClass}>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
        className={`${inputClass} mb-[18px]`}
      />
      <label className={labelClass}>Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
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
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
