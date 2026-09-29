import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { authErrorMessage } from "./auth-error-message";
import { SIGNED_IN_ELSEWHERE_ERROR } from "./oauth-session-guard";

describe("authErrorMessage", () => {
  it("is silent without a code", () => {
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage("")).toBeNull();
  });

  it("translates the codes Auth.js sends to the sign-in page", () => {
    expect(authErrorMessage("AccessDenied")).toContain("cancelled");
    expect(authErrorMessage("Configuration")).toContain("isn't available");
    expect(authErrorMessage("OAuthAccountNotLinked")).toContain("signs in another way");
  });

  it("explains the refusal to link while signed in as someone else", () => {
    // The code callbacks.signIn redirects with must be one this module knows.
    expect(authErrorMessage(SIGNED_IN_ELSEWHERE_ERROR)).toContain(
      "Sign out from your Account page first",
    );
  });

  it("never echoes an unknown code", () => {
    const msg = authErrorMessage("SomethingNew");
    expect(msg).not.toContain("SomethingNew");
    expect(msg).toContain("Something went wrong");
  });
});
