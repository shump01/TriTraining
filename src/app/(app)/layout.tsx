import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { Sidebar } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth gate for the whole authenticated app shell.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="grid min-h-screen grid-cols-[236px_1fr]">
      <Sidebar email={session.user.email ?? ""} />
      <main className="min-w-0 px-[34px] pt-[26px] pb-[60px]">{children}</main>
    </div>
  );
}
