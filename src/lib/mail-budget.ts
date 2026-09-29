import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/rate-limit";

/**
 * One budget per RECIPIENT, shared by every flow that emails an address on an
 * anonymous request: sign-up, resend-confirmation and forgot-password.
 *
 * Per-IP limits don't stop email bombing — an attacker spreads requests across
 * addresses they control. And separate per-flow buckets would multiply the
 * allowance: three sign-ups, plus three resends, plus three resets, every
 * quarter hour, into one victim's inbox. One shared bucket caps the total.
 *
 * It is consumed on EVERY such request, whether or not mail is actually sent,
 * so the 429 is the same for an address with an account, one mid-sign-up and
 * one we have never seen — it can't be used to tell them apart.
 *
 * In-memory and per process, like every limiter here (src/lib/rate-limit.ts):
 * under several Passenger workers an attacker gets a multiple of this. That
 * bounds the damage rather than eliminating it; a durable, cross-process
 * counter is the upgrade if abuse ever shows up.
 */
const MAIL_PER_WINDOW = 3;
const MAIL_WINDOW_MS = 15 * 60_000;

/**
 * The INBOX an address delivers to, for the budget key only — never for
 * storage or sending. Keyed on the literal address, the budget is trivially
 * sidestepped: victim+1@gmail.com, victim+2@gmail.com and v.ictim@gmail.com
 * are all valid, distinct addresses that land in one inbox, each with a fresh
 * bucket. So: drop any +tag (widely honoured, and harmless to over-apply to a
 * provider that doesn't), and for Gmail drop the dots it ignores and fold
 * googlemail.com into gmail.com. Over-merging two genuinely different
 * mailboxes only makes them share a limit, which is the safe direction.
 */
export function mailboxKey(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/** Spend one send from `email`'s inbox budget; returns a 429 response when exhausted. */
export function spendMailBudget(email: string): NextResponse | null {
  const result = rateLimit(`mail:to:${mailboxKey(email)}`, MAIL_PER_WINDOW, MAIL_WINDOW_MS);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "Too many emails requested for that address. Please try again later." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
