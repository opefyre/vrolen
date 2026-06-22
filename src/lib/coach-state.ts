/**
 * Coach-tip dismissal state (VROL-819).
 *
 * The coach is the lightweight nudge layer that runs AFTER the onboarding
 * tour. Each tip carries a stable id; once a user clicks "Don't show again"
 * on a tip, that id is added to the persisted dismissed set so the tip
 * never resurfaces.
 *
 * Pattern mirrors `src/routes/onboarding-state.ts` — in-memory cache is
 * canonical, localStorage is best-effort (happy-dom's shim is flaky and
 * quota errors are possible).
 */

const STORAGE_KEY = "vrolen:coach-dismissed";

let cache: Set<string> | null = null;

function loadFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (raw === null || raw === undefined) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string") ids.push(item);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function persist(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // in-memory cache covers the current session
  }
}

/** Read the dismissed-tip-id set. Returns a fresh copy so callers can't mutate the cache. */
export function getCoachDismissed(): Set<string> {
  if (cache === null) cache = loadFromStorage();
  return new Set(cache);
}

/** Mark a coach tip permanently dismissed. */
export function dismissCoachTip(id: string): void {
  if (cache === null) cache = loadFromStorage();
  if (cache.has(id)) return;
  cache.add(id);
  persist(cache);
}

/** Test seam — reset the in-memory cache (does not touch localStorage). */
export function resetCoachTipsForTests(): void {
  cache = null;
}
