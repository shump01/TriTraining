import Link from "next/link";

import { AuthLayout } from "../auth-layout";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <AuthLayout
      eyebrow="Start free"
      headline={
        <>
          Start
          <br />
          the <em>build.</em>
        </>
      }
      sub="Two minutes to your first plan — swim, bike and run, mapped all the way to race day."
      formTitle="Create account"
      formSub="Start tracking targets in two minutes."
      alt={
        <p className="auth-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <SignupForm />
    </AuthLayout>
  );
}
