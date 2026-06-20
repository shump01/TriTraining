import { describe, expect, it } from "vitest";

import { createOAuthState, verifyOAuthState } from "./oauth-state";

const USER = "user_abc123";

describe("strava OAuth state (signed + session-bound)", () => {
  it("verifies a freshly created state with its nonce and user", () => {
    const { state, nonce } = createOAuthState(USER);
    expect(verifyOAuthState(state, nonce, USER)).toBe(true);
  });

  it("rejects a state for a different session/user", () => {
    const { state, nonce } = createOAuthState(USER);
    expect(verifyOAuthState(state, nonce, "someone_else")).toBe(false);
  });

  it("rejects when the cookie nonce doesn't match", () => {
    const { state } = createOAuthState(USER);
    expect(verifyOAuthState(state, "wrong-nonce", USER)).toBe(false);
  });

  it("rejects a missing nonce or state", () => {
    const { state, nonce } = createOAuthState(USER);
    expect(verifyOAuthState(state, undefined, USER)).toBe(false);
    expect(verifyOAuthState(null, nonce, USER)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const { state, nonce } = createOAuthState(USER);
    const [payload] = state.split(".");
    const forged = `${payload}.bm90LWEtdmFsaWQtc2ln`; // bogus signature
    expect(verifyOAuthState(forged, nonce, USER)).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const { state, nonce } = createOAuthState(USER);
    const sig = state.split(".")[1]!;
    // Re-encode a payload whose contents differ from what `sig` actually signed.
    const forgedPayload = Buffer.from(`${USER}.tampered-${nonce}.${Date.now()}`).toString(
      "base64url",
    );
    expect(verifyOAuthState(`${forgedPayload}.${sig}`, nonce, USER)).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(verifyOAuthState("not-a-valid-state", "nonce", USER)).toBe(false);
    expect(verifyOAuthState("a.b.c", "nonce", USER)).toBe(false);
  });
});
