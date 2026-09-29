"use client";

import { useState } from "react";

/**
 * "Resend confirmation email" — shared by the sign-up form's check-your-inbox
 * state and the login form's "confirm your email first" state.
 *
 * The server answers identically whether or not a sign-up is pending (it
 * must: anything else would say who is mid-sign-up), so the confirmation copy
 * here is conditional too. Earlier links keep working after a resend, so there
 * is no need to warn that the previous email is now dead.
 */
export function ResendConfirmation({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Couldn't send the email. Please try again.");
    } catch {
      setError("Couldn't send the email. Please try again.");
    }
    setState("idle");
  }

  if (state === "sent") {
    return (
      <p className="auth-hint" role="status" style={{ margin: "0 0 18px" }}>
        Sent — if a sign-up is waiting for {email}, a new link is on its way. Your earlier links
        still work.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="auth-forgot"
        onClick={resend}
        disabled={state === "sending" || !email}
      >
        {state === "sending" ? "Sending…" : "Resend confirmation email"}
      </button>
      {error && (
        <p role="alert" className="auth-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </div>
  );
}
