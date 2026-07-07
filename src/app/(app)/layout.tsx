import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { MobileNav, Rail } from "./app-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth gate for the whole authenticated app shell.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const email = session.user.email ?? "";

  // Mobile-first shell: single column with a top app bar; at `app:` (≥820px) the
  // grid gains a 74px icon rail and the app bar is hidden.
  return (
    <div className="grid min-h-screen app:grid-cols-[74px_1fr]">
      <Rail email={email} />
      <div className="flex min-w-0 flex-col">
        <MobileNav email={email} />
        <main className="min-w-0 px-[14px] pt-[14px] pb-[48px] app:px-[28px] app:pt-[22px] app:pb-[56px]">
          {children}
        </main>
      </div>
    </div>
  );
}
