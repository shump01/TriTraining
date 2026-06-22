"use client";

import { useState, type FormEvent } from "react";

const inputClass =
  "w-full rounded-[11px] border border-border bg-input px-[14px] py-[13px] text-[15px] text-text outline-none focus:border-brand";
const labelClass = "mb-[7px] block text-[13px] font-semibold text-muted";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        setSuccess(true);
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

  if (success) {
    return (
      <p role="status" className="text-[15px] text-ahead">
        Account created.{" "}
        <a href="/login" className="font-bold text-brand">
          Sign in →
        </a>
      </p>
    );
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
        autoComplete="new-password"
        required
        minLength={12}
        className={`${inputClass} mb-2`}
      />
      <p className="mt-0 mb-5 text-[12px] text-faint">
        At least 12 characters, including an uppercase letter, a lowercase letter, a number, and a
        symbol.
      </p>
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
        {loading ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
