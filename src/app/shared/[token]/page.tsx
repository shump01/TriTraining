import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildHeatmap } from "@/lib/heatmap";
import { buildPlanSeries, toPublicSeries } from "@/lib/plan-series";
import { computeReadiness } from "@/lib/readiness";
import { getPlanByShareToken } from "@/lib/training-plan";
import { planStartWeek } from "@/lib/weekly-targets";

import { SharedPlanView } from "./shared-plan-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared plan · TriTrainer",
  // A shared link is unlisted; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default async function SharedPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await getPlanByShareToken(token);
  if (!plan) notFound();

  const now = new Date();
  // This page is PUBLIC (unauthenticated share token), so build a sanitized
  // series with the special-category pause reason stripped before anything is
  // serialized to the client — see toPublicSeries.
  const series = toPublicSeries(buildPlanSeries(plan, now));

  return (
    <SharedPlanView
      planName={plan.name}
      eventDateMs={plan.eventDate.getTime()}
      startDateMs={planStartWeek(plan).getTime()}
      series={series}
      readiness={computeReadiness(series)}
      heatmap={buildHeatmap(series[0]?.weeks ?? [])}
    />
  );
}
