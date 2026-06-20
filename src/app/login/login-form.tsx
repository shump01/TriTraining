"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        window.location.href = callbackUrl || "/dashboard";
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={formStyle}>
      <label style={labelStyle}>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={inputStyle}
        />
      </label>
      {error && (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}
      <button type="submit" disabled={loading} style={submitStyle}>
        {loading ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

const formStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.75rem" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem" };
const inputStyle: CSSProperties = { padding: "0.5rem", fontSize: "1rem" };
const submitStyle: CSSProperties = { padding: "0.5rem 1rem", fontSize: "1rem", cursor: "pointer" };
const errorStyle: CSSProperties = { color: "#b00020", margin: 0 };
