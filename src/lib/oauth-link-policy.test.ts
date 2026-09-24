import { describe, expect, it } from "vitest";

import { isProviderEmailVerified, linkRevokesPassword } from "./oauth-link-policy";

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

describe("linkRevokesPassword", () => {
  it("revokes a password nobody ever proved the email for", () => {
    expect(linkRevokesPassword({ passwordHash: "argon2…", emailVerified: null })).toBe(true);
  });

  it("keeps a verified account's password, and has nothing to revoke without one", () => {
    expect(linkRevokesPassword({ passwordHash: "argon2…", emailVerified: new Date() })).toBe(false);
    expect(linkRevokesPassword({ passwordHash: null, emailVerified: null })).toBe(false);
  });
});
