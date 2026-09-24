import type { Prisma } from "@/generated/prisma/client";
import type { ProviderIdentity } from "@/lib/oauth-identity";
import { linkRevokesPassword } from "@/lib/oauth-link-policy";
import { prisma } from "@/lib/prisma";

/**
 * Turn a verified provider identity into one of OUR users, in one transaction:
 *
 * 1. An Account row for (provider, subject) already exists → that user.
 * 2. Else a user with the same VERIFIED email exists → link: add the Account
 *    row to them. Verified is the whole safety argument — an unverified email
 *    claim must never open someone else's account. And because sign-up never
 *    verified THEIR email, a password on that row proved nothing: it is
 *    removed and their sessions revoked (oauth-link-policy.ts, Rule 2), so a
 *    squatter who pre-registered the address can't ride in behind the owner.
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

type LinkDb = Prisma.TransactionClient | typeof prisma;

/**
 * What happens to an existing account once a provider identity is linked to
 * it — shared with the website's Auth.js `linkAccount` event so both doors
 * enforce the same rule. The provider has just vouched for the email, so the
 * row becomes verified; and if the row's password predates any verification,
 * it goes, along with every session it opened (oauth-link-policy.ts, Rule 2).
 * Callers create the NEW session after this runs.
 */
export async function hardenLinkedAccount(
  db: LinkDb,
  user: { id: string; passwordHash: string | null; emailVerified: Date | null },
): Promise<void> {
  const patch: { passwordHash?: null; emailVerified?: Date } = {};
  if (linkRevokesPassword(user)) {
    patch.passwordHash = null;
    await db.session.deleteMany({ where: { userId: user.id } });
  }
  if (!user.emailVerified) patch.emailVerified = new Date();
  if (Object.keys(patch).length) {
    await db.user.update({ where: { id: user.id }, data: patch });
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
      select: { id: true, name: true, emailVerified: true, passwordHash: true },
    });
    if (byEmail) {
      if (!identity.emailVerified) throw new EmailInUseError();
      await tx.account.create({ data: { ...account, type: "oidc", userId: byEmail.id } });
      if (!byEmail.name && name) {
        await tx.user.update({ where: { id: byEmail.id }, data: { name } });
      }
      await hardenLinkedAccount(tx, byEmail);
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
