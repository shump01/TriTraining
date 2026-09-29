"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

type Outcome =
  | { kind: "created" }
  | { kind: "already_registered"; message: string }
  /** The link itself is dead: no retry on this page can help. */
  | { kind: "dead_link"; message: string };

export function VerifyEmailForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Double-submit guard: a second confirm after a first one succeeded would
    // report the (now used) link as dead, contradicting the success.
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        error?: string;
        code?: string;
      };
      if (res.ok && data.status === "created") {
        setOutcome({ kind: "created" });
        return;
      }
      if (res.ok && data.status === "already_registered") {
        setOutcome({ kind: "already_registered", message: data.message ?? "" });
        return;
      }
      if (data.code === "INVALID_LINK") {
        setOutcome({ kind: "dead_link", message: data.error ?? "" });
        return;
      }
      // Wrong password, rate limit, anything else: stay on the form.
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (outcome?.kind === "created") {
    return (
      <div role="status">
        <p className="auth-note auth-note-ok">
          Your email is confirmed and your account is ready — you&apos;re signed in.
        </p>
        <p className="auth-hint" style={{ margin: "0 0 18px" }}>
          Signed up in the TriTrainer app? Go back to it and sign in with the same email and
          password.
        </p>
        <Link href="/dashboard" className="btn auth-submit">
          <span>Continue to your dashboard →</span>
        </Link>
      </div>
    );
  }

  if (outcome?.kind === "already_registered") {
    return (
      <div role="status">
        <p className="auth-note">{outcome.message}</p>
        <Link href="/login" className="btn auth-submit">
          <span>Sign in →</span>
        </Link>
      </div>
    );
  }

  if (outcome?.kind === "dead_link") {
    return (
      <div role="alert">
        <p className="auth-note">{outcome.message}</p>
        <div className="auth-actions">
          <Link href="/signup" className="auth-forgot">
            Sign up again
          </Link>
        </div>
        <Link href="/login" className="btn auth-submit">
          <span>Sign in →</span>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="auth-field">
        <label className="auth-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="auth-input"
        />
      </div>
      <p className="auth-hint">
        Forgotten it already? Sign up again with a new one — then any of the confirmation emails
        will accept it.
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn auth-submit">
        <span>{loading ? "Confirming…" : "Confirm my email"}</span>
      </button>
    </form>
  );
}
