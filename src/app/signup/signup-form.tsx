"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ProviderButtons, type OAuthProviderFlags } from "../provider-buttons";

export function SignupForm({
  providers,
  providerError,
}: {
  providers: OAuthProviderFlags;
  /** A message from a failed Apple/Google round trip, shown until the next attempt. */
  providerError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(providerError);
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
      <div role="status">
        <p className="auth-note auth-note-ok">Your account is ready — you can sign in now.</p>
        <Link href="/login" className="btn auth-submit">
          <span>Sign in →</span>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="auth-field">
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
      <div className="auth-field">
        <label className="auth-label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={12}
          className="auth-input"
        />
      </div>
      <p className="auth-hint">
        At least 12 characters, including an uppercase letter, a lowercase letter, a number, and a
        symbol.
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn auth-submit">
        <span>{loading ? "Creating account…" : "Create account"}</span>
      </button>
      {/* A provider sign-up lands straight on the dashboard: Auth.js creates
          the account and the session in one round trip. */}
      <ProviderButtons providers={providers} redirectTo="/dashboard" intent="sign-up" />
    </form>
  );
}
