"use client";

import { useState, useSyncExternalStore } from "react";

import { countdownLabel, raceCountdown } from "@/lib/race-countdown";

/**
 * The race countdown as a non-ticking client island, hydration-safe.
 *
 * The race is a calendar day where the ATHLETE is, so only the browser can
 * count the days. But the server renders first, in its own zone (UTC), and
 * React insists the hydration render match that HTML byte for byte — so the
 * server-rendered branch must be zone-free. It is: until hydration is done
 * the island shows the server's own `weeksToGo`, a pure instant comparison
 * that yields the same number everywhere. After hydration (and on every
 * client-side mount, which never hydrates) it renders from the browser's
 * clock, read once per mount — not once per module, which left a long-lived
 * tab a day behind after each soft navigation back to the dashboard.
 *
 * Nothing ticks: the value changes at most once a day, and a page load is
 * the right refresh on the web. The app's dashboard is where the live clock
 * lives.
 */

const emptySubscribe = () => () => {};

/** False during server render and the hydration pass, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** The browser's clock, read once when this instance mounts (never in render). */
function useMountMs(): number {
  const [mountMs] = useState(() => Date.now());
  return mountMs;
}

function raceDayLabel(raceDayMs: number): string {
  return new Date(raceDayMs).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function RaceCountdownHero({
  eventDate,
  weeksToGo,
}: {
  /** ISO UTC-midnight of the race's calendar day. */
  eventDate: string;
  /** The server's zone-free figure — the hydration-safe placeholder. */
  weeksToGo: number;
}) {
  const hydrated = useHydrated();
  const mountMs = useMountMs();
  const cd = hydrated ? raceCountdown(eventDate, mountMs) : null;

  let value = String(weeksToGo);
  let label = "weeks to go";
  let isWord = false;
  if (cd) {
    switch (cd.phase) {
      case "weeks":
        value = String(cd.weeks);
        label = "weeks to go";
        break;
      case "days":
        value = String(cd.days);
        label = "days to go";
        break;
      case "eve":
        value = "Tomorrow";
        label = "race day";
        isWord = true;
        break;
      case "raceDay":
        value = "Race day";
        label = raceDayLabel(cd.raceDayMs);
        isWord = true;
        break;
      case "done":
        value = "Done";
        label = `raced ${raceDayLabel(cd.raceDayMs)}`;
        isWord = true;
        break;
    }
  }

  return (
    <>
      <div
        className="hero-count"
        style={isWord ? { fontSize: "clamp(1.4rem, 2.4vw, 2rem)" } : undefined}
      >
        {value}
      </div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em" }}>
        {label}
      </div>
    </>
  );
}

/**
 * The compact "12 days" / "Tomorrow" / "Today" / "Raced" for the strip —
 * same hydration rule: the server's "N wks" until the browser can count.
 */
export function RaceCountdownLabel({
  eventDate,
  weeksToGo,
}: {
  eventDate: string;
  weeksToGo: number;
}) {
  const hydrated = useHydrated();
  const mountMs = useMountMs();
  const cd = hydrated ? raceCountdown(eventDate, mountMs) : null;
  if (cd) return <>{countdownLabel(cd, "short")}</>;
  return (
    <>
      {weeksToGo} wk{weeksToGo === 1 ? "" : "s"}
    </>
  );
}
