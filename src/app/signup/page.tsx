import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <AuthShell>
      <h2 className="m-0 mb-1.5 font-display text-[30px] font-extrabold tracking-[-0.02em]">
        Create account
      </h2>
      <p className="m-0 mb-7 text-[15px] text-muted">Start tracking targets in two minutes.</p>
      <SignupForm />
      <p className="mt-[22px] text-center text-[14px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-brand">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
