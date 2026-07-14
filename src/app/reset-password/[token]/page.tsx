import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthShell>
      <h2 className="m-0 mb-1.5 font-display text-[30px] font-extrabold tracking-[-0.02em]">
        Choose a new password
      </h2>
      <p className="m-0 mb-7 text-[15px] text-muted">Set a new password for your account.</p>
      <ResetPasswordForm token={token} />
      <p className="mt-[22px] text-center text-[14px] text-muted">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-bold text-brand">
          Request a new one
        </Link>
      </p>
    </AuthShell>
  );
}
