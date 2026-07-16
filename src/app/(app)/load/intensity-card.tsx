import { translucent } from "@/lib/ui/theme";
import {
  EASY_TARGET_PCT,
  INTENSITY_WINDOW_DAYS,
  ZONE_META,
  ZONES,
  type Band,
  type IntensityDistribution,
  type IntensityVerdict,
  type Zone,
} from "@/lib/zones";

// The three polarized bands read cool → hot, reusing the sport accents.
const BAND_COLOR: Record<Band, string> = {
  easy: "var(--swim)",
  grey: "var(--bike)",
  hard: "var(--run)",
};

// Within a band, the lighter zone is dimmed so Z1/Z2 and Z4/Z5 stay tellable apart.
const ZONE_ALPHA: Record<Zone, number> = { 1: 0.55, 2: 1, 3: 1, 4: 0.65, 5: 1 };

const VERDICT_COLOR: Record<IntensityVerdict, string> = {
  polarized: "var(--on-track)",
  balanced: "var(--upcoming)",
  greyZone: "var(--bike)",
  tooHard: "var(--behind)",
};

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * "At what intensity?" — time-in-zone over the last block, against the polarized
 * ~80/20 shape. Scored from each activity's average HR, so it's a read on where
 * efforts sat rather than true time-in-zone (see src/lib/zones.ts).
 */
export function IntensityCard({ intensity }: { intensity: IntensityDistribution }) {
  const { buckets, easyPct, greyPct, hardPct, verdict, totalSeconds, activityCount } = intensity;
  const verdictColor = VERDICT_COLOR[verdict.key];
  const maxPct = Math.max(...buckets.map((b) => b.pct), 1);

  return (
    <div className="mt-5 rounded-[18px] border border-border bg-card p-[22px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-display text-[16px] font-bold">Intensity distribution</h3>
        <span className="font-mono text-[11px] text-faint">
          last {INTENSITY_WINDOW_DAYS} days · {activityCount} session
          {activityCount === 1 ? "" : "s"} · {duration(totalSeconds)}
        </span>
      </div>

      {/* The headline: easy / grey / hard against the 80% easy reference. */}
      <div className="relative mb-2">
        <div className="flex h-3.5 overflow-hidden rounded-[6px] bg-card2">
          {(["easy", "grey", "hard"] as const).map((band) => {
            const pct = band === "easy" ? easyPct : band === "grey" ? greyPct : hardPct;
            return <div key={band} style={{ width: `${pct}%`, background: BAND_COLOR[band] }} />;
          })}
        </div>
        {/* Where the polarized model wants the easy band to end. */}
        <div
          className="absolute -top-1 -bottom-1 w-px bg-text opacity-70"
          style={{ left: `${EASY_TARGET_PCT}%` }}
          title={`${EASY_TARGET_PCT}% easy target`}
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-[3px] w-4 rounded-[2px]" style={{ background: BAND_COLOR.easy }} />
          Easy {easyPct}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-[3px] w-4 rounded-[2px]" style={{ background: BAND_COLOR.grey }} />
          Grey {greyPct}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-[3px] w-4 rounded-[2px]" style={{ background: BAND_COLOR.hard }} />
          Hard {hardPct}%
        </span>
        <span className="text-faint">
          | target ~{EASY_TARGET_PCT}/{100 - EASY_TARGET_PCT}
        </span>
      </div>

      {/* Per-zone breakdown. */}
      <div className="flex flex-col gap-1.5">
        {ZONES.map((zone) => {
          const b = buckets.find((x) => x.zone === zone)!;
          const meta = ZONE_META[zone];
          return (
            <div key={zone} className="flex items-center gap-3">
              <span className="w-[68px] shrink-0 font-mono text-[11.5px] text-muted">
                <b className="text-text">{meta.label}</b> {meta.blurb}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-[6px] bg-card2">
                <div
                  className="h-full rounded-[6px]"
                  style={{
                    width: `${(b.pct / maxPct) * 100}%`,
                    background: BAND_COLOR[meta.band],
                    opacity: ZONE_ALPHA[zone],
                  }}
                />
              </div>
              <span className="w-[34px] shrink-0 text-right font-mono text-[11.5px] text-muted">
                {b.pct}%
              </span>
              <span className="hidden w-[58px] shrink-0 text-right font-mono text-[11px] text-faint app:block">
                {duration(b.seconds)}
              </span>
            </div>
          );
        })}
      </div>

      <p
        className="mt-4 mb-0 rounded-[11px] border px-3.5 py-2.5 text-[13px] leading-[1.5]"
        style={{
          color: verdictColor,
          background: translucent(verdictColor, 10),
          borderColor: translucent(verdictColor, 24),
        }}
      >
        <b>{verdict.label}.</b> <span className="text-muted">{verdict.detail}</span>
      </p>

      <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-faint">
        Each session is scored by its <b className="text-muted">average</b> heart rate — Strava
        doesn&apos;t give us the full HR trace. Steady sessions score honestly, but intervals
        average out into Z3, so hard days can show up as grey. Read this as where your efforts sat,
        not as exact time-in-zone.
      </p>
    </div>
  );
}
