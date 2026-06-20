/**
 * VROL-677 — one-time welcome toast flag. Fires the first time a user
 * lands on the editor so they know to drag from the palette or load a
 * preset from the scenarios panel. localStorage-backed; in-memory cache
 * canonical so happy-dom's flaky shim doesn't break tests.
 */

const STORAGE_KEY = "vrolen.welcome-toast-seen";

let cache: boolean | null = null;

export function hasSeenWelcomeToast(): boolean {
  if (cache !== null) return cache;
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage?.getItem?.(STORAGE_KEY);
    cache = v === "true";
    return cache;
  } catch {
    cache = true;
    return true;
  }
}

export function markWelcomeToastSeen(): void {
  cache = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, "true");
  } catch {
    // in-memory cache covers session
  }
}

export function _resetWelcomeToastForTests(): void {
  cache = null;
}
