import { describe, expect, it } from "vitest";

import { validityPhrase } from "@/lib/mailer";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

describe("validityPhrase", () => {
  it.each([
    [24, "for 24 hours"],
    [24 - 1 / 120, "for 24 hours"], // minted 30s ago
    [23.6, "for the next 23 hours"], // a resend 25 minutes after signing up
    [23, "for the next 23 hours"],
    [6 - 1 / 240, "for the next 5 hours"], // 5h59m45s: never round UP a deadline
    [1, "for the next hour"],
    [0.5, "for less than an hour"],
  ])("%s hours left -> %s", (hours, phrase) => {
    expect(validityPhrase(inHours(hours), NOW)).toBe(phrase);
  });
});
