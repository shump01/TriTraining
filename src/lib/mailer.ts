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

export interface SendEmailInput {
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
 * Send one email. Returns whether it was actually sent — false when the mailer
 * isn't configured (caller decides whether to warn/log). Never throws: SMTP
 * failures are logged and swallowed, so no caller's response can leak whether
 * or to whom mail was attempted.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  if (!isMailerConfigured()) return false;

  try {
    await getTransport().sendMail({
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
    return true;
  } catch (error) {
    // Deliberately NOT logging the raw error or subject: nodemailer embeds the
    // recipient address in envelope-failure messages (e.g. EENVELOPE "550
    // <user@example.com> rejected"), and the log redactor preserves
    // Error.message verbatim. Structured non-PII fields only.
    const e = error as { name?: string; code?: string; responseCode?: number };
    logger.error("Failed to send email", {
      name: e?.name,
      code: e?.code,
      responseCode: e?.responseCode,
    });
    return false;
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

  return sendEmail({ to, subject: "Reset your TriTrainer password", text, html });
}
