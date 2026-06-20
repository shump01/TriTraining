"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

const DISCIPLINES = ["SWIM", "BIKE", "RUN"] as const;
type DisciplineKey = (typeof DISCIPLINES)[number];
type MetricKey = "eventDistanceMeters" | "startingWeeklyMeters";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Sensible placeholders (full-distance triathlon, in meters).
const PLACEHOLDERS: Record<
  DisciplineKey,
  { eventDistanceMeters: string; startingWeeklyMeters: string }
> = {
  SWIM: { eventDistanceMeters: "3800", startingWeeklyMeters: "2000" },
  BIKE: { eventDistanceMeters: "180000", startingWeeklyMeters: "40000" },
  RUN: { eventDistanceMeters: "42195", startingWeeklyMeters: "15000" },
};

type Metrics = Record<DisciplineKey, Record<MetricKey, string>>;

const emptyMetrics: Metrics = {
  SWIM: { eventDistanceMeters: "", startingWeeklyMeters: "" },
  BIKE: { eventDistanceMeters: "", startingWeeklyMeters: "" },
  RUN: { eventDistanceMeters: "", startingWeeklyMeters: "" },
};

/** Minimum allowed event date (today + 7 days) for the date input's `min`. */
function minEventDate(): string {
  return new Date(Date.now() + ONE_WEEK_MS).toISOString().slice(0, 10);
}

export function NewPlanForm() {
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setMetric(discipline: DisciplineKey, field: MetricKey, value: string) {
    setMetrics((prev) => ({
      ...prev,
      [discipline]: { ...prev[discipline], [field]: value },
    }));
  }

  // Client-side validation mirrors the server rules for fast feedback. The
  // server remains the source of truth (see /api/plans).
  function validate(): Record<string, string> {
    const next: Record<string, string> = {};

    if (!name.trim()) next.name = "Name is required";

    if (!eventDate) {
      next.eventDate = "Event date is required";
    } else {
      const date = new Date(eventDate);
      if (Number.isNaN(date.getTime())) next.eventDate = "Enter a valid date";
      else if (date.getTime() <= Date.now()) next.eventDate = "Event date must be in the future";
      else if (date.getTime() - Date.now() < ONE_WEEK_MS)
        next.eventDate = "Event date must be at least 1 week away";
    }

    for (const discipline of DISCIPLINES) {
      for (const field of ["eventDistanceMeters", "startingWeeklyMeters"] as const) {
        const raw = metrics[discipline][field];
        const key = `disciplines.${discipline}.${field}`;
        if (raw.trim() === "") {
          next[key] = "Required";
          continue;
        }
        const value = Number(raw);
        if (!Number.isInteger(value)) next[key] = "Must be a whole number";
        else if (value <= 0) next[key] = "Must be greater than 0";
      }
    }

    return next;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          eventDate,
          disciplines: {
            SWIM: numericMetrics(metrics.SWIM),
            BIKE: numericMetrics(metrics.BIKE),
            RUN: numericMetrics(metrics.RUN),
          },
        }),
      });

      if (res.status === 201) {
        const data = (await res.json()) as { plan: { id: string } };
        window.location.href = `/plans/${data.plan.id}`;
        return;
      }

      if (res.status === 401) {
        window.location.href = "/login?callbackUrl=/plans/new";
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: { path: string; message: string }[];
      };
      if (data.issues) {
        const serverErrors: Record<string, string> = {};
        for (const issue of data.issues) serverErrors[issue.path] = issue.message;
        setErrors(serverErrors);
      }
      setFormError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={formStyle}>
      <Field label="Plan name" error={errors.name}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ironman 2026"
          style={inputStyle}
        />
      </Field>

      <Field label="Event date" error={errors.eventDate}>
        <input
          type="date"
          value={eventDate}
          min={minEventDate()}
          onChange={(e) => setEventDate(e.target.value)}
          style={inputStyle}
        />
      </Field>

      {DISCIPLINES.map((discipline) => (
        <fieldset key={discipline} style={fieldsetStyle}>
          <legend style={{ fontWeight: 600 }}>{discipline}</legend>
          <Field
            label="Event distance (meters)"
            error={errors[`disciplines.${discipline}.eventDistanceMeters`]}
          >
            <input
              type="number"
              min={1}
              step={1}
              value={metrics[discipline].eventDistanceMeters}
              placeholder={PLACEHOLDERS[discipline].eventDistanceMeters}
              onChange={(e) => setMetric(discipline, "eventDistanceMeters", e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field
            label="Starting weekly volume (meters)"
            error={errors[`disciplines.${discipline}.startingWeeklyMeters`]}
          >
            <input
              type="number"
              min={1}
              step={1}
              value={metrics[discipline].startingWeeklyMeters}
              placeholder={PLACEHOLDERS[discipline].startingWeeklyMeters}
              onChange={(e) => setMetric(discipline, "startingWeeklyMeters", e.target.value)}
              style={inputStyle}
            />
          </Field>
        </fieldset>
      ))}

      {formError && (
        <p role="alert" style={errorStyle}>
          {formError}
        </p>
      )}

      <button type="submit" disabled={submitting} style={submitStyle}>
        {submitting ? "Creating…" : "Create plan"}
      </button>
    </form>
  );
}

function numericMetrics(m: Record<MetricKey, string>) {
  return {
    eventDistanceMeters: Number(m.eventDistanceMeters),
    startingWeeklyMeters: Number(m.startingWeeklyMeters),
  };
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {children}
      {error && <span style={fieldErrorStyle}>{error}</span>}
    </label>
  );
}

const formStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "1rem" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem" };
const inputStyle: CSSProperties = { padding: "0.5rem", fontSize: "1rem" };
const fieldsetStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: "0.75rem 1rem",
};
const submitStyle: CSSProperties = {
  padding: "0.6rem 1rem",
  fontSize: "1rem",
  cursor: "pointer",
  alignSelf: "flex-start",
};
const errorStyle: CSSProperties = { color: "#b00020", margin: 0 };
const fieldErrorStyle: CSSProperties = { color: "#b00020", fontSize: "0.8rem" };
