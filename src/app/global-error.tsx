"use client";

/**
 * Root error boundary — the last line of defense, catching failures in the root
 * layout itself (and anything without a closer boundary). It must render its
 * own <html>/<body>, and uses inline styles so it works even if the normal
 * stylesheet failed to load. Shows a generic message + safe digest only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0c10",
          color: "#f2f4f8",
        }}
      >
        <div style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>Something went wrong</h2>
          <p style={{ margin: "0 0 24px", color: "#9aa3b2", lineHeight: 1.5 }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 11,
              background: "#5b6cff",
              color: "#fff",
              padding: "11px 18px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 20, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
