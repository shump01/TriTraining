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

const disciplineMetricsSchema = z.object({
  eventDistanceMeters: metersSchema,
  startingWeeklyMeters: metersSchema,
});

/**
 * Server-side schema for creating a plan. Note there is deliberately NO `userId`
 * field — the user is always derived from the session, never the request body.
 */
export const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  eventDate: eventDateSchema,
  disciplines: z.object({
    SWIM: disciplineMetricsSchema,
    BIKE: disciplineMetricsSchema,
    RUN: disciplineMetricsSchema,
  }),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/**
 * Server-side schema for recompute. Every field is optional: omitted values keep
 * the plan's current stored values, so an empty body simply regenerates targets.
 */
const recomputeDisciplineSchema = z.object({
  startingWeeklyMeters: metersSchema.optional(),
  eventDistanceMeters: metersSchema.optional(),
});

export const recomputePlanSchema = z.object({
  eventDate: eventDateSchema.optional(),
  disciplines: z
    .object({
      SWIM: recomputeDisciplineSchema.optional(),
      BIKE: recomputeDisciplineSchema.optional(),
      RUN: recomputeDisciplineSchema.optional(),
    })
    .optional(),
});

export type RecomputePlanInput = z.infer<typeof recomputePlanSchema>;
