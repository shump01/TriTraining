"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

import { safeCallbackPath } from "@/lib/safe-redirect";

export type OAuthProviderFlags = { apple: boolean; google: boolean };

/**
 * "Continue with Apple / Google" under the password form. Rendered only for
 * providers the server has credentials for (the page passes the flags), so a
 * half-configured deployment never shows a button that can only fail.
 *
 * Uses next-auth/react's signIn rather than a form action on purpose: the
 * page's Content-Security-Policy says `form-action 'self'`, and Chrome
 * applies that to the redirect a form submission is bounced through — the
 * hop to accounts.google.com or appleid.apple.com would be refused. signIn
 * posts by fetch and then navigates by script, which the policy allows.
 */
export function ProviderButtons({
  providers,
  redirectTo,
  intent,
}: {
  providers: OAuthProviderFlags;
  /** Same-origin path to land on afterwards; anything else falls back to the dashboard. */
  redirectTo: string;
  intent: "sign-in" | "sign-up";
}) {
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // signIn resolves the instant it hands the browser to the provider, and
  // `busy` deliberately stays set so a double tap can't start two flows. But
  // the Back button can restore this page from the back/forward cache with
  // that state intact — both buttons disabled, "Opening Google…" forever.
  // A restored page fires pageshow with `persisted`; reset there.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setBusy(null);
        setError(null);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  if (!providers.apple && !providers.google) return null;

  const verb = intent === "sign-up" ? "Sign up" : "Continue";
  const start = async (provider: "apple" | "google") => {
    setError(null);
    setBusy(provider);
    try {
      await signIn(provider, { redirectTo: safeCallbackPath(redirectTo) });
      // signIn navigates away; if we are still here the redirect didn't happen.
    } catch {
      setError("Couldn't start that sign-in. Please try again.");
      setBusy(null);
    }
  };

  return (
    <div className="auth-providers">
      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>
      {providers.apple && (
        <button
          type="button"
          className="auth-provider"
          onClick={() => void start("apple")}
          disabled={busy !== null}
        >
          <AppleMark />
          <span>{busy === "apple" ? "Opening Apple…" : `${verb} with Apple`}</span>
        </button>
      )}
      {providers.google && (
        <button
          type="button"
          className="auth-provider"
          onClick={() => void start("google")}
          disabled={busy !== null}
        >
          <GoogleMark />
          <span>{busy === "google" ? "Opening Google…" : `${verb} with Google`}</span>
        </button>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </div>
  );
}

function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.73c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.74 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.19-.02 1.94-1.08 2.66-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.3-3.55zM14.18 6.25c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.56-1.23z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3.01h3.88c2.27-2.09 3.54-5.17 3.54-8.88z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.37-2.29V6.6H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.4l4-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4 3.11C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
