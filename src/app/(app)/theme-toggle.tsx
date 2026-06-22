"use client";

import { useSyncExternalStore } from "react";

// The theme lives on <html data-theme> (set before paint by the bootstrap script
// in layout.tsx). useSyncExternalStore reads it without a setState-in-effect and
// keeps the label in sync across toggles via a custom event.
function subscribe(callback: () => void) {
  window.addEventListener("themechange", callback);
  return () => window.removeEventListener("themechange", callback);
}
function getSnapshot(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function getServerSnapshot(): "dark" | "light" {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    if (next === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("themechange"));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex cursor-pointer items-center justify-between rounded-[10px] border border-border px-3 py-[10px] hover:bg-card2"
    >
      <span className="text-[13.5px] font-semibold text-muted">
        {theme === "dark" ? "Dark mode" : "Light mode"}
      </span>
      <span className="text-base">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}
