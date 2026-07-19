import { auth } from "@/auth";
import { displayNameFor } from "@/lib/display-name";

import {
  ChangePasswordForm,
  DeleteAccountCard,
  ScreenNameForm,
  SignOutButton,
} from "./account-forms";

import "../surface.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const screenName = session?.user?.name ?? null;

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap max-w-[680px]">
        <div className="rise" style={{ animationDelay: "0.05s" }}>
          <span className="eyebrow">
            <span className="pulse" />
            <span className="mono">{email}</span>
          </span>
          <h1 className="mk-h1 sm">
            Your <em>account.</em>
          </h1>
          <p className="lede mb-7">
            {displayNameFor({ name: screenName, email })}, this is where you change how you appear,
            keep the keys safe, and — if it ever comes to it — leave.
          </p>
        </div>

        <div className="rise" style={{ animationDelay: "0.15s" }}>
          <h2 className="section-label" style={{ marginTop: 0 }}>
            Profile
          </h2>
          <div className="rounded-[18px] border border-border bg-card p-6">
            <ScreenNameForm initial={screenName} />
          </div>
        </div>

        <div className="rise" style={{ animationDelay: "0.22s" }}>
          <h2 className="section-label">Security</h2>
          <div className="rounded-[18px] border border-border bg-card p-6">
            <ChangePasswordForm />
          </div>
        </div>

        <div className="rise" style={{ animationDelay: "0.29s" }}>
          <h2 className="section-label">Session</h2>
          <div className="flex items-center justify-between gap-4 rounded-[18px] border border-border bg-card p-6">
            <p className="m-0 text-[13.5px] text-muted">Signed in as {email}.</p>
            <SignOutButton />
          </div>
        </div>

        <div className="rise" style={{ animationDelay: "0.36s" }}>
          <h2 className="section-label" style={{ color: "var(--behind)" }}>
            Danger zone
          </h2>
          <DeleteAccountCard email={email} />
        </div>
      </div>
    </div>
  );
}
