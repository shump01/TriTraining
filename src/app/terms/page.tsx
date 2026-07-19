import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of service — TriTrainer",
  description:
    "The terms for using TriTrainer. Plain-language rules, a clear 'not medical advice' disclaimer for training guidance, and how the service works.",
};

const EFFECTIVE_DATE = "July 19, 2026";

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: "The short version",
    paragraphs: [
      "TriTrainer generates triathlon training targets from the details you give it. It's a planning tool, not a coach or a doctor — the training decisions, and the responsibility for them, are yours. Use it lawfully, keep your account secure, and don't abuse the service. It's provided as-is; you can leave (and take everything with you, by deleting) at any time.",
    ],
  },
  {
    title: "Not medical advice",
    paragraphs: [
      "TriTrainer's plans, weekly targets, readiness signals, training-load scores, and every other output are general, algorithm-generated training guidance computed from the numbers you provide. They are not medical advice, physiotherapy advice, or professional coaching, and they are not tailored to your health.",
      "Endurance training carries real risks. Before starting or significantly changing a training programme, consult a doctor or qualified professional — especially if you have (or suspect) a heart condition, injury, illness, or any other medical concern, or if you are pregnant. Stop training and seek medical help if you feel unwell, faint, or in pain.",
      "You alone decide whether, when, and how hard to train. TriTrainer's suggestions — including any suggestion to increase volume or to resume after time off — never override how your body actually feels or what a medical professional tells you.",
    ],
  },
  {
    title: "The service",
    paragraphs: [
      "TriTrainer is a training-planning tool for triathletes: it computes weekly swim, bike, and run targets from a race date and your inputs, adapts them to your logged progress, and shows training load and group progress. It is available as a website and an iOS app; one account covers both.",
      "The quality of the output depends on the quality of your input. Targets computed from inaccurate distances, dates, or heart-rate values will themselves be inaccurate.",
    ],
  },
  {
    title: "Your account",
    paragraphs: [
      "You need an account to use TriTrainer, and you must provide accurate details and keep your password secure — you're responsible for activity under your account. You must be at least 16 to create one.",
      "You can delete your account, and all data in it, at any time from the Account page. How data is handled is covered by the privacy policy, which forms part of these terms.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "Use TriTrainer only lawfully and as a training tool. Don't attempt to break, probe, or overload the service; don't access other people's data or accounts; don't scrape, resell, or misrepresent the service; and keep anything you name or write in the app (screen names, group names, notes) free of unlawful or abusive content.",
      "Requests are rate-limited, and we may suspend or close accounts that abuse the service or these terms — where practical, we'll warn you first.",
    ],
  },
  {
    title: "Third-party services",
    paragraphs: [
      "Connecting Strava or granting Apple Health access is optional and subject to those services' own terms and policies. We're not responsible for their availability or the accuracy of the data they provide, and a change on their side may affect features that depend on them.",
    ],
  },
  {
    title: "Availability & changes",
    paragraphs: [
      "TriTrainer is provided “as is” and “as available”, without warranties of any kind to the extent the law allows. We work to keep it reliable, but we don't guarantee uninterrupted access, error-free operation, or that any particular feature will exist forever — features may change, improve, or be withdrawn.",
      "We may update these terms; if a change matters, we'll update this page and its effective date, and continuing to use the service after that means you accept the updated terms.",
    ],
  },
  {
    title: "Liability",
    paragraphs: [
      "Nothing in these terms excludes or limits liability that cannot be excluded under the law of England and Wales, including liability for death or personal injury caused by our negligence, or for fraud.",
      "Subject to that: TriTrainer is a free planning tool, and to the maximum extent permitted by law we are not liable for training outcomes, injuries or health effects arising from your training decisions, loss of data, loss of profit, or any indirect or consequential loss arising from your use of (or inability to use) the service.",
    ],
  },
  {
    title: "Governing law",
    paragraphs: [
      "These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction over any dispute — though if you live elsewhere in the UK, you keep the benefit of any mandatory consumer protections of your home nation.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Questions about these terms can be sent via the contact details on the app's App Store listing or through this website.",
    ],
  },
];

export default function TermsPage() {
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
          Terms of service
        </h1>
        <p className="mt-4 font-mono text-[12px] tracking-[0.12em] text-faint uppercase">
          Effective {EFFECTIVE_DATE}
        </p>
        <p className="mt-4 max-w-[620px] text-[15px] leading-[1.6] text-muted">
          These terms cover the TriTrainer website and the TriTrainer mobile app. They work together
          with the{" "}
          <Link href="/privacy" className="text-text underline underline-offset-2 hover:text-brand">
            privacy policy
          </Link>
          .
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
          <Link href="/privacy" className="hover:text-text">
            Privacy
          </Link>
          <Link href="/about" className="hover:text-text">
            About
          </Link>
        </div>
      </footer>
    </div>
  );
}
