import Link from "next/link";

import { AuthLayout } from "../../auth-layout";
import { VerifyEmailForm } from "./verify-email-form";

export const dynamic = "force-dynamic";

/**
 * Where the sign-up confirmation email lands. Rendering this page does
 * nothing — mail scanners and link previews fetch every URL in an email, so
 * the confirmation is a POST from the form, and it needs the password chosen
 * at sign-up (see src/lib/signup-verification.ts for why the link alone must
 * never be enough).
 */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <AuthLayout
      eyebrow="One last step"
      headline={
        <>
          Nearly
          <br />
          <em>there.</em>
        </>
      }
      sub="Confirming proves this inbox is yours, and entering your password proves you're the one who signed up with it."
      formTitle="Confirm your email"
      formSub="Enter the password you chose when you signed up."
      alt={
        <p className="auth-alt">
          Already confirmed? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <VerifyEmailForm token={token} />
    </AuthLayout>
  );
}
