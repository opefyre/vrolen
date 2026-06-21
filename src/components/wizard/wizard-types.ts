/**
 * Wizard draft state — the canonical in-progress scenario the wizard
 * builds up across its 5 steps. The shell holds this state; each step
 * reads + mutates it via a single `update(partial)` callback so step
 * components remain pure.
 *
 * Commit-time the host transforms the draft into:
 *   - canvas nodes + edges (via shape preset + per-station cycle edits)
 *   - RunSettings (horizon, source rate, realism toggles)
 *
 * VROL-820 — exposes per-step validation predicates so the shell can
 * gate the Next button and steps can render inline error messages.
 */

import type { Edge, Node } from "@xyflow/react";

export type RealismLevel = "simple" | "realistic" | "stress";

export interface WizardStation {
  /** Stable identifier (kept while user is editing). */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Engine station type — machine / qc / buffer / etc. */
  readonly stationType: string;
  /** Mean cycle time in ms. */
  readonly cycleMs: number;
}

export interface WizardDraft {
  /** Preset id chosen on step 1 (blank means start blank). */
  readonly presetId: string | null;
  /** Stations the wizard is composing. */
  readonly stations: readonly WizardStation[];
  /** Source rate — items per minute. */
  readonly arrivalsPerMin: number;
  /** Total run horizon in ms. */
  readonly horizonMs: number;
  /** Realism level chosen on step 4. */
  readonly realism: RealismLevel;
}

export interface WizardCommit {
  readonly nodes: Node[];
  readonly edges: Edge[];
  /** Overrides to apply on top of DEFAULT_RUN_SETTINGS. */
  readonly settingsPatch: {
    horizonMs: number;
    interStationBufferCapacity: number;
    source: { enabled: boolean; intervalMs: number; batchSize: number };
    breakdowns?: { enabled: boolean; mtbfMs: number; mttrMs: number };
    /** Default per-station defect rate to apply across the line. */
    defaultDefectRate: number;
    samplerIntervalMs: number;
  };
}

const DEFAULT_HORIZON_MS = 8 * 60 * 60 * 1000; // 1 shift (8 h)

export function defaultDraft(): WizardDraft {
  return {
    presetId: "bottling-line",
    stations: [
      { id: "s1", label: "Filler", stationType: "machine", cycleMs: 800 },
      { id: "s2", label: "Capper", stationType: "machine", cycleMs: 1_200 },
      { id: "s3", label: "Labeler", stationType: "machine", cycleMs: 900 },
      { id: "s4", label: "Packer", stationType: "packaging", cycleMs: 1_000 },
    ],
    arrivalsPerMin: 60,
    horizonMs: DEFAULT_HORIZON_MS,
    realism: "realistic",
  };
}

/**
 * Shape variants the wizard understands. Each maps to a topology
 * builder later when commit() runs. The wizard doesn't store
 * positions — the host lays them out via runAutoLayout.
 */
export interface ShapeOption {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** Default station list for this shape. */
  readonly stations: readonly WizardStation[];
}

/**
 * VROL-820 — per-step validation. Each entry maps the wizard step index
 * to a struct that knows whether the step is valid, plus a per-field map
 * of error messages keyed by an opaque field id the step component knows
 * how to render under the offending input.
 *
 * Discriminated by the literal `step` so callers narrow on the index.
 */
export interface WizardStepValidation {
  readonly step: 0 | 1 | 2 | 3 | 4;
  readonly valid: boolean;
  /** field-id → human-readable error message; empty when valid. */
  readonly errors: Readonly<Record<string, string>>;
}

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Validate the shape step (step 0). The user must pick a preset.
 */
export function validateShape(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.presetId === null || draft.presetId === "") {
    errors["presetId"] = "Pick a starting shape to continue.";
  }
  return { step: 0, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate the stations step (step 1). At least one station, every
 * station must have a label and a positive cycle time.
 */
export function validateStations(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.stations.length < 1) {
    errors["count"] = "Add at least one station.";
  }
  draft.stations.forEach((s, i) => {
    if (s.label.trim() === "") {
      errors[`station-${String(i)}-label`] = "Station name can't be empty.";
    }
    if (!isFiniteNumber(s.cycleMs) || s.cycleMs <= 0) {
      errors[`station-${String(i)}-cycle`] = "Cycle time must be greater than 0 ms.";
    }
  });
  return { step: 1, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate the arrivals step (step 2). Source rate and run length both
 * must be positive finite numbers.
 */
export function validateArrivals(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (!isFiniteNumber(draft.arrivalsPerMin) || draft.arrivalsPerMin <= 0) {
    errors["arrivalsPerMin"] = "Arrival rate must be greater than 0 items per minute.";
  }
  if (!isFiniteNumber(draft.horizonMs) || draft.horizonMs <= 0) {
    errors["horizonMs"] = "Pick a run length.";
  }
  return { step: 2, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate the realism step (step 3). The realism level is a discriminated
 * union so it is always valid once defaulted, but we still expose the
 * predicate so the shell's gating loop is uniform.
 */
export function validateRealism(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.realism !== "simple" && draft.realism !== "realistic" && draft.realism !== "stress") {
    errors["realism"] = "Pick a realism level.";
  }
  return { step: 3, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Review step is read-only — always valid as long as the upstream
 * steps were valid. The shell still calls this to keep the indexing
 * consistent.
 */
export function validateReview(draft: WizardDraft): WizardStepValidation {
  const upstream = [
    validateShape(draft),
    validateStations(draft),
    validateArrivals(draft),
    validateRealism(draft),
  ];
  const errors: Record<string, string> = {};
  upstream.forEach((v) => {
    if (!v.valid) {
      errors[`step-${String(v.step)}`] = `Step ${String(v.step + 1)} has unresolved errors.`;
    }
  });
  return { step: 4, valid: Object.keys(errors).length === 0, errors };
}

export type WizardStepValidator = (draft: WizardDraft) => WizardStepValidation;

export const STEP_VALIDATORS: readonly WizardStepValidator[] = [
  validateShape,
  validateStations,
  validateArrivals,
  validateRealism,
  validateReview,
];

export const SHAPE_OPTIONS: readonly ShapeOption[] = [
  {
    id: "bottling-line",
    title: "Bottling line",
    blurb: "Sequential beverage line: Filler → Capper → Labeler → Packer.",
    stations: [
      { id: "s1", label: "Filler", stationType: "machine", cycleMs: 800 },
      { id: "s2", label: "Capper", stationType: "machine", cycleMs: 1_200 },
      { id: "s3", label: "Labeler", stationType: "machine", cycleMs: 900 },
      { id: "s4", label: "Packer", stationType: "packaging", cycleMs: 1_000 },
    ],
  },
  {
    id: "assembly-cell",
    title: "Assembly cell",
    blurb: "Hand-assembly + automated press + final assembly.",
    stations: [
      { id: "s1", label: "Sub-assembly", stationType: "manual", cycleMs: 4_000 },
      { id: "s2", label: "Press", stationType: "machine", cycleMs: 2_000 },
      { id: "s3", label: "Final assembly", stationType: "manual", cycleMs: 5_000 },
    ],
  },
  {
    id: "job-shop",
    title: "Job shop",
    blurb: "Three-machine queue: Cut → Drill → Inspect.",
    stations: [
      { id: "s1", label: "Cut", stationType: "machine", cycleMs: 30_000 },
      { id: "s2", label: "Drill", stationType: "machine", cycleMs: 45_000 },
      { id: "s3", label: "Inspect", stationType: "qc", cycleMs: 20_000 },
    ],
  },
  {
    id: "blank",
    title: "Start blank",
    blurb: "Empty canvas. Add stations from the palette later.",
    stations: [{ id: "s1", label: "Station 1", stationType: "machine", cycleMs: 1_000 }],
  },
];
