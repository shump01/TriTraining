import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listTrainingPlans } from "@/lib/training-plan";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function PlansPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/plans");
  }

  // Scoped to the authenticated user — only their plans are returned.
  const plans = await listTrainingPlans();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h1>Your training plans</h1>
        <Link href="/plans/new">+ New plan</Link>
      </div>

      {plans.length === 0 ? (
        <p>
          No plans yet. <Link href="/plans/new">Create your first one</Link>.
        </p>
      ) : (
        <ul style={{ lineHeight: 1.8 }}>
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link href={`/plans/${plan.id}`}>{plan.name}</Link>{" "}
              <span style={{ color: "#666" }}>— {formatDate(plan.eventDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
