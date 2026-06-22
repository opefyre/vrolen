/**
 * VROL-820 — persistent storage for the in-progress Wizard draft.
 *
 * The Scenario Wizard previously had no graceful exit path: if the user
 * dismissed the modal mid-edit they'd lose every keystroke. We now write
 * the draft to localStorage under a stable key on "Save & exit", and the
 * landing page reads it back to offer a "Resume draft" CTA alongside
 * "Start new".
 *
 * VROL-871 — extended the validator to cover the rebuilt 8-step draft
 * (stations carry distributions, connections, products, changeovers,
 * realism + arrivals + materials + run-window blocks). The schema
 * version bumps from 1 → 2; legacy v=1 payloads are discarded silently
 * so users who saved a draft on the old wizard get a fresh start.
 *
 * Storage is best-effort: localStorage may be disabled (private mode,
 * quota exceeded, SSR). All accessors swallow errors and return `null`
 * so the wizard can fall back to a fresh draft.
 */

import { type WizardDraft, defaultDraft } from "@/components/wizard/wizard-types";

export const WIZARD_DRAFT_KEY = "vrolen:wizard-draft";

const SCHEMA_VERSION = 2 as const;

/** Shape of the persisted record — adds a schema version for forward-compat. */
interface PersistedDraft {
  readonly v: typeof SCHEMA_VERSION;
  readonly savedAt: number;
  readonly draft: WizardDraft;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isWizardDraft(value: unknown): value is WizardDraft {
  if (!isObj(value)) return false;
  // VROL-821 — shapeKind is `ShapeKind | null` (null until the user has
  // explicitly picked a shape card on step 1).
  if (value["shapeKind"] !== null && !isStr(value["shapeKind"])) return false;
  if (!Array.isArray(value["stations"])) return false;
  if (!Array.isArray(value["connections"])) return false;
  if (typeof value["productsEnabled"] !== "boolean") return false;
  if (!Array.isArray(value["products"])) return false;
  if (!isObj(value["perProductCycles"])) return false;
  if (!isObj(value["changeoverMatrices"])) return false;
  if (!isObj(value["breakdowns"])) return false;
  if (typeof value["workersEnabled"] !== "boolean") return false;
  if (!Array.isArray(value["workers"])) return false;
  if (!isObj(value["arrivals"])) return false;
  if (!isObj(value["materials"])) return false;
  if (!isObj(value["runWindow"])) return false;
  if (!isStr(value["realism"])) return false;
  // Spot-check station / connection / product / runWindow leaf fields so we
  // catch truncated payloads (e.g., a v=2 marker but pre-VROL-871 internals).
  const station0 = (value["stations"] as unknown[])[0];
  if (station0 !== undefined) {
    if (!isObj(station0)) return false;
    if (!isStr(station0["id"])) return false;
    if (!isObj(station0["cycleDistribution"])) return false;
    if (!isFiniteNum(station0["parallelCapacity"])) return false;
    if (!isFiniteNum(station0["defectRate"])) return false;
  }
  const rw = value["runWindow"];
  if (
    !isFiniteNum(rw["horizonMs"]) ||
    !isFiniteNum(rw["warmupMs"]) ||
    !isFiniteNum(rw["seed"]) ||
    !isFiniteNum(rw["interStationBufferCapacity"]) ||
    !isFiniteNum(rw["replications"]) ||
    !isFiniteNum(rw["samplerIntervalMs"])
  ) {
    return false;
  }
  return true;
}

/**
 * Persist a draft. Returns true on success, false if storage failed
 * (e.g., quota exceeded, SSR). The wizard surfaces the result to the
 * user via a toast so silent loss can't happen.
 */
export function saveWizardDraft(draft: WizardDraft): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload: PersistedDraft = { v: SCHEMA_VERSION, savedAt: Date.now(), draft };
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
    if (!isObj(parsed)) return null;
    if (parsed["v"] !== SCHEMA_VERSION) return null;
    const draft = parsed["draft"];
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
