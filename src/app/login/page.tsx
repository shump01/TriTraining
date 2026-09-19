import Link from "next/link";

import { oauthProviders } from "@/auth";
import { authErrorMessage } from "@/lib/auth-error-message";

import { AuthLayout } from "../auth-layout";
import { LoginForm } from "./login-form";
import { LoginJourney } from "./login-journey";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const providers = oauthProviders();
  // Auth.js bounces OAuth failures back here as ?error=<code>.
  const providerError = authErrorMessage(error);

  return (
    <AuthLayout
      eyebrow="Welcome back"
      headline={
        <>
          Back to
          <br />
          the <em>build.</em>
        </>
      }
      sub="Your plan has been holding the line. Sign in to pick up right where you left off — week by week, sport by sport."
      formTitle="Sign in"
      formSub="Pick up your build where you left off."
      brand={<LoginJourney />}
      alt={
        <p className="auth-alt">
          New to TriTrainer? <Link href="/signup">Create one</Link>
        </p>
      }
    >
      <LoginForm
        callbackUrl={callbackUrl ?? "/dashboard"}
        providers={providers}
        providerError={providerError}
      />
    </AuthLayout>
  );
}
