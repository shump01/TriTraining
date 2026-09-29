"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { safeCallbackPath } from "@/lib/safe-redirect";

import { ProviderButtons, type OAuthProviderFlags } from "../provider-buttons";
import { ResendConfirmation } from "../resend-confirmation";

export function LoginForm({
  callbackUrl,
  providers,
  providerError,
}: {
  callbackUrl: string;
  providers: OAuthProviderFlags;
  /** A message from a failed Apple/Google round trip, shown until the next attempt. */
  providerError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(providerError);
  const [loading, setLoading] = useState(false);
  // Set when the credentials were right but the sign-up was never confirmed:
  // the address to offer a fresh confirmation link for.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setUnconfirmed(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        // Never trust the raw callbackUrl — only same-origin relative paths.
        window.location.href = safeCallbackPath(callbackUrl);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      // Branch on the code, not the status: login also answers 403 to a
      // cross-site request, which is not this.
      if (data.code === "EMAIL_UNVERIFIED") setUnconfirmed(email.trim().toLowerCase());
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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
          autoComplete="current-password"
          required
          className="auth-input"
        />
      </div>
      <div className="auth-forgot-row">
        <Link href="/forgot-password" className="auth-forgot">
          Forgot password?
        </Link>
      </div>
      {error && (
        <p role="alert" className={unconfirmed ? "auth-note" : "auth-error"}>
          {error}
        </p>
      )}
      {unconfirmed && (
        <div className="auth-actions">
          <ResendConfirmation email={unconfirmed} />
        </div>
      )}
      <button type="submit" disabled={loading} className="btn auth-submit">
        <span>{loading ? "Signing in…" : "Sign in"}</span>
      </button>
      <ProviderButtons providers={providers} redirectTo={callbackUrl} intent="sign-in" />
    </form>
  );
}
