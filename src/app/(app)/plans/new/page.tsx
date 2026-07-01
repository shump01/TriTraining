import Link from "next/link";

import { auth } from "@/auth";
import { getStravaConnectionSummary } from "@/lib/strava/connection";

import { PlanForm } from "../plan-form";
import { emptyPlanFormValues } from "../plan-form-values";

export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  const session = await auth();
  const stravaConnected = session?.user?.id
    ? Boolean(await getStravaConnectionSummary(session.user.id))
    : false;

  return (
    <div className="max-w-[680px]">
      <Link href="/plans" className="text-[13.5px] text-muted hover:text-text">
        ← All plans
      </Link>
      <h1 className="mt-4 mb-1.5 font-display text-[32px] font-black tracking-[-0.025em]">
        New training plan
      </h1>
      <p className="m-0 mb-[26px] text-muted">
        We&apos;ll build progressive weekly targets up to race day.
      </p>
      <PlanForm initial={emptyPlanFormValues()} stravaConnected={stravaConnected} />
    </div>
  );
}
