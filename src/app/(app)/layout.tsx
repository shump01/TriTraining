import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { displayNameFor } from "@/lib/display-name";

import { MobileNav, Rail } from "./app-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth gate for the whole authenticated app shell.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Screen name when set, else the email-derived fallback (fresh per request —
  // database sessions re-read the user row, so a rename shows immediately).
  const name = displayNameFor(session.user);

  // Mobile-first shell: single column with a top app bar; at `app:` (≥820px) the
  // grid gains a 74px icon rail and the app bar is hidden.
  return (
    <div className="grid min-h-screen app:grid-cols-[74px_1fr]">
      <Rail name={name} />
      <div className="flex min-w-0 flex-col">
        <MobileNav name={name} />
        <main className="min-w-0 px-[14px] pt-[14px] pb-[48px] app:px-[28px] app:pt-[22px] app:pb-[56px]">
          {children}
        </main>
      </div>
    </div>
  );
}
