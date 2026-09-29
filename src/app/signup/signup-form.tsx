"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ProviderButtons, type OAuthProviderFlags } from "../provider-buttons";
import { ResendConfirmation } from "../resend-confirmation";

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
  // The address the confirmation went to — set once the server has accepted
  // the sign-up. Kept apart from `email` so editing the field can't change
  // which address the check-your-inbox panel names.
  const [sentTo, setSentTo] = useState<string | null>(null);
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
        // No account exists yet — it will once the emailed link is confirmed.
        setSentTo(email.trim().toLowerCase());
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

  if (sentTo) {
    return (
      <div role="status">
        <p className="auth-note auth-note-ok">
          Check your inbox. We&apos;ve sent a link to <b>{sentTo}</b> — open it and enter the
          password you just chose to finish creating your account. The link works for 24 hours.
        </p>
        <p className="auth-hint" style={{ margin: "0 0 14px" }}>
          Nothing there after a few minutes? Check your spam folder. Not confirmed within 24 hours,
          the sign-up is discarded — just sign up again.
        </p>
        <div className="auth-actions">
          <ResendConfirmation email={sentTo} />
          <button
            type="button"
            className="auth-forgot"
            onClick={() => {
              setSentTo(null);
              setPassword("");
            }}
          >
            Use a different address
          </button>
        </div>
        <Link href="/login" className="btn auth-submit">
          <span>Back to sign in →</span>
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
