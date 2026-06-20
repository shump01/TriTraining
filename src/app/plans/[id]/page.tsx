import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { getTrainingPlan } from "@/lib/training-plan";
import { CAP_MULTIPLE } from "@/lib/weekly-targets";

import { DisciplineChart, type ChartPoint } from "./discipline-chart";
import { RecomputeForm } from "./recompute-form";

export const dynamic = "force-dynamic";

const DISCIPLINE_ORDER = ["SWIM", "BIKE", "RUN"] as const;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;

  // Scoped to the session user — another user's id returns null → 404.
  const plan = await getTrainingPlan(id);
  if (!plan) {
    notFound();
  }

  const disciplines = [...plan.disciplines].sort(
    (a, b) => DISCIPLINE_ORDER.indexOf(a.discipline) - DISCIPLINE_ORDER.indexOf(b.discipline),
  );

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 820 }}>
      <p>
        <Link href="/plans">← All plans</Link>
      </p>
      <h1>{plan.name}</h1>
      <p>
        Event date: <strong>{isoDate(plan.eventDate)}</strong>
      </p>

      <RecomputeForm
        planId={plan.id}
        eventDate={isoDate(plan.eventDate)}
        disciplines={disciplines.map((d) => ({
          discipline: d.discipline,
          startingWeeklyMeters: d.startingWeeklyMeters,
        }))}
      />

      {disciplines.map((d) => {
        const targets = plan.weeklyTargets.filter((t) => t.discipline === d.discipline);
        const cap = Math.floor(CAP_MULTIPLE * d.eventDistanceMeters);
        const chartData: ChartPoint[] = targets.map((t) => ({
          week: isoDate(t.weekStartDate),
          target: t.targetMeters,
        }));

        return (
          <section key={d.id} style={{ marginTop: "2.5rem" }}>
            <h2>{d.discipline}</h2>
            <p style={{ color: "#555", margin: "0 0 0.75rem" }}>
              Event distance: <strong>{d.eventDistanceMeters.toLocaleString()} m</strong> · Starting
              weekly: <strong>{d.startingWeeklyMeters.toLocaleString()} m</strong> · 3.5× cap:{" "}
              <strong>{cap.toLocaleString()} m</strong>
            </p>

            <DisciplineChart data={chartData} cap={cap} startingVolume={d.startingWeeklyMeters} />

            <table style={{ borderCollapse: "collapse", marginTop: "0.75rem", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cell}>Week</th>
                  <th style={cell}>Week starting (Mon)</th>
                  <th style={cell}>Target (m)</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t, i) => (
                  <tr key={t.id}>
                    <td style={cell}>{i + 1}</td>
                    <td style={cell}>{isoDate(t.weekStartDate)}</td>
                    <td style={cell}>{t.targetMeters.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}

const cell: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.35rem 0.75rem",
  textAlign: "left",
};
