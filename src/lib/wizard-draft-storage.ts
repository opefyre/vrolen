/**
 * VROL-820 — persistent storage for the in-progress Wizard draft.
 *
 * The Scenario Wizard previously had no graceful exit path: if the user
 * dismissed the modal mid-edit they'd lose every keystroke. We now write
 * the draft to localStorage under a stable key on "Save & exit", and the
 * landing page reads it back to offer a "Resume draft" CTA alongside
 * "Start new".
 *
 * Storage is best-effort: localStorage may be disabled (private mode,
 * quota exceeded, SSR). All accessors swallow errors and return `null`
 * so the wizard can fall back to a fresh draft.
 */

import {
  type RealismLevel,
  type WizardDraft,
  type WizardStation,
  defaultDraft,
} from "@/components/wizard/wizard-types";

export const WIZARD_DRAFT_KEY = "vrolen:wizard-draft";

/** Shape of the persisted record — adds a schema version for forward-compat. */
interface PersistedDraft {
  readonly v: 1;
  readonly savedAt: number;
  readonly draft: WizardDraft;
}

function isWizardStation(value: unknown): value is WizardStation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["label"] === "string" &&
    typeof v["stationType"] === "string" &&
    typeof v["cycleMs"] === "number"
  );
}

function isRealismLevel(value: unknown): value is RealismLevel {
  return value === "simple" || value === "realistic" || value === "stress";
}

function isWizardDraft(value: unknown): value is WizardDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const presetIdOk = v["presetId"] === null || typeof v["presetId"] === "string";
  const stationsOk = Array.isArray(v["stations"]) && v["stations"].every(isWizardStation);
  const arrivalsOk =
    typeof v["arrivalsPerMin"] === "number" && Number.isFinite(v["arrivalsPerMin"]);
  const horizonOk = typeof v["horizonMs"] === "number" && Number.isFinite(v["horizonMs"]);
  const realismOk = isRealismLevel(v["realism"]);
  return presetIdOk && stationsOk && arrivalsOk && horizonOk && realismOk;
}

/**
 * Persist a draft. Returns true on success, false if storage failed
 * (e.g., quota exceeded, SSR). The wizard surfaces the result to the
 * user via a toast so silent loss can't happen.
 */
export function saveWizardDraft(draft: WizardDraft): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: PersistedDraft = { v: 1, savedAt: Date.now(), draft };
    window.localStorage?.setItem?.(WIZARD_DRAFT_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a saved draft. Returns the draft on a successful round-trip,
 * `null` if no draft is saved or the stored value is unreadable /
 * fails the shape check.
 */
export function loadWizardDraft(): WizardDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem?.(WIZARD_DRAFT_KEY);
    if (raw === null || raw === undefined || raw === "") return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record["v"] !== 1) return null;
    const draft = record["draft"];
    return isWizardDraft(draft) ? draft : null;
  } catch {
    return null;
  }
}

/** True iff a parseable draft is currently saved. */
export function hasWizardDraft(): boolean {
  return loadWizardDraft() !== null;
}

/** Remove the saved draft. Best-effort; safe to call when no draft exists. */
export function clearWizardDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.removeItem?.(WIZARD_DRAFT_KEY);
  } catch {
    // best-effort
  }
}

/** Convenience for callers that want a fresh draft when none is saved. */
export function loadWizardDraftOrDefault(): WizardDraft {
  return loadWizardDraft() ?? defaultDraft();
}
