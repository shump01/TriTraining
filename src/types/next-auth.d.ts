import type { DefaultSession } from "next-auth";

/**
 * Ensure `session.user.id` is typed. With the database session strategy the
 * adapter always provides the user id at runtime; this makes it available to
 * the type system so user-scoped queries can rely on it.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
