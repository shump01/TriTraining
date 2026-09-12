import type { ProviderIdentity } from "@/lib/oauth-identity";
import { prisma } from "@/lib/prisma";

/**
 * Turn a verified provider identity into one of OUR users, in one transaction:
 *
 * 1. An Account row for (provider, subject) already exists → that user.
 * 2. Else a user with the same VERIFIED email exists → link: add the Account
 *    row to them. Verified is the whole safety argument — an unverified email
 *    claim must never open someone else's account.
 * 3. Else create the user (no password; they sign in with the provider) with
 *    the Account row attached.
 *
 * Apple sends the person's name and email to the app on the FIRST
 * authorization only, so the app passes the name along as a hint and we keep
 * it wherever the user has none yet.
 */

export interface ProviderSignInResult {
  userId: string;
  /** A brand-new account — the app schedules its first-run flow on this. */
  created: boolean;
  /** An existing password account gained this provider. */
  linked: boolean;
}

/** The provider shared no usable email and we have no account for the subject. */
export class MissingEmailError extends Error {
  constructor(provider: ProviderIdentity["provider"]) {
    super(
      provider === "apple"
        ? "Apple didn't share an email address. In Settings → Apple ID → Sign in with Apple, remove TriTrainer and try again."
        : "Google didn't share an email address for this account.",
    );
    this.name = "MissingEmailError";
  }
}

/** The email is already an account, but the provider hasn't verified it — no link. */
export class EmailInUseError extends Error {
  constructor() {
    super("An account with this email already exists. Sign in with your password to continue.");
    this.name = "EmailInUseError";
  }
}

const DISPLAY_NAME_MAX = 40;

function cleanName(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v.slice(0, DISPLAY_NAME_MAX);
  }
  return null;
}

export async function signInWithProviderIdentity(
  identity: ProviderIdentity,
  hint: { name?: string | null } = {},
): Promise<ProviderSignInResult> {
  const name = cleanName(hint.name, identity.name);
  const account = { provider: identity.provider, providerAccountId: identity.subject };

  return prisma.$transaction(async (tx) => {
    const existing = await tx.account.findUnique({
      where: { provider_providerAccountId: account },
      select: { userId: true, user: { select: { name: true } } },
    });
    if (existing) {
      if (!existing.user.name && name) {
        await tx.user.update({ where: { id: existing.userId }, data: { name } });
      }
      return { userId: existing.userId, created: false, linked: false };
    }

    if (!identity.email) throw new MissingEmailError(identity.provider);

    const byEmail = await tx.user.findUnique({
      where: { email: identity.email },
      select: { id: true, name: true, emailVerified: true },
    });
    if (byEmail) {
      if (!identity.emailVerified) throw new EmailInUseError();
      await tx.account.create({ data: { ...account, type: "oidc", userId: byEmail.id } });
      const patch: { name?: string; emailVerified?: Date } = {};
      if (!byEmail.name && name) patch.name = name;
      if (!byEmail.emailVerified) patch.emailVerified = new Date();
      if (Object.keys(patch).length) {
        await tx.user.update({ where: { id: byEmail.id }, data: patch });
      }
      return { userId: byEmail.id, created: false, linked: true };
    }

    const user = await tx.user.create({
      data: {
        email: identity.email,
        name,
        emailVerified: identity.emailVerified ? new Date() : null,
        accounts: { create: { ...account, type: "oidc" } },
      },
      select: { id: true },
    });
    return { userId: user.id, created: true, linked: false };
  });
}
