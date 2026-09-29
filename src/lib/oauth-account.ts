import { Prisma } from "@/generated/prisma/client";
import type { ProviderIdentity } from "@/lib/oauth-identity";
import { linkOutcome } from "@/lib/oauth-link-policy";
import { prisma } from "@/lib/prisma";
import { clearPendingSignups } from "@/lib/signup-verification";

/**
 * Turn a verified provider identity into one of OUR users, in one transaction:
 *
 * 1. An Account row for (provider, subject) already exists → that user.
 * 2. Else a user with the same VERIFIED email exists → link: add the Account
 *    row to them. Verified is the whole safety argument — an unverified email
 *    claim must never open someone else's account. And if we never verified
 *    THEIR email, whatever was attached to the row before this proof (a
 *    password, sessions, other provider links) proved nothing: it is removed
 *    (oauth-link-policy.ts, Rule 3), so a squatter who pre-registered the
 *    address can't ride in behind the owner.
 * 3. Else, only for a VERIFIED email, create the user (no password; they sign
 *    in with the provider) with the Account row attached, and retire any
 *    sign-up still pending for the address. An unverified email gets no
 *    account at all: nobody has proven they own it (Rule 1).
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

const PROVIDER_LABEL: Record<ProviderIdentity["provider"], string> = {
  apple: "Apple",
  google: "Google",
};

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

/**
 * The provider hasn't verified the email, so it can neither create an account
 * nor link into one. The website refuses the same identity outright
 * (callbacks.signIn in src/auth.ts); this is the app's side of that refusal.
 *
 * ONE error for both cases, raised before looking the address up. Refusing
 * with "an account already exists" when one did and "can't create one" when
 * it didn't told anyone holding an unverified-email token which addresses have
 * accounts — so the message is worded to be true either way.
 */
export class UnverifiedEmailError extends Error {
  constructor(provider: ProviderIdentity["provider"]) {
    const label = PROVIDER_LABEL[provider];
    super(
      `${label} hasn't verified this email address, so we can't use it to sign you in. Verify it with ${label} and try again, or use your email and password instead.`,
    );
    this.name = "UnverifiedEmailError";
  }
}

/** The provider link that was just attached, and the address the provider vouched for. */
export interface NewLink {
  provider: string;
  providerAccountId: string;
  /** The provider's VERIFIED email (Rule 1 is checked before any link is made). */
  verifiedEmail: string | null | undefined;
}

/**
 * What happens to an account once a provider identity is linked to it —
 * shared with the website's Auth.js `linkAccount` event so both doors enforce
 * the same rules (oauth-link-policy.ts). Run it in a transaction — on the app,
 * the one that attached the link, so the link never exists without its
 * consequences — and before the new session is created (Rule 3 deletes every
 * session).
 *
 * - The provider vouched for a different address (Rule 2): it proves nothing
 *   here, so the row is not verified and the link is taken back off.
 * - The row's email was never proven (Rule 3): the password, every session and
 *   every OTHER provider link go, then the row is verified.
 * - Already verified: nothing to do.
 */
export async function hardenLinkedAccount(
  tx: Prisma.TransactionClient,
  user: { id: string; email: string; emailVerified: Date | null },
  link: NewLink,
): Promise<void> {
  const thisLink = { provider: link.provider, providerAccountId: link.providerAccountId };
  switch (linkOutcome(user, link.verifiedEmail)) {
    case "keep":
      return;
    case "foreign":
      await tx.account.deleteMany({ where: { userId: user.id, ...thisLink } });
      return;
    case "reclaim":
      // Sessions even when there is no password: an account created from an
      // unverified provider email has sessions and no password at all.
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.account.deleteMany({ where: { userId: user.id, NOT: thisLink } });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: null, emailVerified: new Date() },
      });
      return;
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
  try {
    return await providerSignInOnce(identity, hint);
  } catch (error) {
    // Unique violation on User.email: the address got its account between our
    // lookup and our create — a password sign-up confirmed, or the same person
    // on a second device. Run it once more; the retry finds that account and
    // takes the link path (with its hardening) instead of answering a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return providerSignInOnce(identity, hint);
    }
    throw error;
  }
}

async function providerSignInOnce(
  identity: ProviderIdentity,
  hint: { name?: string | null },
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
    // Before the lookup, not after: see UnverifiedEmailError.
    if (!identity.emailVerified) throw new UnverifiedEmailError(identity.provider);

    const byEmail = await tx.user.findUnique({
      where: { email: identity.email },
      select: { id: true, email: true, name: true, emailVerified: true },
    });
    if (byEmail) {
      await tx.account.create({ data: { ...account, type: "oidc", userId: byEmail.id } });
      if (!byEmail.name && name) {
        await tx.user.update({ where: { id: byEmail.id }, data: { name } });
      }
      await hardenLinkedAccount(tx, byEmail, { ...account, verifiedEmail: identity.email });
      return { userId: byEmail.id, created: false, linked: true };
    }

    const user = await tx.user.create({
      data: {
        email: identity.email,
        name,
        emailVerified: new Date(),
        accounts: { create: { ...account, type: "oidc" } },
      },
      select: { id: true },
    });
    // The address has an account now; a password sign-up still pending for it
    // (someone else's, or the owner's own abandoned one) must not linger.
    await clearPendingSignups(identity.email, tx);
    return { userId: user.id, created: true, linked: false };
  });
}
