import Link from "next/link";

import { oauthProviders } from "@/auth";
import { authErrorMessage } from "@/lib/auth-error-message";

import { AuthLayout } from "../auth-layout";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
        <>
          <p className="auth-alt">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
          <p className="auth-alt" style={{ fontSize: 12, opacity: 0.85 }}>
            By creating an account you agree to the <Link href="/terms">terms of service</Link> and{" "}
            <Link href="/privacy">privacy policy</Link>.
          </p>
        </>
      }
    >
      <SignupForm providers={oauthProviders()} providerError={authErrorMessage(error)} />
    </AuthLayout>
  );
}
