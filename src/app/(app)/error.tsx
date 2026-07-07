"use client";

/**
 * Error boundary for the authenticated app segment. Renders inside the app
 * shell. Shows a generic message only — never the error message or stack — and
 * surfaces just the server-generated `digest` as a support reference.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-[440px] rounded-[18px] border border-border bg-card p-8 text-center">
        <div className="mb-2 font-display text-[22px] font-extrabold">Something went wrong</div>
        <p className="m-0 mb-6 text-[14px] leading-[1.5] text-muted">
          An unexpected error occurred. You can try again, or head back to your dashboard.
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14px] font-bold text-white hover:brightness-110"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="cursor-pointer rounded-[11px] border border-border px-[18px] py-[11px] text-[14px] font-bold text-text hover:border-brand"
          >
            Dashboard
          </a>
        </div>
        {error.digest && (
          <p className="mt-5 mb-0 font-mono text-[11px] text-faint">Reference: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
