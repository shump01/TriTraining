/**
 * The one rule for what to call a user, shared by the nav, the dashboard
 * greeting, group member lists, and the mobile API. A chosen screen name wins;
 * otherwise fall back to the email's local part, capitalized — the historical
 * behavior from before screen names existed (this helper replaced three
 * identical private copies of that fallback).
 */
export function displayNameFor(user: { name?: string | null; email?: string | null }): string {
  const chosen = user.name?.trim();
  if (chosen) return chosen;
  const local = (user.email ?? "").split("@")[0] || "Athlete";
  return local.charAt(0).toUpperCase() + local.slice(1);
}
