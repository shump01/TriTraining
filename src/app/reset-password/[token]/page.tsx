import Link from "next/link";

import { AuthLayout } from "../../auth-layout";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthLayout
      eyebrow="New password"
      headline={
        <>
          A fresh
          <br />
          <em>start.</em>
        </>
      }
      sub="Choose something strong. For your security, setting a new password signs out any existing sessions."
      formTitle="New password"
      formSub="Set a new password for your account."
      alt={
        <p className="auth-alt">
          Link expired? <Link href="/forgot-password">Request a new one</Link>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthLayout>
  );
}
