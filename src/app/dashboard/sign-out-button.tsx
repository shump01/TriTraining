"use client";

import { useState } from "react";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      // Same-origin fetch — the browser sets Sec-Fetch-Site: same-origin, which
      // passes the endpoint's CSRF check.
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={signOut} disabled={loading} style={buttonStyle}>
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "1rem",
  cursor: "pointer",
};
