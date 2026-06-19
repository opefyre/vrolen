/**
 * Onboarding seen-flag helpers (VROL-632).
 *
 * In its own module so the OnboardingTour component file can satisfy
 * react-refresh/only-export-components (component files should only export
 * components for HMR to work cleanly).
 *
 * In-memory cache canonical; localStorage is best-effort persistence —
 * happy-dom's shim is flaky and quota errors are possible.
 */

const STORAGE_KEY = "vrolen.onboarding-seen";

let seenCache: boolean | null = null;

export function hasSeenOnboarding(): boolean {
  if (seenCache !== null) return seenCache;
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage?.getItem?.(STORAGE_KEY);
    seenCache = v === "true";
    return seenCache;
  } catch {
    seenCache = true;
    return true;
  }
}

export function markOnboardingSeen(): void {
  seenCache = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, "true");
  } catch {
    // ignore — in-memory cache covers the current session.
  }
}

/** Test seam — reset the in-memory cache (does not touch localStorage). */
export function _resetOnboardingCacheForTests(): void {
  seenCache = null;
}
