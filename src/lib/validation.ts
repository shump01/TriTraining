import { z } from "zod";

import { MAX_PLAN_WEEKS, startOfWeek } from "@/lib/weekly-targets";

/**
 * How far any client-supplied date may sit from today, in either direction
 * (~5 years).
 *
 * This is a RESOURCE bound, not just a sanity one: a plan's week count is
 * (eventDate − startDate) / 1 week, and every week becomes rows in memory and
 * in the database. `z.coerce.date()` happily accepts a raw JSON number as
 * epoch-ms, so without this an unbounded date turns one small POST into
 * millions of weeks — gigabytes of allocation and an OOM'd worker, or a
 * quieter variant that commits tens of thousands of target rows that every
 * later read then has to load. It also keeps extreme-but-parseable dates from
 * becoming Invalid Date after week alignment and 500ing inside Prisma.
 * Bounded here so a violation is a clean 400; computeWeeklyTargets enforces
 * its own MAX_PLAN_WEEKS as defence in depth.
 */
const MAX_PLAN_DATE_SPAN_MS = 5 * 365 * 24 * 60 * 60 * 1000;

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

// ── Account self-service ─────────────────────────────────────────────────────

/**
 * Update account preferences — each field optional, at least one required.
 * An empty name clears it (email-derived fallback everywhere).
 */
export const updateAccountSchema = z
  .object({
    name: z.string().trim().max(40, "Keep the name under 40 characters").optional(),
    digestEnabled: z.boolean().optional(),
    // Plan-view display density: SIMPLE = current week only, DETAILED = the
    // full week list. Opt-in preference, stored on the user so it follows
    // across web and mobile.
    viewMode: z.enum(["SIMPLE", "DETAILED"]).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.digestEnabled !== undefined || v.viewMode !== undefined,
    {
      message: "Nothing to update",
    },
  );

/**
 * A week identifier from a client. Bounded like the plan dates: an extreme but
 * technically-parseable value (e.g. year 300000) survives `z.coerce.date()`,
 * then becomes an Invalid Date once the server aligns it to a week start —
 * slipping past range checks and 500ing inside Prisma. Bounded here, it's a
 * clean 400 instead.
 */
const weekDateSchema = z.coerce
  .date({ message: "Enter a valid date" })
  // ±50 years: an ABSURD-VALUE guard only, not a business rule. It was ±5
  // years once, which quietly outlawed edits the UI still offers: a plan
  // back-dated near the 5-year creation limit has early weeks that AGE OUT of
  // a now-relative window, making a stale manual actual on such a week
  // uneditable and undeletable. The real range rule is per-plan: the actuals
  // and planner handlers reject weeks outside the plan's own window
  // (WeekOutOfRangeError in training-plan.ts). Checkin/pause upserts have no
  // such check — an out-of-window row there is junk, but harmless junk: every
  // reader matches those rows by exact week against the plan's own week list,
  // so it can never influence readiness, re-ramps, digests, or rendering.
  .refine(
    (d) => Math.abs(d.getTime() - Date.now()) <= 10 * MAX_PLAN_DATE_SPAN_MS,
    "That week is outside the supported range",
  );

/** Replace one week of planned sessions — the week planner's single write. */
export const plannerWeekSchema = z.object({
  weekStartDate: weekDateSchema,
  sessions: z
    .array(
      z.object({
        discipline: z.enum(["SWIM", "BIKE", "RUN"]),
        slot: z.number().int().min(0).max(9),
        label: z.string().trim().min(1).max(40),
        share: z.number().positive().max(1),
        dayOffset: z.number().int().min(0).max(6),
        done: z.boolean(),
      }),
    )
    .max(24, "Too many sessions for one week"),
});

/** Change password while signed in — current password required, same policy as sign-up. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: passwordSchema,
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
  .refine((d) => d.getTime() - Date.now() >= ONE_WEEK_MS, "Event date must be at least 1 week away")
  .refine(
    (d) => d.getTime() - Date.now() <= MAX_PLAN_DATE_SPAN_MS,
    "Event date must be within the next 5 years",
  );

// The plan's start (week 1). May be in the past — a plan can be back-dated to
// when training actually began — but only within the bounded window above.
const startDateSchema = z.coerce
  .date({ message: "Enter a valid start date" })
  .refine(
    (d) => Date.now() - d.getTime() <= MAX_PLAN_DATE_SPAN_MS,
    "Start date must be within the last 5 years",
  )
  .refine(
    (d) => d.getTime() - Date.now() <= MAX_PLAN_DATE_SPAN_MS,
    "Start date must be within the next 5 years",
  );

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
  })
  // The per-field bounds above allow a start 5 years back AND an event 5 years
  // out, so the combined span can exceed what the progression engine accepts
  // (MAX_PLAN_WEEKS throws) — this is the cross-field check that turns that
  // into a clean 400 instead of a 500. Counted the way the engine counts:
  // whole weeks from the aligned week-1 start to the event's week, inclusive.
  .refine(
    (v) => {
      if (!v.startDate) return true; // defaults to the current week — bounded
      const aligned = startOfWeek(v.startDate, v.weekStartDay);
      const eventMs = Date.UTC(
        v.eventDate.getUTCFullYear(),
        v.eventDate.getUTCMonth(),
        v.eventDate.getUTCDate(),
      );
      const weeks = Math.floor((eventMs - aligned.getTime()) / ONE_WEEK_MS) + 1;
      return weeks <= MAX_PLAN_WEEKS;
    },
    {
      path: ["eventDate"],
      message: `A plan can span at most ${MAX_PLAN_WEEKS} weeks — bring the start and event dates closer together`,
    },
  );

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// Editing a plan uses the same shape as creating one (full replace), so the
// create schema is reused by PUT /api/plans/[id].

// ── Manual weekly actual entry ───────────────────────────────────────────────

/** A manually-entered actual for one (discipline, week). Distance is non-negative. */
export const actualEntrySchema = z.object({
  discipline: z.enum(["SWIM", "BIKE", "RUN"]),
  weekStartDate: weekDateSchema,
  actualMeters: z.coerce
    .number({ message: "Enter a number" })
    .int("Must be a whole number of meters")
    .nonnegative("Must be 0 or more")
    .max(MAX_METERS, "Value is too large"),
});

export type ActualEntryInput = z.infer<typeof actualEntrySchema>;

/** DELETE /api/plans/:id/actuals — clear a manual entry for one (discipline, week). */
export const actualDeleteSchema = z.object({
  discipline: z.enum(["SWIM", "BIKE", "RUN"]),
  weekStartDate: weekDateSchema,
});

export type ActualDeleteInput = z.infer<typeof actualDeleteSchema>;

// ── Weekly wellness check-in ──────────────────────────────────────────────────

/** A subjective 1–5 rating (fatigue / sleep / soreness). */
const wellnessRating = z.coerce
  .number({ message: "Enter a number" })
  .int()
  .min(1, "Must be 1–5")
  .max(5, "Must be 1–5");

export const checkinSchema = z.object({
  weekStartDate: weekDateSchema,
  fatigue: wellnessRating,
  sleep: wellnessRating,
  soreness: wellnessRating,
  note: z.string().trim().max(500, "Note is too long").optional(),
});

export type CheckinInput = z.infer<typeof checkinSchema>;

// ── Weekly pause (time off: ill / injured / away) ────────────────────────────

/** Mark a week as time off. Mirrors the PauseReason enum in the schema. */
export const pauseSchema = z.object({
  weekStartDate: weekDateSchema,
  reason: z.enum(["ILLNESS", "INJURY", "TRAVEL", "OTHER"], { message: "Pick a reason" }),
  note: z.string().trim().max(500, "Note is too long").optional(),
});

export type PauseInput = z.infer<typeof pauseSchema>;

/** Un-pause a week. */
export const clearPauseSchema = z.object({
  weekStartDate: weekDateSchema,
});

/** Toggle a plan's public read-only share link. */
export const shareSchema = z.object({ enabled: z.boolean() });

/** Set the athlete's lactate-threshold heart rate (bpm) for training load. */
export const thresholdHrSchema = z.object({
  thresholdHr: z.coerce
    .number({ message: "Enter a number" })
    .int()
    .min(100, "Must be between 100 and 220 bpm")
    .max(220, "Must be between 100 and 220 bpm"),
});

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
        // Optional training-load fields (older app builds omit them; the
        // workout still counts toward weekly actuals without them). A workout
        // carrying ALL THREE also produces an ActivityLoad row (hrTSS →
        // Fitness/Fatigue/Form), mirroring what Strava sync stores.
        /** HealthKit workout UUID — the per-source idempotency key. */
        externalId: z.string().min(1).max(64).optional(),
        /** Duration in seconds. Bounded to a sane 48h. */
        movingSeconds: z.number().int().positive().max(172_800).optional(),
        /** Average heart rate over the workout (bpm). */
        avgHr: z.number().int().positive().max(300).optional(),
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

/** POST /api/auth/oauth: the mobile app trading a provider ID token for a session. */
export const oauthSignInSchema = z.object({
  provider: z.enum(["apple", "google"]),
  // Provider ID tokens are about 1 KB; the cap only bounds abuse.
  idToken: z.string().min(1).max(8192),
  // Apple hands the app the person's name once, on first authorization.
  name: z.string().trim().max(40, "Keep the name under 40 characters").optional(),
});

export type OAuthSignInInput = z.infer<typeof oauthSignInSchema>;
