import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <h2 className="m-0 mb-1.5 font-display text-[30px] font-extrabold tracking-[-0.02em]">
        Reset your password
      </h2>
      <p className="m-0 mb-7 text-[15px] text-muted">
        Enter your email and we&apos;ll send you a link to set a new one.
      </p>
      <ForgotPasswordForm />
      <p className="mt-[22px] text-center text-[14px] text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-bold text-brand">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
