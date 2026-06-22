/**
 * Split-screen auth layout: brand panel on the left, form slot on the right.
 * Used by both /login and /signup.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-bg2 p-12 lg:flex">
        <div
          className="pointer-events-none absolute -top-[120px] -right-[160px] h-[520px] w-[520px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--brand) 26%, transparent), transparent 68%)",
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-[120px] -left-[140px] h-[420px] w-[420px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(21,184,230,.20), transparent 68%)" }}
        />

        <div className="relative flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-brand font-display text-xl font-black text-white">
            T
          </div>
          <span className="font-display text-[21px] font-extrabold tracking-[-0.02em]">
            TriTrainer
          </span>
        </div>

        <div className="relative">
          <div className="mb-[22px] flex gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
            <span className="text-swim">Swim</span>
            <span className="text-faint">·</span>
            <span className="text-bike">Bike</span>
            <span className="text-faint">·</span>
            <span className="text-run">Run</span>
          </div>
          <h1 className="m-0 mb-4 font-display text-[52px] leading-[0.98] font-black tracking-[-0.03em]">
            Every meter,
            <br />
            on target.
          </h1>
          <p className="m-0 max-w-[380px] text-[17px] leading-[1.5] text-muted">
            Plan your build, sync from Strava, and see exactly where you stand — week by week, sport
            by sport.
          </p>
        </div>

        <div className="relative font-mono text-[12px] text-faint">© 2026 TriTrainer</div>
      </div>

      {/* Form side */}
      <div className="flex items-center justify-center p-10">
        <div className="w-full max-w-[360px]">{children}</div>
      </div>
    </div>
  );
}
