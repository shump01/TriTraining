import Link from "next/link";

import type { ForecastVerdictKey } from "@/lib/forecast";
import { getRaceForecast } from "@/lib/forecast-data";
import { getTrainingLoad } from "@/lib/load-data";
import type { FormStatus } from "@/lib/training-load";
import { translucent } from "@/lib/ui/theme";

import { ForecastChart } from "./forecast-chart";
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

const VERDICT_COLOR: Record<ForecastVerdictKey, string> = {
  primed: "var(--on-track)",
  sharp: "var(--ahead)",
  // Both "over-tapered" and "carrying fatigue" are act-on-this warnings, not
  // neutral states — amber, with red reserved for the fatigued end.
  detrained: "var(--warn)",
  carrying: "var(--warn)",
  fatigued: "var(--behind)",
};

/** How much recent real history the forecast chart shows before "today". */
const FORECAST_PAST_DAYS = 28;

/** "swim", "bike and run", "swim, bike and run". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

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
  const [load, forecast] = await Promise.all([getTrainingLoad(), getRaceForecast()]);

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

              {forecast &&
                (() => {
                  const chartPast = load.series.slice(-FORECAST_PAST_DAYS);
                  // Mirrors ForecastChart's own render guard, so the footnote
                  // can never describe dashed lines that aren't there.
                  const chartable =
                    chartPast.length >= 1 &&
                    forecast.projection.length >= 1 &&
                    chartPast.length + forecast.projection.length >= 3;
                  return (
                    <div className="mt-5 rounded-[18px] border border-border bg-card p-[22px]">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="m-0 font-display text-[16px] font-bold">
                          Race forecast — {forecast.planName}
                        </h3>
                        <div className="flex flex-wrap items-center gap-3.5">
                          {chartable && (
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
                                  style={{ background: "var(--bike)" }}
                                />
                                Form
                              </span>
                            </div>
                          )}
                          <span
                            className="rounded-[20px] px-[11px] py-1 text-[12.5px] font-bold"
                            style={{
                              color: VERDICT_COLOR[forecast.verdict.key],
                              background: translucent(VERDICT_COLOR[forecast.verdict.key], 15),
                            }}
                          >
                            {forecast.verdict.label}
                          </span>
                        </div>
                      </div>
                      <p className="mt-0 mb-4 text-[13.5px] leading-[1.55] text-muted">
                        If the remaining plan is executed:{" "}
                        <b className="text-text">
                          Form {forecast.raceDay.form > 0 ? "+" : ""}
                          {forecast.raceDay.form}
                        </b>{" "}
                        and <b className="text-text">Fitness {forecast.raceDay.fitness}</b> on race
                        morning, {forecast.daysToRace} day{forecast.daysToRace === 1 ? "" : "s"} out
                        (peak Fitness along the way: {forecast.peakFitness}).{" "}
                        {forecast.verdict.detail}
                      </p>
                      {chartable && (
                        <ForecastChart past={chartPast} projection={forecast.projection} />
                      )}
                      <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-faint">
                        Assumes each remaining week&apos;s targets are completed, spread evenly
                        across the week
                        {forecast.calibrated.length > 0 && (
                          <>
                            {" "}
                            — effort calibrated from your recent {listJoin(
                              forecast.calibrated,
                            )}{" "}
                            training
                          </>
                        )}
                        {forecast.assumed.length > 0 && (
                          <>
                            {forecast.calibrated.length > 0 ? "; " : " — "}standard effort assumed
                            for {listJoin(forecast.assumed)}
                          </>
                        )}
                        .{chartable && <> Dashed lines are projected.</>}
                      </p>
                    </div>
                  );
                })()}

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
