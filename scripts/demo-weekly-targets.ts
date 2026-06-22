/**
 * Prints a week-by-week training-target table for a sample input.
 *
 * Run with:  npm run demo:targets
 */
import { BLOCK_WEEKS, CAP_MULTIPLE, computeWeeklyTargets } from "../src/lib/weekly-targets";

const input = {
  startDate: new Date("2026-01-05T00:00:00.000Z"), // a Monday
  eventDate: new Date("2026-06-21T00:00:00.000Z"), // race day
  startingWeeklyMeters: 20_000,
  eventDistanceMeters: 21_097, // half-marathon run leg
};

const targets = computeWeeklyTargets(input);
const cap = Math.floor(CAP_MULTIPLE * input.eventDistanceMeters);

console.log("Sample input:");
console.log(`  startDate            = ${input.startDate.toISOString().slice(0, 10)}`);
console.log(`  eventDate            = ${input.eventDate.toISOString().slice(0, 10)}`);
console.log(`  startingWeeklyMeters = ${input.startingWeeklyMeters.toLocaleString()}`);
console.log(`  eventDistanceMeters  = ${input.eventDistanceMeters.toLocaleString()}`);
console.log(`  hard cap (${CAP_MULTIPLE}x)      = ${cap.toLocaleString()}`);
console.log("");
console.log("Week | Start date | Target (m) | Δ% vs prev | Note");
console.log("-----+------------+------------+------------+--------");

targets.forEach((t, i) => {
  const prev = targets[i - 1];
  const delta = prev ? `${((t.targetMeters / prev.targetMeters - 1) * 100).toFixed(2)}%` : "—";
  const week = String(i + 1).padStart(4);
  const date = t.weekStartDate.toISOString().slice(0, 10);
  const target = t.targetMeters.toLocaleString().padStart(10);
  const note = i % BLOCK_WEEKS === BLOCK_WEEKS - 1 ? "de-load" : "";
  console.log(`${week} | ${date} | ${target} | ${delta.padStart(8)}   | ${note}`);
});

console.log("");
console.log(`Total weeks: ${targets.length}`);
