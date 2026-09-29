/**
 * Auth.js sends OAuth failures back to our sign-in page as `?error=<code>`.
 * The codes are its internal vocabulary; the athlete gets one plain sentence.
 * Unknown codes fall through to a generic line rather than leaking the code.
 */
const MESSAGES: Record<string, string> = {
  AccessDenied: "Sign-in was cancelled, or the provider refused it.",
  Configuration: "That sign-in method isn't available right now.",
  OAuthAccountNotLinked:
    "That email already belongs to an account that signs in another way. Sign in the way you first did.",
  OAuthSignin: "Sign-in with the provider didn't start. Please try again.",
  OAuthCallback: "Sign-in with the provider didn't complete. Please try again.",
  OAuthCallbackError: "Sign-in with the provider didn't complete. Please try again.",
  OAuthCreateAccount: "We couldn't create your account from that sign-in. Please try again.",
  Callback: "Sign-in with the provider didn't complete. Please try again.",
  // Ours, not Auth.js's: callbacks.signIn refuses a provider sign-in made while
  // signed in as a different address (src/lib/oauth-session-guard.ts). A string
  // literal so this module stays importable without the server-only guard.
  SignedInElsewhere:
    "You're already signed in with a different email address. Sign out from your Account page first, then continue with Apple or Google.",
};

const GENERIC = "Something went wrong signing in. Please try again.";

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? GENERIC;
}
