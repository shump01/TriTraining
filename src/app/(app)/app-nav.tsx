"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "◧" },
  { href: "/plans", label: "Plans", short: "Plans", icon: "▦" },
  { href: "/plans/new", label: "New plan", short: "New", icon: "＋" },
  { href: "/load", label: "Load", short: "Load", icon: "♥" },
  { href: "/groups", label: "Groups", short: "Group", icon: "◎" },
];

function useActive() {
  const pathname = usePathname();
  return (href: string): boolean => {
    if (href === "/plans") {
      return pathname === "/plans" || (pathname.startsWith("/plans/") && pathname !== "/plans/new");
    }
    if (href === "/groups") {
      return pathname === "/groups" || pathname.startsWith("/groups/");
    }
    return pathname === href;
  };
}

/** Whether the current route is the account page (highlights the avatar). */
function useOnAccount(): boolean {
  return usePathname() === "/account";
}

/** The mobile app bar's title, derived from the current route. */
function useMobileTitle(): string {
  const pathname = usePathname();
  if (pathname === "/dashboard") return "TriTrainer";
  if (pathname === "/plans") return "Your plans";
  if (pathname === "/plans/new") return "New plan";
  if (pathname.endsWith("/edit")) return "Edit plan";
  if (pathname.startsWith("/plans/")) return "Plan";
  if (pathname === "/load") return "Training load";
  if (pathname === "/account") return "Account";
  if (pathname === "/groups") return "Groups";
  if (pathname.startsWith("/groups/join")) return "Join group";
  if (pathname.startsWith("/groups/")) return "Group";
  return "TriTrainer";
}

async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
}

function Avatar({ initial, size }: { initial: string; size: number }) {
  return (
    <div
      style={{ height: size, width: size, fontSize: size < 32 ? 12 : 13 }}
      className="grid place-items-center rounded-full bg-gradient-to-br from-[#15b8e6] to-[#5b6cff] font-display font-bold text-white"
    >
      {initial}
    </div>
  );
}

/** Desktop icon rail (≥820px). Hidden on mobile. */
export function Rail({ name }: { name: string }) {
  const active = useActive();
  const onAccount = useOnAccount();

  return (
    <aside className="sticky top-0 hidden h-screen flex-col items-center border-r border-border bg-bg2 px-2.5 py-4 app:flex">
      <Link
        href="/dashboard"
        aria-label="Dashboard"
        className="mb-[18px] grid h-9 w-9 place-items-center rounded-[10px] bg-brand font-display text-[18px] font-black text-white"
      >
        T
      </Link>
      <nav className="flex w-full flex-col gap-1.5">
        {NAV.map((item) => {
          const on = active(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex w-full flex-col items-center gap-[3px] rounded-[11px] px-1 py-[9px] ${
                on ? "bg-brand text-white" : "text-muted hover:bg-card2"
              }`}
            >
              <span className="text-[18px] leading-none">{item.icon}</span>
              <span className="text-[9.5px] font-bold tracking-[0.02em]">{item.short}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-3">
        <ThemeToggle variant="rail" />
        <Link
          href="/account"
          title={`${name} — account`}
          aria-label={`${name} — account`}
          className={`rounded-full ${onAccount ? "ring-2 ring-brand ring-offset-2 ring-offset-bg2" : ""}`}
        >
          <Avatar initial={name.charAt(0).toUpperCase()} size={34} />
        </Link>
      </div>
    </aside>
  );
}

/** Mobile app bar + slide-in drawer (<820px). Hidden on desktop. */
export function MobileNav({ name }: { name: string }) {
  const active = useActive();
  const title = useMobileTitle();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-border bg-bg2/90 px-3.5 py-[9px] backdrop-blur-[10px] app:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Menu"
          className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] text-[19px] text-text hover:bg-card2"
        >
          ☰
        </button>
        <span className="font-display text-[16px] font-extrabold tracking-[-0.02em]">{title}</span>
        <Link href="/account" aria-label={`${name} — account`} className="ml-auto">
          <Avatar initial={name.charAt(0).toUpperCase()} size={30} />
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] app:hidden">
          <div
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div className="absolute top-0 bottom-0 left-0 flex w-[264px] flex-col border-r border-border bg-bg2 px-3.5 py-[18px]">
            <div className="flex items-center gap-[11px] px-2 pt-1 pb-4">
              <div className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-brand font-display text-[17px] font-black text-white">
                T
              </div>
              <span className="font-display text-[18px] font-extrabold tracking-[-0.02em]">
                TriTrainer
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="ml-auto grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-[9px] text-[17px] text-muted hover:bg-card2"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-col gap-[3px]">
              {NAV.map((item) => {
                const on = active(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-[11px] rounded-[10px] p-3 text-[14.5px] font-semibold ${
                      on ? "bg-brand text-white" : "text-muted hover:bg-card2"
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
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  aria-label={`${name} — account`}
                >
                  <Avatar initial={name.charAt(0).toUpperCase()} size={32} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="block truncate text-[13px] font-bold hover:underline"
                  >
                    {name}
                  </Link>
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
          </div>
        </div>
      )}
    </>
  );
}
