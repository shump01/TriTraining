import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <AuthShell>
      <h2 className="m-0 mb-1.5 font-display text-[30px] font-extrabold tracking-[-0.02em]">
        Sign in
      </h2>
      <p className="m-0 mb-7 text-[15px] text-muted">Pick up your build where you left off.</p>
      <LoginForm callbackUrl={callbackUrl ?? "/dashboard"} />
      <p className="mt-[22px] text-center text-[14px] text-muted">
        New to TriTrainer?{" "}
        <Link href="/signup" className="font-bold text-brand">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
