/**
 * Onboarding seen-flag + resume-step helpers (VROL-632, VROL-818).
 *
 * In its own module so the OnboardingTour component file can satisfy
 * react-refresh/only-export-components (component files should only export
 * components for HMR to work cleanly).
 *
 * VROL-818 expands the surface:
 *   - `hasSeenOnboarding` / `markOnboardingSeen` — unchanged, gate the
 *     auto-open on first visit.
 *   - `loadOnboardingStep` / `saveOnboardingStep` / `clearOnboardingStep` —
 *     persist the current step so a mid-tour reload resumes where the user
 *     left off instead of restarting from step 1.
 *
 * In-memory caches are canonical; localStorage is best-effort persistence —
 * happy-dom's shim is flaky and quota errors are possible.
 */

const SEEN_KEY = "vrolen.onboarding-seen";
const STEP_KEY = "vrolen.onboarding-step";

let seenCache: boolean | null = null;
let stepCache: number | null = null;

export function hasSeenOnboarding(): boolean {
  if (seenCache !== null) return seenCache;
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage?.getItem?.(SEEN_KEY);
    seenCache = v === "true";
    return seenCache;
  } catch {
    seenCache = true;
    return true;
  }
}

export function markOnboardingSeen(): void {
  seenCache = true;
  stepCache = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(SEEN_KEY, "true");
    window.localStorage?.removeItem?.(STEP_KEY);
  } catch {
    // ignore — in-memory cache covers the current session.
  }
}

/**
 * Read the persisted resume-step index. Returns 0 (start of tour) when no
 * value exists or the stored value is malformed. Callers should clamp
 * against the actual step count themselves.
 */
export function loadOnboardingStep(): number {
  if (stepCache !== null) return stepCache;
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage?.getItem?.(STEP_KEY);
    if (raw === null || raw === undefined) {
      stepCache = 0;
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      stepCache = 0;
      return 0;
    }
    stepCache = parsed;
    return parsed;
  } catch {
    stepCache = 0;
    return 0;
  }
}

export function saveOnboardingStep(stepIdx: number): void {
  stepCache = stepIdx;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STEP_KEY, String(stepIdx));
  } catch {
    // ignore
  }
}

export function clearOnboardingStep(): void {
  stepCache = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(STEP_KEY);
  } catch {
    // ignore
  }
}

/** Test seam — reset the in-memory caches (does not touch localStorage). */
export function _resetOnboardingCacheForTests(): void {
  seenCache = null;
  stepCache = null;
}
