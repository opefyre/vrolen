/**
 * Hand off a freshly-built scenario from the Wizard to the Editor route.
 *
 * The Editor mounts at /editor and reads localStorage on first paint
 * via its existing canvas-persistence flow. We piggyback on that: we
 * write a special pending-scenario record, then redirect; on mount the
 * editor checks for the pending record, applies it, and clears it.
 *
 * VROL-871 — widened the settings patch to carry the rebuilt wizard's
 * full payload (run window, products, workers, materials) so the
 * editor mounts a complete scenario, not a half-authored one.
 */

import type { Edge, Node } from "@xyflow/react";

import type { WizardCommit } from "@/components/wizard/wizard-types";

const PENDING_KEY = "vrolen.wizard-pending";

export interface WizardPending {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly settingsPatch: WizardCommit["settingsPatch"];
  readonly autorun: boolean;
}

export function setPendingWizardCommit(payload: WizardPending): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

export function takePendingWizardCommit(): WizardPending | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem?.(PENDING_KEY);
    if (!raw) return null;
    window.localStorage?.removeItem?.(PENDING_KEY);
    return JSON.parse(raw) as WizardPending;
  } catch {
    return null;
  }
}
