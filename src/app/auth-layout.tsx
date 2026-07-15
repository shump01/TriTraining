import Link from "next/link";
import type { ReactNode } from "react";

import { HeroCurve } from "./hero-curve";
import "./auth.css";

/**
 * Shared cinematic shell for the auth pages (login / signup / forgot / reset).
 * Brand panel with the self-drawing taper curve on the left, a form slot on the
 * right. Matches the marketing landing aesthetic; styles live in auth.css.
 */
export function AuthLayout({
  eyebrow,
  headline,
  sub,
  formTitle,
  formSub,
  children,
  alt,
  brand,
}: {
  eyebrow: string;
  headline: ReactNode;
  sub: string;
  formTitle: string;
  formSub: string;
  children: ReactNode;
  alt: ReactNode;
  /** Optional full-bleed brand-panel replacement (e.g. the login animation).
   *  When set, it fills the left panel instead of the static wordmark + curve. */
  brand?: ReactNode;
}) {
  const wordmark = (
    <>
      <span className="dot3">
        <i />
        <i />
        <i />
      </span>
      TRITRAINER
    </>
  );

  return (
    <div className="authpage">
      <div className="glows" />
      <div className="grain" />

      <div className="auth-split">
        {brand ? (
          <aside className="auth-brand auth-brand-media">{brand}</aside>
        ) : (
          <aside className="auth-brand">
            <Link href="/" className="brand">
              {wordmark}
            </Link>

            <div>
              <span className="auth-eyebrow">
                <span className="pulse" />
                <span className="mono">{eyebrow}</span>
              </span>
              <h1 className="auth-h1">{headline}</h1>
              <p className="auth-sub">{sub}</p>

              <div className="auth-curve">
                <HeroCurve />
                <div className="legend">
                  <span>
                    <i style={{ background: "var(--swim)" }} />
                    Swim
                  </span>
                  <span>
                    <i style={{ background: "var(--bike)" }} />
                    Bike
                  </span>
                  <span>
                    <i style={{ background: "var(--run)" }} />
                    Run
                  </span>
                </div>
              </div>
            </div>

            <div className="mono" style={{ letterSpacing: "0.1em" }}>
              Plan the build · arrive fresh
            </div>
          </aside>
        )}

        <main className="auth-form">
          <div className="auth-card">
            <Link href="/" className="brand auth-mobile-brand">
              {wordmark}
            </Link>
            <h2 className="form-title">{formTitle}</h2>
            <p className="form-sub">{formSub}</p>

            {children}

            {alt}
            <p className="auth-tiny">
              <Link href="/about">What is TriTrainer? →</Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
