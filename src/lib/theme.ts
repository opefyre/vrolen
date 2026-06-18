/**
 * Theme store — light / dark / system, persisted to localStorage.
 *
 * Three concepts:
 *   - `preference` — what the user picked: "system" | "light" | "dark"
 *   - `resolved`   — the actual mode in effect right now: "light" | "dark"
 *   - DOM state    — .dark class on <html> when resolved is dark
 *
 * "system" preference resolves dynamically from prefers-color-scheme and
 * updates if the OS preference changes mid-session.
 *
 * Persisted under key `vrolen.theme` so we don't fight with other apps.
 */

import { useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "vrolen.theme";

const DEFAULT_PREFERENCE: ThemePreference = "system";

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_PREFERENCE;
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // happy-dom test env, private mode, or other environments without
    // localStorage — fall through to default.
  }
  return DEFAULT_PREFERENCE;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return readSystemPrefersDark() ? "dark" : "light";
  return preference;
}

function applyToDom(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = resolved;
}

// === Vanilla store (independent of React; consumed via useSyncExternalStore) ===

interface ThemeState {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
}

const listeners = new Set<() => void>();
let state: ThemeState = (() => {
  const preference = readPreference();
  return { preference, resolved: resolve(preference) };
})();

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function setState(next: ThemeState): void {
  if (state.preference === next.preference && state.resolved === next.resolved) return;
  state = next;
  notify();
}

export function setThemePreference(preference: ThemePreference): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage?.setItem?.(STORAGE_KEY, preference);
    } catch {
      // Persistence unavailable; theme still applies in memory.
    }
  }
  const resolved = resolve(preference);
  setState({ preference, resolved });
  applyToDom(resolved);
}

export function getThemePreference(): ThemePreference {
  return state.preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return state.resolved;
}

/** Subscribe to the store. Returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// === React hook ===

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );

  // Listen to system pref changes when preference is "system".
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      if (state.preference !== "system") return;
      const resolved = resolve("system");
      setState({ preference: "system", resolved });
      applyToDom(resolved);
    };
    mql.addEventListener("change", handler);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, []);

  return {
    preference: snapshot.preference,
    resolved: snapshot.resolved,
    setPreference: setThemePreference,
  };
}

/** Call once at app startup to apply the persisted preference to the DOM. */
export function initTheme(): void {
  applyToDom(state.resolved);
}
