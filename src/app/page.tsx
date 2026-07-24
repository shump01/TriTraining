import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

import { auth } from "@/auth";

import { HeroCurve } from "./hero-curve";
import "./landing.css";
import { LandingEffects } from "./landing-effects";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TriTrainer — Plan the build. Arrive fresh.",
  description:
    "Progressive triathlon training that syncs from Strava, adapts to the training you actually did, and tapers you sharp for race day.",
};

const accent = (c: string) => ({ "--accent": c }) as CSSProperties;

const MARQUEE = [
  "12% max weekly build",
  "4-week de-load blocks",
  "50% race-week taper",
  "swim · bike · run",
  "strava + apple health",
  "adapts every week",
];

export default async function Home() {
  // Signed-in visitors go straight to their dashboard; everyone else gets the
  // marketing home.
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="landing">
      <div className="glows" />
      <div className="grain" />

      <nav id="lp-nav" className="lp-nav">
        <div className="nav-in">
          <div className="brand">
            <span className="dot3">
              <i />
              <i />
              <i />
            </span>
            TRITRAINER
          </div>
          <div className="nav-links">
            <a href="#build">The build</a>
            <a href="#adapt">Adapt</a>
            <a href="#taper">The taper</a>
          </div>
          <div className="nav-cta">
            <Link
              href="/login"
              style={{
                color: "var(--ink-dim)",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Sign in
            </Link>
            <Link href="/signup" className="btn">
              <span>Start free</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="wrap">
        <header>
          <div className="eyebrow">
            <span className="pulse" />
            <span className="mono">Triathlon training, periodized</span>
          </div>

          <h1>
            <span className="row">
              <span>Plan the build.</span>
            </span>
            <span className="row">
              <span className="stroke">Taper sharp.</span>
            </span>
            <span className="row">
              <span>
                Arrive <em>fresh.</em>
              </span>
            </span>
          </h1>

          <div className="hero-grid">
            <div>
              <p className="lede">
                TriTrainer maps your <b>swim, bike and run</b> to race day — a progressive weekly
                plan that <b>syncs from Strava</b>, re-ramps around the training you actually did,
                and <b>tapers you sharp</b> for the start line.
              </p>
              <div className="cta-row">
                <Link href="/signup" className="btn">
                  <span>Start free</span> <span>→</span>
                </Link>
                <a href="#build" className="btn ghost">
                  <span>See how it works</span>
                </a>
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
          </div>

          <div className="lanes reveal">
            <div className="lane">
              <div className="lane-name" style={{ color: "var(--swim)" }}>
                Swim
              </div>
              <div className="track">
                <span
                  className="runner"
                  style={{ background: "var(--swim)", boxShadow: "0 0 14px var(--swim)" }}
                />
              </div>
              <div className="lane-dist">
                3.8<small>km open water</small>
              </div>
            </div>
            <div className="lane">
              <div className="lane-name" style={{ color: "var(--bike)" }}>
                Bike
              </div>
              <div className="track">
                <span
                  className="runner"
                  style={{
                    background: "var(--bike)",
                    boxShadow: "0 0 14px var(--bike)",
                    animationDuration: "4s",
                  }}
                />
              </div>
              <div className="lane-dist">
                180<small>km on the road</small>
              </div>
            </div>
            <div className="lane">
              <div className="lane-name" style={{ color: "var(--run)" }}>
                Run
              </div>
              <div className="track">
                <span
                  className="runner"
                  style={{
                    background: "var(--run)",
                    boxShadow: "0 0 14px var(--run)",
                    animationDuration: "6.4s",
                  }}
                />
              </div>
              <div className="lane-dist">
                42.2<small>km to the line</small>
              </div>
            </div>
          </div>
        </header>

        <section id="build">
          <div className="sec-head">
            <div className="sec-num reveal">01</div>
            <div>
              <h2 className="sec-title reveal">
                A build that
                <br />
                actually <em>builds.</em>
              </h2>
              <p className="sec-body reveal" data-d="1">
                Give TriTrainer your event and your starting volume. It lays out{" "}
                <b>progressive weekly targets</b> for every sport — climbing at a safe{" "}
                <b>12% a week</b>, easing every fourth week so you absorb the work, and holding a
                sensible cap. No spreadsheets, no guesswork.
              </p>
            </div>
          </div>
          <div className="cards">
            <div className="card reveal" data-d="1" style={accent("var(--swim)")}>
              <div className="k">Periodized</div>
              <h3>Four-week blocks, built in</h3>
              <p>
                Three weeks up, one week down. Every block ends in a de-load so fitness sticks
                instead of snapping.
              </p>
            </div>
            <div className="card reveal" data-d="2" style={accent("var(--bike)")}>
              <div className="k">Per sport</div>
              <h3>Swim, bike &amp; run in step</h3>
              <p>
                Each discipline gets its own ramp toward its own race distance — moving together,
                week by week.
              </p>
            </div>
            <div className="card reveal" data-d="3" style={accent("var(--run)")}>
              <div className="k">Honest limits</div>
              <h3>Never more than +12%</h3>
              <p>
                The build respects the golden rule of endurance load. Ambitious, but never the kind
                of jump that breaks you.
              </p>
            </div>
          </div>
        </section>

        <section id="adapt">
          <div className="sec-head">
            <div className="sec-num reveal">02</div>
            <div>
              <h2 className="sec-title reveal">
                Syncs itself.
                <br />
                Then <em>adapts.</em>
              </h2>
              <p className="sec-body reveal" data-d="1">
                Connect <b>Strava</b> or <b>Apple Health</b> and your actual training flows in
                automatically. Each week the plan <b>re-ramps from what you really did</b> — crushed
                it, and next week reaches higher; missed it, and it rebuilds gently instead of
                snowballing.
              </p>
            </div>
          </div>
          <div className="cards">
            <div className="card reveal" data-d="1" style={accent("var(--bike)")}>
              <div className="k">Auto-track</div>
              <h3>Strava + Apple Health</h3>
              <p>
                Rides, runs and swims land in the right week on their own. Log a session by hand any
                time you like.
              </p>
            </div>
            <div className="card reveal" data-d="2" style={accent("var(--swim)")}>
              <div className="k">Weekly re-ramp</div>
              <h3>Reads the real week</h3>
              <p>
                Every roll-over, the plan re-plots the road ahead from your actual volume — not the
                projection you set months ago.
              </p>
            </div>
            <div className="card reveal" data-d="3" style={accent("var(--run)")}>
              <div className="k">Check-in</div>
              <h3>Listens to your body</h3>
              <p>
                Flag a fatigued, sore or sleepless week and the next targets ease off automatically.
                Recovery, on the record.
              </p>
            </div>
          </div>
        </section>

        <div className="telemetry">
          <div className="marquee">
            {[...MARQUEE, ...MARQUEE].map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
        </div>

        <section id="taper">
          <div className="sec-head">
            <div className="sec-num reveal">03</div>
            <div>
              <h2 className="sec-title reveal">
                Peak early.
                <br />
                Arrive <em>fresh.</em>
              </h2>
              <p className="sec-body reveal" data-d="1">
                Most plans have you doing your biggest week the week of your race. TriTrainer
                doesn&apos;t. It <b>peaks a fortnight out</b>, then ramps volume down to{" "}
                <b>half by race week</b> — so you turn up rested, sharp, and ready to spend it all.
                A <b>readiness projection</b> tells you if you&apos;re on track to hit your peak,
                and exactly what to add if you&apos;re not.
              </p>
            </div>
          </div>
          <div className="cards">
            <div className="card reveal" data-d="1" style={accent("var(--run)")}>
              <div className="k">The taper</div>
              <h3>Down to 50% race week</h3>
              <p>
                Two weeks of deliberate easing into the start line. Fitness banked, freshness
                restored.
              </p>
            </div>
            <div className="card reveal" data-d="2" style={accent("var(--swim)")}>
              <div className="k">Readiness</div>
              <h3>Know if you&apos;ll make peak</h3>
              <p>
                A projection reads your trajectory and calls it: on track, ahead, or &ldquo;add ~5
                km a week to your bike.&rdquo;
              </p>
            </div>
            <div className="card reveal" data-d="3" style={accent("var(--bike)")}>
              <div className="k">Consistency</div>
              <h3>Streaks that mean it</h3>
              <p>
                A week-by-week heatmap of every target you hit — because showing up is the whole
                sport.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="finale">
        <div className="wrap">
          <h2 className="reveal">
            Your next
            <br />
            start line
            <br />
            is a <em>plan</em> away.
          </h2>
          <p className="mono sub reveal" data-d="1">
            Free to start · swim · bike · run
          </p>
          <div className="reveal" data-d="2">
            <Link href="/signup" className="btn">
              <span>Build my plan</span> <span>→</span>
            </Link>
          </div>
        </div>
      </div>

      <footer>
        <div className="wrap foot-in">
          <div className="brand" style={{ fontSize: 18 }}>
            <span className="dot3">
              <i />
              <i />
              <i />
            </span>
            TRITRAINER
          </div>
          <div className="foot-links">
            <Link href="/about">About</Link>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div className="mono" style={{ letterSpacing: "0.1em" }}>
            Built for triathletes · arrive fresh
          </div>
        </div>
      </footer>

      <LandingEffects />
    </div>
  );
}
