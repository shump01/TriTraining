import Link from "next/link";

import { AuthLayout } from "../auth-layout";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      eyebrow="Account recovery"
      headline={
        <>
          Locked
          <br />
          <em>out?</em>
        </>
      }
      sub="It happens. Enter your email and we'll send a link to set a new password — valid for 60 minutes."
      formTitle="Reset password"
      formSub="Enter your email and we'll send you a reset link."
      alt={
        <p className="auth-alt">
          Remembered it? <Link href="/login">Back to sign in</Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
