"use client";

import { useState, type FormEvent } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setSent(true);
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

  if (sent) {
    return (
      <p className="auth-note auth-note-ok" role="status">
        If <b>{email}</b> has an account, we&apos;ve sent a link to reset your password (valid for
        60 minutes). If it has a sign-up that was never confirmed, we&apos;ve sent a fresh
        confirmation link instead. Check your inbox (and spam).
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="auth-field" style={{ marginBottom: 22 }}>
        <label className="auth-label">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="auth-input"
        />
      </div>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn auth-submit">
        <span>{loading ? "Sending…" : "Send reset link"}</span>
      </button>
    </form>
  );
}
