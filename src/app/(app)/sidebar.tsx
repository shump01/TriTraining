"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/plans", label: "Plans", icon: "▦" },
  { href: "/plans/new", label: "New plan", icon: "＋" },
];

function displayName(email: string): string {
  const local = email.split("@")[0] || "Athlete";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const name = displayName(email);

  function isActive(href: string): boolean {
    if (href === "/plans") {
      return pathname === "/plans" || (pathname.startsWith("/plans/") && pathname !== "/plans/new");
    }
    return pathname === href;
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-border bg-bg2 px-[14px] py-5">
      <Link href="/dashboard" className="flex items-center gap-[11px] px-2 pt-1.5 pb-[18px]">
        <div className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-brand font-display text-[17px] font-black text-white">
          T
        </div>
        <span className="font-display text-[18px] font-extrabold tracking-[-0.02em]">
          TriTrainer
        </span>
      </Link>

      <nav className="mt-2 flex flex-col gap-[3px]">
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-[11px] rounded-[10px] px-3 py-[10px] text-[14.5px] font-semibold ${
                active ? "bg-brand text-white" : "text-muted hover:bg-card2"
              }`}
            >
              <span className="w-5 text-center text-[17px]">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-[10px]">
        <ThemeToggle />
        <div className="flex items-center gap-[10px] px-1.5 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#15b8e6] to-[#5b6cff] font-display text-[13px] font-bold text-white">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold">{name}</div>
            <button
              type="button"
              onClick={signOut}
              className="cursor-pointer text-[12px] text-faint hover:text-text"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
