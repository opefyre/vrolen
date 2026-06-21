/**
 * Hand off a freshly-built scenario from the Wizard to the Editor route.
 *
 * The Editor mounts at /editor and reads localStorage on first paint
 * via its existing canvas-persistence flow. We piggyback on that: we
 * write a special pending-scenario record, then redirect; on mount the
 * editor checks for the pending record, applies it, and clears it.
 */

import type { Edge, Node } from "@xyflow/react";

const PENDING_KEY = "vrolen.wizard-pending";

export interface WizardPending {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly settingsPatch: {
    horizonMs: number;
    interStationBufferCapacity: number;
    source: { enabled: boolean; intervalMs: number; batchSize: number };
    breakdowns?: { enabled: boolean; mtbfMs: number; mttrMs: number };
    defaultDefectRate: number;
    samplerIntervalMs: number;
  };
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
