import Link from "next/link";
import { notFound } from "next/navigation";

import { getTrainingPlan } from "@/lib/training-plan";
import { planStartWeek } from "@/lib/weekly-targets";

import { PlanForm, type PlanFormValues } from "../../plan-form";

import "../../../surface.css";

export const dynamic = "force-dynamic";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
// Stored meters → the form's display unit (swim in m, bike/run in km).
function toDisplay(meters: number, factor: number): string {
  return factor === 1 ? String(meters) : String(meters / 1000);
}

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Scoped to the session user — another user's id returns null → 404.
  const plan = await getTrainingPlan(id);
  if (!plan) {
    notFound();
  }

  const byDisc = new Map(plan.disciplines.map((d) => [d.discipline as string, d]));
  const disc = (key: string, factor: number) => {
    const d = byDisc.get(key);
    return d
      ? {
          enabled: true,
          event: toDisplay(d.eventDistanceMeters, factor),
          start: toDisplay(d.startingWeeklyMeters, factor),
        }
      : { enabled: false, event: "", start: "" };
  };

  const initial: PlanFormValues = {
    name: plan.name,
    startDate: isoDate(planStartWeek(plan)),
    eventDate: isoDate(plan.eventDate),
    capMultiple: String(plan.capMultiple),
    weekStartDay: String(plan.weekStartDay),
    taperWeeks: String(plan.taperWeeks),
    priority: plan.priority,
    disciplines: {
      SWIM: disc("SWIM", 1),
      BIKE: disc("BIKE", 1000),
      RUN: disc("RUN", 1000),
    },
  };

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap max-w-[680px]">
        <div className="rise" style={{ animationDelay: "0.05s" }}>
          <Link href={`/plans/${plan.id}`} className="backlink">
            ← Back to plan
          </Link>
          <h1 className="mk-h1 sm">
            Edit <em>plan.</em>
          </h1>
          <p className="lede mb-[26px]">Saving changes regenerates your weekly targets.</p>
        </div>
        <div className="rise" style={{ animationDelay: "0.15s" }}>
          <PlanForm planId={plan.id} initial={initial} />
        </div>
      </div>
    </div>
  );
}
