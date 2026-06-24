import { describe, expect, it } from "vitest";

import { redact } from "./logger";

describe("logger redaction", () => {
  it("masks sensitive keys at any depth, keeping safe ones", () => {
    const input = {
      email: "athlete@example.com",
      password: "hunter2",
      accessToken: "at_secret",
      refresh_token: "rt_secret",
      authorization: "Bearer xyz",
      cookie: "session=abc",
      nested: { sessionToken: "tok", clientSecret: "cs", safe: "keep-me" },
      list: [{ passwordHash: "h" }, { ok: 1 }],
      planName: "Ironman Nice 2026",
      weeksToGo: 12,
    };

    const out = redact(input) as Record<string, unknown>;
    const nested = out.nested as Record<string, unknown>;
    const list = out.list as Record<string, unknown>[];

    expect(out.email).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.accessToken).toBe("[redacted]");
    expect(out.refresh_token).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(nested.sessionToken).toBe("[redacted]");
    expect(nested.clientSecret).toBe("[redacted]");
    expect(nested.safe).toBe("keep-me");
    expect(list[0]!.passwordHash).toBe("[redacted]");
    expect(list[1]!.ok).toBe(1);
    // Non-sensitive values pass through untouched.
    expect(out.planName).toBe("Ironman Nice 2026");
    expect(out.weeksToGo).toBe(12);
  });

  it("serializes Errors to name/message/stack and drops extra props", () => {
    const err = Object.assign(new Error("boom"), { token: "leak-me" });
    const out = redact({ error: err }) as { error: Record<string, unknown> };
    expect(out.error.name).toBe("Error");
    expect(out.error.message).toBe("boom");
    expect(out.error.token).toBeUndefined();
  });

  it("does not mutate the input object", () => {
    const input = { password: "x", note: "y" };
    redact(input);
    expect(input.password).toBe("x");
    expect(input.note).toBe("y");
  });
});
