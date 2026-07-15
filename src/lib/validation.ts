import { z } from "zod";

/**
 * Password policy: minimum 12 characters plus complexity (lower, upper, number,
 * symbol). Capped at 128 to bound hashing work.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters long")
  .max(128, "Password must be at most 128 characters long")
  .refine((v) => /[a-z]/.test(v), "Password must include a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Password must include an uppercase letter")
  .refine((v) => /[0-9]/.test(v), "Password must include a number")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "Password must include a symbol");

export const signupSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Missing reset token"),
  password: passwordSchema, // reuse the same strength policy as sign-up
});

// ── Training plan creation ───────────────────────────────────────────────────

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// PostgreSQL INTEGER upper bound — keep values in range to avoid overflow.
const MAX_METERS = 2_000_000_000;

const metersSchema = z.coerce
  .number({ message: "Enter a number" })
  .int("Must be a whole number of meters")
  .positive("Must be greater than 0")
  .max(MAX_METERS, "Value is too large");

const eventDateSchema = z.coerce
  .date({ message: "Enter a valid date" })
  .refine((d) => d.getTime() > Date.now(), "Event date must be in the future")
  .refine(
    (d) => d.getTime() - Date.now() >= ONE_WEEK_MS,
    "Event date must be at least 1 week away",
  );

// The plan's start (week 1). May be in the past — a plan can be back-dated to
// when training actually began. Only constrained relative to the event date.
const startDateSchema = z.coerce.date({ message: "Enter a valid start date" });

// Hard cap on weekly volume, as a multiple of each discipline's event distance
// (see computeWeeklyTargets). Defaults to 1.5x when omitted.
const capMultipleSchema = z.coerce
  .number({ message: "Enter a number" })
  .min(1, "Must be at least 1×")
  .max(5, "Must be at most 5×")
  .default(1.5);

// Day every training week begins on: 0=Sunday..6=Saturday. Defaults to Monday.
const weekStartDaySchema = z.coerce
  .number({ message: "Enter a number" })
  .int()
  .min(0, "Invalid day")
  .max(6, "Invalid day")
  .default(1);

// Race-week taper length: the final N weeks ramp down into race day (see
// computeWeeklyTargets). 0 = no taper. Defaults to 2 when omitted.
const taperWeeksSchema = z.coerce
  .number({ message: "Enter a number" })
  .int("Must be a whole number of weeks")
  .min(0, "Must be 0 or more")
  .max(4, "Must be at most 4 weeks")
  .default(2);

// Season priority: A (goal race), B, or C (tune-up). Defaults to A when omitted.
const prioritySchema = z.enum(["A", "B", "C"]).default("A");

const disciplineMetricsSchema = z.object({
  eventDistanceMeters: metersSchema,
  startingWeeklyMeters: metersSchema,
});

/**
 * Server-side schema for creating a plan. Note there is deliberately NO `userId`
 * field — the user is always derived from the session, never the request body.
 */
export const createPlanSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
    eventDate: eventDateSchema,
    // Optional: defaults to the current week server-side when omitted.
    startDate: startDateSchema.optional(),
    // Optional: defaults to 1.5x when omitted.
    capMultiple: capMultipleSchema,
    // Optional: defaults to Monday (1) when omitted.
    weekStartDay: weekStartDaySchema,
    // Optional: defaults to 2 taper weeks when omitted.
    taperWeeks: taperWeeksSchema,
    // Optional: defaults to "A" when omitted.
    priority: prioritySchema,
    // Each sport is optional, but at least one must be included (e.g. a
    // run-only plan omits SWIM and BIKE).
    disciplines: z
      .object({
        SWIM: disciplineMetricsSchema.optional(),
        BIKE: disciplineMetricsSchema.optional(),
        RUN: disciplineMetricsSchema.optional(),
      })
      .refine((d) => Boolean(d.SWIM || d.BIKE || d.RUN), {
        message: "Select at least one sport",
      }),
  })
  .refine((v) => !v.startDate || v.startDate.getTime() < v.eventDate.getTime(), {
    path: ["startDate"],
    message: "Start date must be before the event date",
  });

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// Editing a plan uses the same shape as creating one (full replace), so the
// create schema is reused by PUT /api/plans/[id].

// ── Manual weekly actual entry ───────────────────────────────────────────────

/** A manually-entered actual for one (discipline, week). Distance is non-negative. */
export const actualEntrySchema = z.object({
  discipline: z.enum(["SWIM", "BIKE", "RUN"]),
  weekStartDate: z.coerce.date({ message: "Enter a valid date" }),
  actualMeters: z.coerce
    .number({ message: "Enter a number" })
    .int("Must be a whole number of meters")
    .nonnegative("Must be 0 or more")
    .max(MAX_METERS, "Value is too large"),
});

export type ActualEntryInput = z.infer<typeof actualEntrySchema>;

// ── Weekly wellness check-in ──────────────────────────────────────────────────

/** A subjective 1–5 rating (fatigue / sleep / soreness). */
const wellnessRating = z.coerce
  .number({ message: "Enter a number" })
  .int()
  .min(1, "Must be 1–5")
  .max(5, "Must be 1–5");

export const checkinSchema = z.object({
  weekStartDate: z.coerce.date({ message: "Enter a valid date" }),
  fatigue: wellnessRating,
  sleep: wellnessRating,
  soreness: wellnessRating,
  note: z.string().trim().max(500, "Note is too long").optional(),
});

export type CheckinInput = z.infer<typeof checkinSchema>;

/** Toggle a plan's public read-only share link. */
export const shareSchema = z.object({ enabled: z.boolean() });

// ── Apple Health ingest ──────────────────────────────────────────────────────

/**
 * One normalized workout from HealthKit, using Strava-compatible sportType
 * strings (Swim/Ride/Run) so the server reuses the sync-core mapping unchanged.
 * Unmapped types are accepted and ignored server-side (same policy as Strava).
 */
export const healthIngestSchema = z.object({
  workouts: z
    .array(
      z.object({
        sportType: z.string().max(64),
        distanceMeters: z.number().finite().nonnegative().max(MAX_METERS),
        startDateLocal: z.string().max(64),
      }),
    )
    .max(10_000, "Too many workouts in one batch"),
});

export type HealthIngestInput = z.infer<typeof healthIngestSchema>;

// ── Training groups ──────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
});

export const joinGroupSchema = z.object({
  token: z.string().min(1, "Missing invite token"),
});

export const removeMemberSchema = z.object({
  userId: z.string().min(1, "Missing user"),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
