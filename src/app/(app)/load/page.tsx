import Link from "next/link";

import { getTrainingLoad } from "@/lib/load-data";
import type { FormStatus } from "@/lib/training-load";
import { translucent } from "@/lib/ui/theme";

import { IntensityCard } from "./intensity-card";
import { LoadChart } from "./load-chart";
import { ThresholdForm } from "./threshold-form";

import "../surface.css";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<FormStatus, string> = {
  fresh: "var(--on-track)",
  neutral: "var(--upcoming)",
  productive: "var(--ahead)",
  overreaching: "var(--behind)",
};

function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: number;
  hint: string;
  color: string;
}) {
  return (
    <div className="rounded-[16px] border border-border bg-card p-5">
      <div className="mb-1.5 text-[12px] font-bold tracking-[0.05em] uppercase" style={{ color }}>
        {label}
      </div>
      <div className="font-display text-[34px] leading-none font-black">{value}</div>
      <div className="mt-1.5 text-[12.5px] text-muted">{hint}</div>
    </div>
  );
}

export default async function LoadPage() {
  const load = await getTrainingLoad();

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap max-w-[1000px]">
        <div className="rise" style={{ animationDelay: "0.05s" }}>
          <h1 className="mk-h1 sm">
            Training <em>load.</em>
          </h1>
          <p className="lede mb-6 max-w-[62ch]">
            Heart-rate training load from your synced activities —{" "}
            <b className="text-text">Fitness</b> (42-day load), <b className="text-text">Fatigue</b>{" "}
            (7-day load), and <b className="text-text">Form</b> (Fitness − Fatigue). Set your
            threshold heart rate and it scores every HR-recorded session, from Strava or the
            TriTrainer app&apos;s Apple Health sync.
          </p>
        </div>

        <div className="rise" style={{ animationDelay: "0.15s" }}>
          {!load.thresholdHr ? (
            <div className="rounded-[18px] border border-border bg-card p-6">
              <h2 className="m-0 mb-1.5 font-display text-[18px] font-extrabold">
                Set your threshold heart rate
              </h2>
              <p className="mt-0 mb-5 max-w-[58ch] text-[14px] leading-[1.55] text-muted">
                Your lactate-threshold HR (LTHR) is roughly the average heart rate you can hold for
                a hard ~1-hour effort. It anchors the load score — an hour at threshold is 100
                points. Nothing computes until it&apos;s set.
              </p>
              <ThresholdForm initial={null} cta="Save & compute" />
            </div>
          ) : !load.summary ? (
            <div className="rounded-[18px] border border-border bg-card p-6">
              <h2 className="m-0 mb-1.5 font-display text-[18px] font-extrabold">
                No heart-rate activities yet
              </h2>
              <p className="mt-0 mb-5 max-w-[58ch] text-[14px] leading-[1.55] text-muted">
                Your threshold is set to <b className="text-text">{load.thresholdHr} bpm</b>, but
                there are no HR-recorded activities to score yet. Load is built from{" "}
                <Link href="/dashboard" className="font-semibold text-brand">
                  Strava
                </Link>{" "}
                activities that captured heart rate — or from Apple Health via the TriTrainer app —
                sync once you have some, and this chart fills in.
              </p>
              <ThresholdForm initial={load.thresholdHr} cta="Update" />
            </div>
          ) : (
            <>
              <div className="mb-5 rounded-[16px] border border-border bg-card2 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-[20px] px-[11px] py-1 text-[12.5px] font-bold"
                    style={{
                      color: STATUS_COLOR[load.summary.status.key],
                      background: translucent(STATUS_COLOR[load.summary.status.key], 15),
                    }}
                  >
                    {load.summary.status.label}
                  </span>
                  <span className="text-[13.5px] text-muted">
                    {load.summary.weekLoad} load in the last 7 days
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3.5">
                <Stat
                  label="Fitness"
                  value={load.summary.fitness}
                  hint="42-day training load (CTL)"
                  color="var(--on-track)"
                />
                <Stat
                  label="Fatigue"
                  value={load.summary.fatigue}
                  hint="7-day training load (ATL)"
                  color="var(--behind)"
                />
                <Stat
                  label="Form"
                  value={load.summary.form}
                  hint="Fitness − Fatigue (TSB)"
                  color="var(--bike)"
                />
              </div>

              <div className="mt-5 rounded-[18px] border border-border bg-card p-[22px]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 font-display text-[16px] font-bold">
                    Fitness, fatigue & form
                  </h3>
                  <div className="flex flex-wrap gap-3.5 font-mono text-[11px] text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <i
                        className="h-[3px] w-4 rounded-[2px]"
                        style={{ background: "var(--on-track)" }}
                      />
                      Fitness
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <i
                        className="h-[3px] w-4 rounded-[2px]"
                        style={{ background: "var(--behind)" }}
                      />
                      Fatigue
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <i
                        className="h-[3px] w-4 rounded-[2px]"
                        style={{ background: "var(--bike)" }}
                      />
                      Form
                    </span>
                  </div>
                </div>
                <LoadChart series={load.summary ? load.series : []} />
              </div>

              {load.intensity && <IntensityCard intensity={load.intensity} />}

              <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-[16px] border border-border bg-card p-5">
                <ThresholdForm initial={load.thresholdHr} cta="Update" />
                <p className="m-0 max-w-[42ch] text-[12.5px] leading-[1.5] text-faint">
                  hrTSS from average heart rate: an hour at threshold = 100. Only activities that
                  recorded HR are scored
                  {load.loadSource === "STRAVA"
                    ? " — from Strava"
                    : load.loadSource === "GARMIN"
                      ? " — from Garmin"
                      : " — from Apple Health"}
                  .
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
