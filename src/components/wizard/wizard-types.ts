/**
 * Wizard draft state — the canonical in-progress scenario the wizard
 * builds up across its 5 steps. The shell holds this state; each step
 * reads + mutates it via a single `update(partial)` callback so step
 * components remain pure.
 *
 * Commit-time the host transforms the draft into:
 *   - canvas nodes + edges (via shape preset + per-station cycle edits)
 *   - RunSettings (horizon, source rate, realism toggles)
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
