import Link from "next/link";

import { auth } from "@/auth";
import { getStravaConnectionSummary } from "@/lib/strava/connection";

import { PlanForm } from "../plan-form";
import { emptyPlanFormValues } from "../plan-form-values";

import "../../surface.css";

export const dynamic = "force-dynamic";

export default async function NewPlanPage() {
  const session = await auth();
  const stravaConnected = session?.user?.id
    ? Boolean(await getStravaConnectionSummary(session.user.id))
    : false;

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap max-w-[680px]">
        <div className="rise" style={{ animationDelay: "0.05s" }}>
          <Link href="/plans" className="backlink">
            ← All plans
          </Link>
          <h1 className="mk-h1 sm">
            New training <em>plan.</em>
          </h1>
          <p className="lede mb-[26px]">
            Pick your race and where you&apos;re starting from — we&apos;ll build progressive weekly
            targets up to race day.
          </p>
        </div>
        <div className="rise" style={{ animationDelay: "0.15s" }}>
          <PlanForm initial={emptyPlanFormValues()} stravaConnected={stravaConnected} />
        </div>
      </div>
    </div>
  );
}
