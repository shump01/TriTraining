"use client";

import { useCallback, useSyncExternalStore } from "react";

import { TOTAL_PCT_STORAGE_KEY, isTotalPctMode, type TotalPctMode } from "@/lib/total-pct";

/**
 * The Total-percentage display preference (distance vs balanced), persisted in
 * localStorage like the theme — a display choice, never sent to the server.
 * useSyncExternalStore keeps hydration stable (server snapshot = "distance",
 * the default) and a custom event + the storage event keep every surface —
 * plan page, dashboard mini, other tabs — in sync instantly.
 */

const CHANGE_EVENT = "tt-total-pct-mode-change";

/**
 * In-memory fallback for environments where storage is blocked (webviews with
 * DOM storage off, strict private modes): the toggle still APPLIES for the
 * session — it just doesn't persist. Without this, a blocked setItem would
 * leave the button visibly dead.
 */
let memoryMode: TotalPctMode | null = null;

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): TotalPctMode {
  try {
    const v = window.localStorage.getItem(TOTAL_PCT_STORAGE_KEY);
    if (isTotalPctMode(v)) return v;
  } catch {
    // Storage blocked — fall through to the in-session choice.
  }
  return memoryMode ?? "distance";
}

export function useTotalPctMode(): [TotalPctMode, (mode: TotalPctMode) => void] {
  const mode = useSyncExternalStore(subscribe, snapshot, () => "distance" as const);

  const setMode = useCallback((next: TotalPctMode) => {
    memoryMode = next;
    try {
      window.localStorage.setItem(TOTAL_PCT_STORAGE_KEY, next);
    } catch {
      // Storage failures degrade to session-only (memoryMode above).
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [mode, setMode];
}
