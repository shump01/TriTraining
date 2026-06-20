import Link from "next/link";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 400 }}>
      <h1>Log in</h1>
      <LoginForm callbackUrl={callbackUrl ?? "/dashboard"} />
      <p style={{ marginTop: "1rem" }}>
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}
