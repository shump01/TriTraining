import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy — TriTrainer",
  description:
    "What TriTrainer collects, how it's used, and how to delete it. No ads, no trackers, no selling data — your training data exists only to power your plan.",
};

const EFFECTIVE_DATE = "July 19, 2026";

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: "The short version",
    paragraphs: [
      "TriTrainer stores the minimum it needs to build your training plan and show your progress: your account, your plans, your weekly training distances, and — only if you choose to share them — heart-rate summaries and wellbeing check-ins that make the plan smarter. There are no ads, no third-party analytics or trackers, and your data is never sold or shared for marketing. You can permanently delete everything, at any time, from inside the app or the website.",
    ],
  },
  {
    title: "Who we are",
    paragraphs: [
      "TriTrainer is the controller of the personal data described in this policy, for the purposes of UK data protection law (the UK GDPR and the Data Protection Act 2018). This policy covers the TriTrainer website and the TriTrainer iOS app — one account, the same data, the same rules. You can reach us via the contact details on the app's App Store listing or through this website.",
    ],
  },
  {
    title: "What we collect",
    paragraphs: [
      "Account: your email address, a password, and an optional screen name. The password is stored only as a secure hash — we cannot read it.",
      "Training data: the plans you create (race date, sports, distances, settings), the weekly targets TriTrainer computes, and your weekly actual distances — entered manually or imported from Strava or Apple Health.",
      "Heart rate & training load: if you set a threshold heart rate, or your imported activities include heart-rate data, we store per-activity summaries (duration and average heart rate) and the fitness, fatigue, and form scores computed from them. This exists solely to power the training-load page and readiness guidance.",
      "Wellbeing check-ins & time off: if you use the weekly check-in, we store your self-reported fatigue, sleep, and soreness ratings and any note you add. If you pause a plan, we store the pause and the reason you select (such as illness, injury, or travel) and any note. You choose whether to provide any of this.",
      "Groups: the groups you create or join, so members can see each other's current-week progress per sport. Group members see your screen name (or your email-derived display name) and weekly progress — nothing else.",
      "Sessions: signing in creates a session (a cookie on the web, a token stored in your phone's secure storage in the app) that expires after 30 days.",
      "Server logs: standard technical logs, including IP addresses, are kept briefly for security, debugging, and abuse prevention (such as rate limiting).",
    ],
  },
  {
    title: "Health-related data & our lawful bases",
    paragraphs: [
      "Some of what TriTrainer can store — heart-rate summaries, workout data from Apple Health, wellbeing ratings, and illness or injury as a pause reason — is health-related data, which UK GDPR treats as special category data deserving extra protection.",
      "We process it only with your explicit consent, which you give through a deliberate action: connecting Strava, granting Apple Health access, setting a threshold heart rate, submitting a check-in, or recording time off. Each of these is optional; the core plan works without any of them. You can withdraw consent at any time by disconnecting Strava, revoking Apple Health access, or deleting the data or your account — withdrawal doesn't affect the lawfulness of processing before it.",
      "For everything else we rely on: performance of a contract (your account, plans, and progress data — the service you signed up for can't work without them) and our legitimate interests (short-lived security logs and rate limiting to keep the service safe, in ways that don't override your rights).",
    ],
  },
  {
    title: "Strava",
    paragraphs: [
      "If you connect Strava, we store the OAuth tokens Strava issues (encrypted at rest) so we can read your activities on your behalf. From each activity we keep only what the plan needs: the sport, the distance, the week it belongs to, and — for training load — the moving time and average heart rate where Strava provides them.",
      "You can disconnect Strava at any time from the dashboard, which deletes the stored tokens and revokes TriTrainer's access on Strava's side. Deleting your account does the same automatically. Your use of Strava itself is governed by Strava's own terms and privacy policy.",
    ],
  },
  {
    title: "Apple Health",
    paragraphs: [
      "In the iOS app you can grant read-only access to your workouts in Apple Health. With your permission, the app reads workout entries and sends only the sport type, distance, start date, duration, average heart rate, and the workout's identifier (used to avoid double-counting) to your TriTrainer account, where they are stored as weekly totals per sport plus per-activity load summaries.",
      "Health data is used solely to fill in your training volume and training load. It is never used for advertising or marketing, never sold, never shared with third parties, and never used for any purpose other than showing your training progress. You can revoke access at any time in the iOS Health app or Settings; deleting your account removes everything imported from our systems.",
    ],
  },
  {
    title: "How your data is used",
    paragraphs: [
      "Exclusively to provide TriTrainer's features: generating and adapting weekly targets, tracking actual vs target volume, computing training load and readiness, and sharing weekly progress inside groups you chose to join.",
      "We send email in two cases: messages the service requires (such as a password-reset link you requested), and — if you keep it on — a weekly digest summarising your own training week. Every digest carries an unsubscribe link, and the switch lives on the Account page. There are no marketing emails.",
      "We do not run ads, we do not use third-party analytics or tracking, we make no automated decisions with legal or similarly significant effects, and we never sell or rent your data.",
    ],
  },
  {
    title: "Cookies",
    paragraphs: [
      "TriTrainer uses only strictly necessary cookies: a session cookie that keeps you signed in, and a short-lived state cookie during the Strava connection flow to protect against forgery. Your theme preference is kept in your browser's local storage and never sent to us as tracking.",
      "There are no analytics, advertising, or third-party cookies of any kind — which is why you don't see a cookie banner: UK law (PECR) only requires consent for cookies that aren't essential to the service you asked for.",
    ],
  },
  {
    title: "Where your data lives & who processes it",
    paragraphs: [
      "TriTrainer runs on our own server in the EU, with data stored in a Postgres database hosted by Supabase on AWS infrastructure in Frankfurt, Germany (eu-central-1). Traffic between your device and TriTrainer is encrypted with HTTPS.",
      "We use a small number of processors to run the service: our hosting provider, Supabase (database hosting), and an email provider used only to send the emails you request. Your data is not transferred outside the UK or the European Economic Area in normal operation.",
    ],
  },
  {
    title: "How long we keep it",
    paragraphs: [
      "Your data is kept for as long as your account exists. When you delete your account, everything is removed immediately from the live database; residual copies in short-lived encrypted database backups expire automatically on the provider's rolling schedule. Server logs are kept briefly and then discarded.",
    ],
  },
  {
    title: "Your rights",
    paragraphs: [
      "Under UK GDPR you have the right to: access the personal data we hold about you; correct it (most of it you can edit directly in the app); erase it (delete your account, or ask us); receive a copy in a portable format; restrict or object to processing; and withdraw consent for the health-related data described above at any time.",
      "To exercise any of these, use the in-app controls or contact us. You also have the right to complain to the UK's supervisory authority, the Information Commissioner's Office (ICO), at ico.org.uk — though we'd appreciate the chance to sort out any concern first.",
    ],
  },
  {
    title: "Deleting your data",
    paragraphs: [
      "You can permanently delete your account from the Account page on the web or in the app. Deletion is immediate and removes everything: your plans, targets, actuals (including anything imported from Strava or Apple Health), heart-rate and training-load data, check-ins and pauses, group memberships, groups you own, sessions, and any stored Strava connection — and it revokes TriTrainer's access on Strava's side.",
      "Short of full deletion: leaving a group removes your progress from it, and disconnecting Strava deletes the stored tokens.",
    ],
  },
  {
    title: "Changes & contact",
    paragraphs: [
      "If this policy changes in a way that matters, we'll update this page and its effective date. Questions or requests (including data deletion or access requests by email) can be sent via the contact details on the app's App Store listing or through this website.",
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
        <div className="flex items-center gap-4">
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
