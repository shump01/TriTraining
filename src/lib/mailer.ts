import nodemailer from "nodemailer";

import { env } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Transactional email over SMTP (password-reset links).
 *
 * SMTP is OPTIONAL: without `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` the
 * app still boots and every other feature works — mail is simply skipped. This
 * keeps local/dev and CI free of a mail dependency; production sets the vars
 * (e.g. a Hetzner mailbox) to actually deliver.
 */
export function isMailerConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.MAIL_FROM);
}

let transport: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Implicit TLS on 465; STARTTLS otherwise (Hetzner default on 587).
    secure: env.SMTP_PORT === 465,
    // Never transmit the reset link / credentials in cleartext: require a
    // successful STARTTLS upgrade (fail the send rather than fall back to
    // plaintext) and refuse anything below TLS 1.2.
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
}

/**
 * Send a password-reset email. Returns whether it was actually sent — false
 * when the mailer isn't configured (caller decides whether to warn/log). Never
 * throws: SMTP failures are logged and swallowed so the API response (which is
 * deliberately identical whether or not an account exists) can't leak anything.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  if (!isMailerConfigured()) return false;

  const text =
    `You (or someone) asked to reset your TriTrainer password.\n\n` +
    `Open this link to choose a new password (valid for 60 minutes):\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email — your password won't change.`;

  const html =
    `<p>You (or someone) asked to reset your TriTrainer password.</p>` +
    `<p>Open this link to choose a new password (valid for 60 minutes):<br>` +
    `<a href="${resetUrl}">${resetUrl}</a></p>` +
    `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`;

  try {
    await getTransport().sendMail({
      from: env.MAIL_FROM,
      to,
      subject: "Reset your TriTrainer password",
      text,
      html,
    });
    return true;
  } catch (error) {
    logger.error("Failed to send password-reset email", { error });
    return false;
  }
}
