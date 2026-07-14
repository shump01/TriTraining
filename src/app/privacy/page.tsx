import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy — TriTrainer",
  description:
    "What TriTrainer collects, how it's used, and how to delete it. No ads, no trackers, no selling data — your training data exists only to power your plan.",
};

const EFFECTIVE_DATE = "July 14, 2026";

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: "The short version",
    paragraphs: [
      "TriTrainer stores the minimum it needs to build your training plan and show your progress: your account, your plans, and your weekly training distances. There are no ads, no third-party analytics or trackers, and your data is never sold or shared for marketing. You can permanently delete everything, at any time, from inside the app or the website.",
    ],
  },
  {
    title: "What we collect",
    paragraphs: [
      "Account: your email address and a password. The password is stored only as a secure hash — we cannot read it.",
      "Training data: the plans you create (race date, sports, distances, settings), the weekly targets TriTrainer computes, and your weekly actual distances — entered manually or imported from Strava or Apple Health.",
      "Groups: the groups you create or join, so members can see each other's current-week progress per sport. Group members see your email-derived display name and weekly progress — nothing else.",
      "Sessions: signing in creates a session (a cookie on the web, a token stored in your phone's secure storage in the app) that expires after 30 days.",
      "Server logs: standard technical logs, including IP addresses, are kept briefly for security, debugging, and abuse prevention (such as rate limiting).",
    ],
  },
  {
    title: "Strava",
    paragraphs: [
      "If you connect Strava, we store the OAuth tokens Strava issues so we can read your activities on your behalf. From each activity we keep only what the plan needs: the sport, the distance, and the week it belongs to — stored as weekly totals per sport. You can disconnect Strava at any time, which deletes the stored tokens.",
    ],
  },
  {
    title: "Apple Health",
    paragraphs: [
      "In the iOS app you can grant read-only access to your workouts in Apple Health. With your permission, the app reads workout entries and sends only the sport type, distance, and start date of each workout to your TriTrainer account, where they are stored as weekly totals per sport.",
      "Health data is used solely to fill in your weekly training volume. It is never used for advertising or marketing, never sold, never shared with third parties, and never used for any purpose other than showing your training progress. You can revoke access at any time in the iOS Health app or Settings; deleting your account removes all imported totals from our systems.",
    ],
  },
  {
    title: "How your data is used",
    paragraphs: [
      "Exclusively to provide TriTrainer's features: generating and adapting weekly targets, tracking actual vs target volume, and sharing weekly progress inside groups you chose to join.",
      "We send email only when the service requires it — for example, a password-reset link you requested. There are no marketing emails.",
      "We do not run ads, we do not use third-party analytics or tracking, and we never sell or rent your data.",
    ],
  },
  {
    title: "Where your data lives",
    paragraphs: [
      "TriTrainer runs on our own server in the EU, with data stored in a Postgres database hosted by Supabase. Traffic between your device and TriTrainer is encrypted with HTTPS.",
    ],
  },
  {
    title: "Deleting your data",
    paragraphs: [
      "You can permanently delete your account from the app (Settings → Delete account). Deletion is immediate and removes everything: your plans, targets, actuals (including anything imported from Strava or Apple Health), group memberships, groups you own, sessions, and any stored Strava connection.",
      "Leaving a group removes your progress from it; disconnecting Strava deletes the stored tokens.",
    ],
  },
  {
    title: "Changes & contact",
    paragraphs: [
      "If this policy changes in a way that matters, we'll update this page and its effective date. Questions or requests (including data deletion by email) can be sent via the contact details on the app's App Store listing or through this website.",
    ],
  },
];

export default function PrivacyPage() {
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
          Privacy policy
        </h1>
        <p className="mt-4 font-mono text-[12px] tracking-[0.12em] text-faint uppercase">
          Effective {EFFECTIVE_DATE}
        </p>
        <p className="mt-4 max-w-[620px] text-[15px] leading-[1.6] text-muted">
          This policy covers the TriTrainer website and the TriTrainer mobile app — one account, the
          same data, the same rules.
        </p>
      </section>

      {/* Sections */}
      <section className="mx-auto flex max-w-[760px] flex-col gap-3.5 px-5 pb-16">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-[16px] border border-border bg-card p-5">
            <h2 className="m-0 mb-2 font-display text-[17px] font-extrabold tracking-[-0.01em]">
              {s.title}
            </h2>
            {s.paragraphs.map((p, i) => (
              <p
                key={i}
                className={`m-0 text-[14px] leading-[1.6] text-muted ${i > 0 ? "mt-2.5" : ""}`}
              >
                {p}
              </p>
            ))}
          </div>
        ))}
      </section>

      <footer className="mx-auto flex max-w-[1000px] items-center justify-between border-t border-border px-5 py-6 font-mono text-[12px] text-faint">
        <span>© 2026 TriTrainer</span>
        <Link href="/about" className="hover:text-text">
          About
        </Link>
      </footer>
    </div>
  );
}
