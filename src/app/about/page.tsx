import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";

import { HeroCurve } from "../hero-curve";
import "./about.css";

export const metadata: Metadata = {
  title: "About TriTrainer — plan the build, arrive fresh",
  description:
    "TriTrainer builds progressive weekly swim/bike/run targets up to race day, syncs your actuals from Strava, adapts to the training you actually did, and tapers you sharp for the start line.",
};

const ACCENTS = ["var(--swim)", "var(--bike)", "var(--run)"];
const accent = (i: number) => ({ "--accent": ACCENTS[i % ACCENTS.length] }) as CSSProperties;

const FEATURES = [
  {
    title: "Progressive plans",
    body: "Pick a race and your event distances; TriTrainer builds week-by-week targets that ramp safely to race day — with de-load weeks and a peak cap you control.",
  },
  {
    title: "Strava & Apple Health",
    body: "Connect once and your swim, bike, and run distances flow in automatically as weekly actuals. Or enter them by hand — a manual entry adds on top, for sessions a sync didn't catch.",
  },
  {
    title: "Adaptive targets",
    body: "Each week the plan rolls forward from what you actually did — a strong week nudges the rest up, a light one eases it back toward your plan's baseline, and a fatigued or ill one eases it further. Always within safe limits.",
  },
  {
    title: "Race-week taper",
    body: "The build peaks a couple of weeks out, then ramps down to half by race week — so you arrive fresh. A readiness projection tells you if you're on track.",
  },
];

const STEPS = [
  {
    title: "Create your account",
    body: "Sign up with an email and password — no app to install, it runs in your browser.",
  },
  {
    title: "Build a plan",
    body: "Choose your race, the sports you're training, each event distance, and your current weekly volume. Watch the curve build live, then save.",
  },
  {
    title: "Log your training",
    body: "Connect Strava or Apple Health to fill your weekly distances automatically, or type them in on the plan page. Everything is bucketed into training weeks for you.",
  },
  {
    title: "Track & adapt",
    body: "See target vs actual per sport and overall, week by week, with clear ahead / on-track / behind status. The plan re-plans each week from your real training and your check-ins.",
  },
  {
    title: "Share & train together",
    body: "Share a read-only plan link with a coach, or start a group and keep an eye on each other's current-week progress.",
  },
];

export default function AboutPage() {
  const wordmark = (
    <span className="dot3">
      <i />
      <i />
      <i />
    </span>
  );

  return (
    <div className="aboutpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap">
        <div className="topbar">
          <Link href="/" className="brand">
            {wordmark}TRITRAINER
          </Link>
          <div className="right">
            <Link href="/login" className="signlink">
              Sign in
            </Link>
            <Link href="/signup" className="btn">
              <span>Start free</span>
            </Link>
          </div>
        </div>

        <section className="hero">
          <div>
            <span className="eyebrow">
              <span className="pulse" />
              <span className="mono">What is TriTrainer?</span>
            </span>
            <h1>
              Plan the build.
              <br />
              Arrive <em>fresh.</em>
            </h1>
            <p className="lede">
              TriTrainer is a triathlon training planner. Tell it your race and where you are today,
              and it maps <b>progressive weekly swim, bike and run targets</b> all the way to race
              day — then syncs your training, adapts every week, and tapers you sharp for the start
              line.
            </p>
            <div className="hero-cta">
              <Link href="/signup" className="btn">
                <span>Create your plan</span> <span>→</span>
              </Link>
              <Link href="/login" className="btn ghost">
                <span>I already have an account</span>
              </Link>
            </div>
          </div>

          <div className="curve-card">
            <div className="curve-head">
              <span className="mono">Weekly volume · one plan</span>
              <span className="mono" style={{ color: "var(--ink-faint)" }}>
                16 weeks → race day
              </span>
            </div>
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
        </section>

        <section className="section">
          <div className="section-label">What you get</div>
          <h2 className="section-title">Everything to build a race</h2>
          <div className="feat-grid">
            {FEATURES.map((f, i) => (
              <div key={f.title} className="card" style={accent(i)}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-label">How to use it</div>
          <h2 className="section-title">Five steps to the start line</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step">
                <div className="step-n" style={accent(i)}>
                  {i + 1}
                </div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="finale">
        <div className="wrap">
          <h2>
            Ready to build
            <br />
            your <em>race?</em>
          </h2>
          <p>It takes about two minutes to set up your first plan.</p>
          <Link href="/signup" className="btn">
            <span>Get started free</span> <span>→</span>
          </Link>
        </div>
      </div>

      <div className="wrap">
        <footer className="foot">
          <Link href="/" className="brand" style={{ fontSize: 18 }}>
            {wordmark}TRITRAINER
          </Link>
          <div className="mono" style={{ letterSpacing: "0.1em" }}>
            Built for triathletes · arrive fresh
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
