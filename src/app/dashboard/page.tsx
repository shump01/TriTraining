import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Full server-side validation of the database session. Redirects unauthenticated
  // (or stale-cookie) visitors to /login.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Dashboard</h1>
      <p>
        You are signed in as <strong>{session.user.email}</strong>.
      </p>
      <p>This is a protected route — only authenticated users can see it.</p>
      <p>
        <Link href="/plans">View your training plans →</Link>
      </p>
      <SignOutButton />
    </main>
  );
}
