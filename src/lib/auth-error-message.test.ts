import { describe, expect, it } from "vitest";

import { authErrorMessage } from "./auth-error-message";

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

  it("never echoes an unknown code", () => {
    const msg = authErrorMessage("SomethingNew");
    expect(msg).not.toContain("SomethingNew");
    expect(msg).toContain("Something went wrong");
  });
});
