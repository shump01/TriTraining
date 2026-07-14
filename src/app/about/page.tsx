import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About TriTrainer — plan, track, and share your triathlon build",
  description:
    "TriTrainer builds progressive weekly swim/bike/run targets up to race day, syncs your actuals from Strava, and shows exactly where you stand — week by week.",
};

const FEATURES = [
  {
    title: "Progressive plans",
    body: "Pick a race date and your event distances; TriTrainer builds week-by-week targets that ramp safely to race day — with de-load weeks and a peak-volume cap you control.",
  },
  {
    title: "Strava sync",
    body: "Connect Strava once and your swim, bike, and run distances flow in automatically as weekly actuals. Or enter them by hand — a manual entry always wins.",
  },
  {
    title: "Adaptive targets",
    body: "Each week the plan rolls forward from what you actually did — a strong week nudges the rest up, a light one eases it back, always within safe limits.",
  },
  {
    title: "Groups",
    body: "Share a link to train with friends and see each other's weekly progress per sport — a little accountability goes a long way.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Create your account",
    body: "Sign up with an email and password — no app to install, it runs in your browser.",
  },
  {
    n: "2",
    title: "Build a plan",
    body: "Choose your race date, the sports you're training, each event distance, and your current weekly volume. TriTrainer generates progressive weekly targets up to race day.",
  },
  {
    n: "3",
    title: "Log your training",
    body: "Connect Strava to fill in your weekly distances automatically, or type them in on the plan page. Everything is bucketed into training weeks for you.",
  },
  {
    n: "4",
    title: "Track & adapt",
    body: "See target vs actual per sport and overall, week by week, with clear ahead / on-track / behind status. The plan re-plans each week from your real training.",
  },
  {
    n: "5",
    title: "Train together",
    body: "Create a group, share the invite link, and keep an eye on each other's current-week progress.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Header */}
      <header className="mx-auto flex max-w-[1000px] items-center justify-between px-5 py-5">
        <Link href="/about" className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand font-display text-[18px] font-black text-white">
            T
          </div>
          <span className="font-display text-[19px] font-extrabold tracking-[-0.02em]">
            TriTrainer
          </span>
        </Link>
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="rounded-[10px] px-3.5 py-2 text-[14px] font-bold text-muted hover:text-text"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-[11px] bg-brand px-[16px] py-2 font-display text-[14px] font-bold text-white hover:brightness-110"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1000px] px-5 pt-8 pb-4 sm:pt-14">
        <div className="mb-5 flex gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
          <span className="text-swim">Swim</span>
          <span className="text-faint">·</span>
          <span className="text-bike">Bike</span>
          <span className="text-faint">·</span>
          <span className="text-run">Run</span>
        </div>
        <h1 className="m-0 max-w-[720px] font-display text-[38px] leading-[1.02] font-black tracking-[-0.03em] sm:text-[54px]">
          Every meter, on target.
        </h1>
        <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-muted sm:text-[18px]">
          TriTrainer is a triathlon training planner. Tell it your race and where you are today, and
          it builds progressive weekly swim, bike, and run targets all the way to race day — then
          shows you exactly how you&apos;re tracking as the weeks go by.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-[12px] bg-brand px-[22px] py-[13px] font-display text-[15px] font-bold text-white hover:brightness-110"
          >
            Create your plan →
          </Link>
          <Link
            href="/login"
            className="rounded-[12px] border border-border px-[22px] py-[13px] text-[15px] font-bold text-text hover:border-brand"
          >
            I already have an account
          </Link>
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-[1000px] px-5 py-12">
        <h2 className="m-0 mb-6 font-display text-[13px] font-bold tracking-[0.08em] text-muted uppercase">
          What you get
        </h2>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[16px] border border-border bg-card p-5">
              <h3 className="m-0 mb-2 font-display text-[17px] font-extrabold tracking-[-0.01em]">
                {f.title}
              </h3>
              <p className="m-0 text-[14px] leading-[1.55] text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How to use it */}
      <section className="mx-auto max-w-[1000px] px-5 pb-12">
        <h2 className="m-0 mb-6 font-display text-[13px] font-bold tracking-[0.08em] text-muted uppercase">
          How to use it
        </h2>
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="flex items-start gap-4 rounded-[16px] border border-border bg-card p-5"
            >
              <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-brand font-display text-[15px] font-black text-white">
                {s.n}
              </div>
              <div>
                <h3 className="m-0 mb-1 font-display text-[16px] font-extrabold tracking-[-0.01em]">
                  {s.title}
                </h3>
                <p className="m-0 text-[14px] leading-[1.55] text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-[1000px] px-5 pb-16">
        <div className="rounded-[20px] border border-border bg-bg2 p-8 text-center sm:p-12">
          <h2 className="m-0 font-display text-[26px] font-black tracking-[-0.025em] sm:text-[32px]">
            Ready to build your race?
          </h2>
          <p className="mx-auto mt-3 mb-6 max-w-[440px] text-[15px] leading-[1.55] text-muted">
            It takes about two minutes to set up your first plan.
          </p>
          <Link
            href="/signup"
            className="inline-block rounded-[12px] bg-brand px-[26px] py-[14px] font-display text-[15px] font-bold text-white hover:brightness-110"
          >
            Get started free
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1000px] items-center justify-between border-t border-border px-5 py-6 font-mono text-[12px] text-faint">
        <span>© 2026 TriTrainer</span>
        <Link href="/privacy" className="hover:text-text">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
