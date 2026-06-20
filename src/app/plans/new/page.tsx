import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { NewPlanForm } from "./new-plan-form";

export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/plans/new");
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 560 }}>
      <h1>Create a training plan</h1>
      <NewPlanForm />
    </main>
  );
}
