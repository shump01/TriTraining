import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — TriTrainer",
  description:
    "Help for the TriTrainer website and iOS app: syncing, training plans, account and data, sign-in, and how to reach us.",
};

const SUPPORT_EMAIL = "support@richysdev.co.uk";

/**
 * A section may render plain paragraphs and/or a bullet list. `platform` tags
 * a section as web- or app-specific so a reader on either surface can tell at a
 * glance what applies to them; omitted = applies to both.
 */
const SECTIONS: {
  title: string;
  platform?: "Website" | "iOS app";
  paragraphs?: string[];
  bullets?: string[];
}[] = [
  {
    title: "Getting started",
    paragraphs: [
      "TriTrainer builds progressive weekly swim, bike and run targets from a race date, then adapts them to what you actually do. Create an account, add a plan with your event date and starting weekly volumes, and you'll get week-by-week targets all the way to race day.",
      "One account covers both the website and the iOS app — the same plans, data and settings appear on both. You can use either, or both.",
    ],
  },
  {
    title: "Connecting Strava",
    paragraphs: [
      "On the dashboard, use the Strava card to connect. Once linked, TriTrainer reads your recent activities and fills in your weekly actual distances automatically; a Sync button pulls the latest. Only the sport, distance, week, and — where Strava provides it — moving time and average heart rate are used.",
      "You can disconnect any time from the same card, which deletes the stored tokens and revokes TriTrainer's access on Strava's side.",
    ],
  },
  {
    title: "Apple Health sync",
    platform: "iOS app",
    paragraphs: [
      "In the iOS app you can grant read-only access to your workouts in Apple Health. With permission, the app reads completed workouts and sends the sport, distance, start time, duration, average heart rate, and the workout's identifier to your account, where they become weekly totals and training-load data.",
      "Sync happens in the background shortly after a workout finishes while your phone is unlocked, and always catches up next time you open the app. If a workout isn't showing: confirm TriTrainer has permission in the iOS Health app (Sharing → Apps), that the workout has finished syncing to Apple Health from your watch, and open the TriTrainer app once to trigger a catch-up.",
    ],
  },
  {
    title: "How your weekly numbers are counted",
    paragraphs: [
      "To avoid double-counting a workout that reaches us from more than one place, TriTrainer uses a single automatic source: Strava if it's connected, otherwise Garmin (where available), otherwise Apple Health. Those never add together.",
      "A manual entry works differently — it ADDS on top of the synced total rather than replacing it. Use it to top up something a sync couldn't see: a pool swim done without a watch, a treadmill run, a session on a friend's bike. If a manual entry was a mistake, remove it from the week's row rather than editing it to zero.",
    ],
  },
  {
    title: "Why your weekly targets change",
    paragraphs: [
      "Targets aren't fixed — at the start of each training week the plan rolls forward from what you actually did the week before, so a big week nudges the next ones up and a light week eases them. Two extra signals fine-tune this: the weekly check-in (fatigue, sleep, soreness) and, if you've set a threshold heart rate, your current Form from training load.",
      "If you mark a week as time off (illness, injury, travel), that week is treated as rest rather than a miss — it won't count against you, and when you return the plan re-ramps from a sensible, slightly reduced baseline instead of dropping you straight back onto the old number.",
    ],
  },
  {
    title: "The week planner and today's session",
    paragraphs: [
      "Each plan week's volume is laid out as suggested sessions on days. Drag a session to another day (or use the arrow buttons on touch), and tick it off when done — or let it tick itself when a matching activity syncs. The dashboard shows today's sessions at a glance. It's a starting point to follow or rearrange, not a rule.",
    ],
  },
  {
    title: "Training load and the race forecast",
    paragraphs: [
      "The Load page shows Fitness, Fatigue and Form from your heart-rate activities, plus a forecast of where your Form lands on race day if you follow the remaining plan. Both need two things: a threshold heart rate (set it on the Load page) and some heart-rate-recorded activities to score. Most pool swims don't record heart rate, so they count toward your volume but not your load.",
    ],
  },
  {
    title: "Groups",
    paragraphs: [
      "Groups are a light social layer: share a join link and members can see each other's current-week progress per sport — your screen name and percentages, nothing else. Leaving a group removes your progress from it immediately.",
    ],
  },
  {
    title: "Signing in and passwords",
    paragraphs: [
      "If you've forgotten your password, use the “Forgot password?” link on the sign-in page — we'll email a reset link that's valid for 60 minutes. For security the link can be used once, and resetting signs out your other devices.",
      "If a reset email doesn't arrive, check your spam folder and confirm you're using the address you signed up with. Password-reset emails are the only automatic email we send unless you've opted into the weekly digest.",
    ],
  },
  {
    title: "Managing your account and data",
    paragraphs: [
      "The Account page (web or app) is where you change your screen name, update your password, sign out, and delete your account. Deleting is immediate and removes everything — plans, actuals, training-load and check-in data, group memberships, and any connected services.",
      "Your privacy rights, what we store, and how to make an access or deletion request are covered in the privacy policy.",
    ],
  },
  {
    title: "The weekly email",
    paragraphs: [
      "If you turn it on (Account → Email), you'll get one short summary at the start of each training week. Every digest has a one-click unsubscribe link, and you can switch it off any time from the Account page. There are no marketing emails.",
    ],
  },
  {
    title: "Is TriTrainer free?",
    paragraphs: [
      "Yes. Every feature works without paying — there's no subscription, no trial, no ads, and nothing is locked behind a purchase.",
      "The one thing you can buy is optional: in the iOS app you can tip the developer the price of a caffeine gel. It unlocks nothing and the app is identical whether you do or don't. Apple handles the payment, so we never see or store your card details.",
      "We will never ask you to type card details into TriTrainer, or email you asking for payment. If that happens, it isn't us — don't enter anything and let us know.",
    ],
  },
];

export default function SupportPage() {
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
        </div>
      </header>

      {/* Title */}
      <section className="mx-auto max-w-[760px] px-5 pt-8 pb-4 sm:pt-14">
        <h1 className="m-0 font-display text-[34px] leading-[1.05] font-black tracking-[-0.03em] sm:text-[44px]">
          Support
        </h1>
        <p className="mt-4 max-w-[620px] text-[15px] leading-[1.6] text-muted">
          Help for the TriTrainer website and the iOS app — one account, the same data, the same
          answers. Most questions are covered below; if not, we&apos;re an email away.
        </p>
      </section>

      {/* Contact callout */}
      <section className="mx-auto max-w-[760px] px-5 pb-2">
        <div className="rounded-[16px] border border-border bg-card2 p-5">
          <h2 className="m-0 mb-1.5 font-display text-[17px] font-extrabold tracking-[-0.01em]">
            Contact us
          </h2>
          <p className="m-0 text-[14px] leading-[1.6] text-muted">
            Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-brand underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            and we&apos;ll get back to you, usually within a couple of days. It helps to include
            whether you&apos;re on the website or the app, and — for anything that looks wrong — the
            plan and week you were looking at.
          </p>
        </div>
      </section>

      {/* Sections */}
      <section className="mx-auto flex max-w-[760px] flex-col gap-3.5 px-5 pt-3.5 pb-16">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-[16px] border border-border bg-card p-5">
            <div className="mb-2 flex items-center gap-2.5">
              <h2 className="m-0 font-display text-[17px] font-extrabold tracking-[-0.01em]">
                {s.title}
              </h2>
              {s.platform && (
                <span className="rounded-[20px] border border-border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.06em] text-faint uppercase">
                  {s.platform}
                </span>
              )}
            </div>
            {s.paragraphs?.map((p, i) => (
              <p
                key={i}
                className={`m-0 text-[14px] leading-[1.6] text-muted ${i > 0 ? "mt-2.5" : ""}`}
              >
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="mt-2.5 mb-0 flex list-disc flex-col gap-1.5 pl-5">
                {s.bullets.map((b, i) => (
                  <li key={i} className="text-[14px] leading-[1.55] text-muted">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <p className="mt-2 px-1 text-[13px] leading-[1.6] text-faint">
          Still stuck, found a bug, or have an idea? Email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-muted underline underline-offset-2 hover:text-text"
          >
            {SUPPORT_EMAIL}
          </a>
          . See also the{" "}
          <Link href="/privacy" className="text-muted underline underline-offset-2 hover:text-text">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-muted underline underline-offset-2 hover:text-text">
            terms of service
          </Link>
          .
        </p>
      </section>

      <footer className="mx-auto flex max-w-[1000px] items-center justify-between border-t border-border px-5 py-6 font-mono text-[12px] text-faint">
        <span>© 2026 TriTrainer</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-text">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-text">
            Terms
          </Link>
          <Link href="/about" className="hover:text-text">
            About
          </Link>
        </div>
      </footer>
    </div>
  );
}
