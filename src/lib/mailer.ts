import nodemailer from "nodemailer";

import { env } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Transactional email over SMTP: sign-up confirmation, password reset, the
 * weekly digest.
 *
 * The app boots without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM`, which
 * keeps local dev and CI free of a mail dependency. Production is different:
 * password sign-up REQUIRES a working mailer (a sign-up is only completed by
 * confirming an emailed link), so there the signup route answers 503 rather
 * than claim to have sent mail it could not.
 */
export function isMailerConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
}

/**
 * Hard ceiling on one send, end to end. Nodemailer's own defaults wait up to
 * two minutes to connect and ten on an idle socket, and its per-phase timeouts
 * add up (DNS, connect, greeting, then STARTTLS/AUTH/DATA). The signup route
 * sends inline, and the mobile app aborts a request at 15s — a slow mail
 * server must turn into a clean 503 here, not a client-side "can't reach
 * TriTrainer" while the server carries on and the athlete retries.
 */
const SEND_DEADLINE_MS = 10_000;

let transport: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Implicit TLS on 465; STARTTLS otherwise (Hetzner default on 587).
    secure: env.SMTP_PORT === 465,
    dnsTimeout: 5_000,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
    // Never transmit the reset link / credentials in cleartext: require a
    // successful STARTTLS upgrade (fail the send rather than fall back to
    // plaintext) and refuse anything below TLS 1.2.
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
}

/** Which flow sent a message — logged on failure so an outage has a name. */
export type MailKind = "signup-confirm" | "signup-existing" | "password-reset" | "digest";

export interface SendEmailInput {
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * When set, the message carries List-Unsubscribe headers (RFC 8058 one-click)
   * so mail clients show their native unsubscribe affordance — required
   * practice for recurring mail like the weekly digest.
   */
  listUnsubscribeUrl?: string;
}

/**
 * - "sent": the SMTP server accepted the message.
 * - "failed": it definitely did not go out (no mailer, or the server refused).
 * - "timed_out": the deadline passed first — but the send is NOT aborted and
 *   may still deliver seconds later. Callers that would undo state on a failed
 *   send must not undo it here: a sign-up rolled back on a timeout left the
 *   late-arriving email carrying a link to an attempt that no longer existed.
 */
export type SendOutcome = "sent" | "failed" | "timed_out";

/**
 * Send one email. Returns whether it was actually sent — false when the mailer
 * isn't configured (caller decides whether to warn/log). Never throws: SMTP
 * failures are logged and swallowed, so no caller's response can leak whether
 * or to whom mail was attempted. See sendEmailWithOutcome to tell a definite
 * failure from a timeout.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  return (await sendEmailWithOutcome(input)) === "sent";
}

/** sendEmail, but distinguishing a definite failure from a timeout. */
export async function sendEmailWithOutcome(input: SendEmailInput): Promise<SendOutcome> {
  if (!isMailerConfigured()) return "failed";

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("Send deadline exceeded"), { name: "SendDeadline" })),
      SEND_DEADLINE_MS,
    );
  });

  try {
    const send = getTransport().sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.listUnsubscribeUrl
        ? {
            "List-Unsubscribe": `<${input.listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          }
        : undefined,
    });
    // A send that loses the race carries on and may still deliver: see
    // "timed_out" above. Swallow its eventual rejection so it can't surface as
    // an unhandled one after we've answered.
    send.catch(() => {});
    await Promise.race([send, deadline]);
    return "sent";
  } catch (error) {
    // Deliberately NOT logging the raw error or subject: nodemailer embeds the
    // recipient address in envelope-failure messages (e.g. EENVELOPE "550
    // <user@example.com> rejected"), and the log redactor preserves
    // Error.message verbatim. Structured non-PII fields only.
    //
    // `smtpCode`, not `code`: the log redactor masks any key matching \bcode\b
    // (it guards OAuth codes), which had been silently turning EAUTH versus
    // ECONNECTION — the one field that says WHY mail failed — into
    // "[redacted]".
    const e = error as { name?: string; code?: string; responseCode?: number };
    logger.error("Failed to send email", {
      kind: input.kind,
      name: e?.name,
      smtpCode: e?.code,
      responseCode: e?.responseCode,
    });
    return e?.name === "SendDeadline" ? "timed_out" : "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** Send a password-reset email. See sendEmail for the no-throw semantics. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const text =
    `You (or someone) asked to reset your TriTrainer password.\n\n` +
    `Open this link to choose a new password (valid for 60 minutes):\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email — your password won't change.`;

  const html =
    `<p>You (or someone) asked to reset your TriTrainer password.</p>` +
    `<p>Open this link to choose a new password (valid for 60 minutes):<br>` +
    `<a href="${resetUrl}">${resetUrl}</a></p>` +
    `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`;

  return sendEmail({
    kind: "password-reset",
    to,
    subject: "Reset your TriTrainer password",
    text,
    html,
  });
}

/**
 * "Works for 24 hours" / "for the next 5 hours" / "for less than an hour".
 * A re-sent link expires with the sign-up it confirms, not 24h after the
 * resend (src/lib/signup-verification.ts), so the email must state the
 * deadline it actually has.
 */
export function validityPhrase(expires: Date, now: Date = new Date()): string {
  // Floor, never round: rounding up across an hour boundary, or calling
  // 23h35m "24 hours", is exactly the overstated deadline this exists to stop.
  // Only a link minted moments ago has (essentially) all 24 hours left.
  const minutes = Math.floor((expires.getTime() - now.getTime()) / 60_000);
  if (minutes >= 24 * 60 - 1) return "for 24 hours";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "for the next hour" : `for the next ${hours} hours`;
  }
  return "for less than an hour";
}

/**
 * The confirm-your-address email. The page it links to asks for the password
 * chosen at sign-up — say so here, so nobody is surprised by the prompt.
 *
 * `variant: "recovery"` is for someone who pressed "Forgot password?" for an
 * address that never finished signing up. They didn't just choose a password
 * (or think they did), and the welcome copy would read as a non-sequitur — so
 * explain what's happening and offer the way out if the password is gone too.
 */
export async function sendSignupConfirmationEmail(
  to: string,
  confirmUrl: string,
  expires: Date,
  variant: "signup" | "recovery" = "signup",
): Promise<SendOutcome> {
  const valid = validityPhrase(expires);
  const intro =
    variant === "recovery"
      ? "You asked to reset your TriTrainer password, but this address hasn't finished signing up " +
        "yet — there's no account to reset. Confirm your email address to create it. You'll be " +
        `asked for the password you chose when you signed up (this link works ${valid}). If ` +
        "you've forgotten that too, just sign up again with a new one."
      : "Welcome to TriTrainer. Confirm your email address to finish creating your account. " +
        `You'll be asked for the password you just chose (this link works ${valid}).`;
  const outro =
    "If you didn't sign up, ignore this email — no account is created unless the link is used " +
    "with the password that was chosen.";

  const text = `${intro}\n\n${confirmUrl}\n\n${outro}`;
  const html =
    `<p>${intro}</p>` + `<p><a href="${confirmUrl}">${confirmUrl}</a></p>` + `<p>${outro}</p>`;

  return sendEmailWithOutcome({
    kind: "signup-confirm",
    to,
    subject:
      variant === "recovery"
        ? "Finish creating your TriTrainer account"
        : "Confirm your TriTrainer email address",
    text,
    html,
  });
}

/**
 * Sent when someone signs up with an address that already has an account. The
 * signup response is identical either way (no enumeration), so without this
 * the real owner — who has usually just forgotten they signed up before —
 * would wait for a confirmation that never comes. Worded neutrally: most of
 * the time it IS the owner, and it shouldn't read like a security alert.
 */
export async function sendAlreadyRegisteredEmail(
  to: string,
  signInUrl: string,
  resetUrl: string,
): Promise<SendOutcome> {
  const text =
    `Someone — probably you — tried to create a TriTrainer account with this email address, ` +
    `but you already have one.\n\n` +
    `Sign in: ${signInUrl}\n` +
    `Forgotten your password? ${resetUrl}\n\n` +
    `If it wasn't you, you don't need to do anything. Your account hasn't changed.`;

  const html =
    `<p>Someone — probably you — tried to create a TriTrainer account with this email address, ` +
    `but you already have one.</p>` +
    `<p><a href="${signInUrl}">Sign in</a> · <a href="${resetUrl}">Reset your password</a></p>` +
    `<p>If it wasn't you, you don't need to do anything. Your account hasn't changed.</p>`;

  return sendEmailWithOutcome({
    kind: "signup-existing",
    to,
    subject: "You already have a TriTrainer account",
    text,
    html,
  });
}
