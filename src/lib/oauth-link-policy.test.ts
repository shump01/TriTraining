import { describe, expect, it } from "vitest";

import { isProviderEmailVerified, linkOutcome, normalizeEmail } from "./oauth-link-policy";

describe("isProviderEmailVerified", () => {
  it("accepts a boolean true and Apple's string form", () => {
    expect(isProviderEmailVerified({ email_verified: true })).toBe(true);
    expect(isProviderEmailVerified({ email_verified: "true" })).toBe(true);
  });

  it("refuses everything else, including a missing claim", () => {
    expect(isProviderEmailVerified({ email_verified: false })).toBe(false);
    expect(isProviderEmailVerified({ email_verified: "false" })).toBe(false);
    expect(isProviderEmailVerified({})).toBe(false);
    expect(isProviderEmailVerified(null)).toBe(false);
    expect(isProviderEmailVerified(undefined)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims, and has no address for blanks", () => {
    expect(normalizeEmail("  Rider@Example.COM ")).toBe("rider@example.com");
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("linkOutcome", () => {
  const unverified = { email: "owner@example.com", emailVerified: null };
  const verified = { email: "owner@example.com", emailVerified: new Date() };

  it("reclaims a never-verified row when the provider vouches for its address", () => {
    expect(linkOutcome(unverified, "owner@example.com")).toBe("reclaim");
    // Case is not a different address.
    expect(linkOutcome(unverified, "Owner@Example.com")).toBe("reclaim");
  });

  it("leaves a verified row alone", () => {
    expect(linkOutcome(verified, "owner@example.com")).toBe("keep");
  });

  it("treats another address as proving nothing — verified row or not", () => {
    // The signed-in cross-account link: a squatter's row, the squatter's Gmail.
    expect(linkOutcome(unverified, "attacker@gmail.com")).toBe("foreign");
    expect(linkOutcome(verified, "attacker@gmail.com")).toBe("foreign");
  });

  it("treats a missing provider address as foreign, never as a match", () => {
    expect(linkOutcome(unverified, null)).toBe("foreign");
    expect(linkOutcome(unverified, undefined)).toBe("foreign");
    expect(linkOutcome(unverified, "")).toBe("foreign");
  });
});
