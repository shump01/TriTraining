import Link from "next/link";

import { PlanForm, emptyPlanFormValues } from "../plan-form";

export const dynamic = "force-dynamic";

export default function NewPlanPage() {
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
      <PlanForm initial={emptyPlanFormValues()} />
    </div>
  );
}
