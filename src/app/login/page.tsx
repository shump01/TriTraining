import Link from "next/link";

import { HeroCurve } from "../hero-curve";
import "./login.css";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="authpage">
      <div className="glows" />
      <div className="grain" />

      <div className="auth-split">
        <aside className="auth-brand">
          <Link href="/" className="brand">
            <span className="dot3">
              <i />
              <i />
              <i />
            </span>
            TRITRAINER
          </Link>

          <div>
            <span className="auth-eyebrow">
              <span className="pulse" />
              <span className="mono">Welcome back</span>
            </span>
            <h1 className="auth-h1">
              Back to
              <br />
              the <em>build.</em>
            </h1>
            <p className="auth-sub">
              Your plan has been holding the line. Sign in to pick up right where you left off —
              week by week, sport by sport.
            </p>

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

        <main className="auth-form">
          <div className="auth-card">
            <Link href="/" className="brand auth-mobile-brand">
              <span className="dot3">
                <i />
                <i />
                <i />
              </span>
              TRITRAINER
            </Link>

            <h2 className="form-title">Sign in</h2>
            <p className="form-sub">Pick up your build where you left off.</p>

            <LoginForm callbackUrl={callbackUrl ?? "/dashboard"} />

            <p className="auth-alt">
              New to TriTrainer? <Link href="/signup">Create one</Link>
            </p>
            <p className="auth-tiny">
              <Link href="/about">What is TriTrainer? →</Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
