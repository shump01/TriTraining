import { NextResponse, type NextRequest } from "next/server";

import { createUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/digest";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, bodyHtml: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} — TriTrainer</title></head>` +
      `<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b0b10;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0">` +
      `<div style="max-width:420px;padding:32px;text-align:center"><h1 style="font-size:22px;margin:0 0 8px">${title}</h1>` +
      `${bodyHtml}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const p = (text: string) =>
  `<p style="font-size:14.5px;line-height:1.6;color:#aaa;margin:0">${text}</p>`;

const invalidPage = () =>
  page(
    "That link didn't work",
    p(
      "This unsubscribe link is invalid or damaged. You can also turn the weekly digest off from the Account page inside TriTrainer.",
    ),
    400,
  );

/**
 * Unsubscribe from the weekly digest via the signed token carried in every
 * digest email. Deliberately session-free (the athlete may be signed out in
 * the browser their mail client opens) — the HMAC token is the authorization,
 * which is also why there is no CSRF guard: mail clients' RFC 8058 one-click
 * POSTs arrive with no Origin, and forging the request requires the token.
 *
 * The WRITE only ever happens on POST. GET must stay side-effect free: mail
 * security scanners (SafeLinks, Mimecast, …) fetch every link in a delivered
 * email with GET, and a mutating GET would silently unsubscribe those users
 * the moment the first digest arrives. So GET renders a confirmation page
 * whose button POSTs back here; POST serves both that button and one-click.
 */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "email:unsubscribe", 10, 60_000);
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const userId = token ? verifyUnsubscribeToken(token) : null;
  if (!userId) return invalidPage();

  // Re-derive the canonical token rather than echoing request input into HTML.
  const action = `/api/email/unsubscribe?token=${createUnsubscribeToken(userId)}`;
  return page(
    "Unsubscribe from the weekly digest?",
    p("You'll stop getting the start-of-week training summary. Everything else is unaffected.") +
      `<form method="post" action="${action}" style="margin:20px 0 0">` +
      `<button type="submit" style="cursor:pointer;background:#2563eb;color:#fff;border:0;font-weight:700;font-size:14px;padding:10px 18px;border-radius:10px">Unsubscribe</button>` +
      `</form>`,
    200,
  );
}

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "email:unsubscribe", 10, 60_000);
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token") ?? "";
  const userId = token ? verifyUnsubscribeToken(token) : null;
  if (!userId) return invalidPage();

  // updateMany: a deleted account is a no-op, not a 500. Idempotent.
  await prisma.user.updateMany({ where: { id: userId }, data: { digestEnabled: false } });

  return page(
    "You're unsubscribed",
    p(
      "The weekly digest is off. You can turn it back on any time from the Account page — training data and everything else are unaffected.",
    ),
    200,
  );
}
