import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mailboxKey, spendMailBudget } from "@/lib/mail-budget";
import { __resetRateLimiterForTests } from "@/lib/rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  __resetRateLimiterForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mailboxKey", () => {
  it.each([
    ["Victim@Example.com", "victim@example.com"],
    ["victim+1@example.com", "victim@example.com"],
    ["victim+a+b@example.com", "victim@example.com"],
    ["v.i.c.t.i.m@gmail.com", "victim@gmail.com"],
    ["V.ictim+promo@GoogleMail.com", "victim@gmail.com"],
    // Dots are only meaningless at Gmail; elsewhere they're a different box.
    ["first.last@example.com", "first.last@example.com"],
  ])("%s -> %s", (input, expected) => {
    expect(mailboxKey(input)).toBe(expected);
  });

  it("leaves a leading + alone rather than producing an empty local part", () => {
    expect(mailboxKey("+tag@example.com")).toBe("+tag@example.com");
  });
});

describe("spendMailBudget", () => {
  it("allows three sends per inbox per window, then answers 429", () => {
    expect(spendMailBudget("a@example.com")).toBeNull();
    expect(spendMailBudget("a@example.com")).toBeNull();
    expect(spendMailBudget("a@example.com")).toBeNull();

    const blocked = spendMailBudget("a@example.com");
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe("900");
  });

  it("charges every variant of one inbox to ONE budget", () => {
    // The bypass the canonical key exists to stop: each variant used to get a
    // fresh bucket while all the mail landed in the same inbox.
    expect(spendMailBudget("victim+1@gmail.com")).toBeNull();
    expect(spendMailBudget("v.ictim@gmail.com")).toBeNull();
    expect(spendMailBudget("VICTIM@googlemail.com")).toBeNull();
    expect(spendMailBudget("victim+2@gmail.com")?.status).toBe(429);
  });

  it("leaves other inboxes alone, and reopens after the window", () => {
    spendMailBudget("a@example.com");
    spendMailBudget("a@example.com");
    spendMailBudget("a@example.com");
    expect(spendMailBudget("b@example.com")).toBeNull();

    vi.advanceTimersByTime(15 * 60_000);
    expect(spendMailBudget("a@example.com")).toBeNull();
  });
});
