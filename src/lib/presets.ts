/**
 * Pre-built scenario presets (VROL-630).
 *
 * Each preset is a self-contained graph + run settings that exercises a
 * distinct engine feature. Landing-page chips + the Examples section of the
 * Scenarios drawer surface them. Loading a preset hands the user an editable
 * copy in their own scenarios store — presets themselves are read-only.
 *
 * The shape mirrors ScenarioPayload (minus savedAtMs) so a preset is a
 * drop-in for the existing scenario loader.
 */

import type { Edge, Node } from "@xyflow/react";

import { constant } from "@/engine";
import { DEFAULT_RUN_SETTINGS, type RunSettings } from "@/routes/editor-run-settings";

export interface Preset {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly highlight: string;
  readonly graph: { readonly nodes: Node[]; readonly edges: Edge[] };
  readonly settings: RunSettings;
}

function station(
  id: string,
  label: string,
  stationType: string,
  x: number,
  y: number,
  data: Record<string, unknown>,
): Node {
  return {
    id,
    type: "station",
    position: { x, y },
    data: { label, stationType, defectRate: 0, ...data },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

// ─── 1. Bottling line ───────────────────────────────────────────────────────
const BOTTLING_LINE: Preset = {
  id: "bottling-line",
  title: "Bottling line",
  blurb:
    "Diamond topology: two parallel fillers feed a slow capper, QC reworks defects back to the capper, plus a mid-run maintenance dip on Filler A.",
  highlight: "Branching + rework loop + maintenance",
  graph: {
    nodes: [
      station("n1", "Input", "input", 60, 180, { cycleDistribution: constant(30) }),
      station("n2", "Filler A", "machine", 240, 60, {
        cycleDistribution: constant(120),
        maintenanceWindows: [{ startMs: 30_000, endMs: 35_000 }],
      }),
      station("n3", "Filler B", "machine", 240, 300, { cycleDistribution: constant(130) }),
      station("n4", "Capper", "machine", 440, 180, {
        cycleDistribution: constant(180),
        setupDistribution: constant(40),
      }),
      station("n5", "QC", "qc", 640, 180, {
        cycleDistribution: constant(60),
        defectRate: 0.15,
        reworkTargetNodeId: "n4",
      }),
      station("n6", "Labeler", "machine", 840, 180, { cycleDistribution: constant(90) }),
      station("n7", "Packer", "output", 1040, 180, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1-2", "n1", "n2"),
      edge("e1-3", "n1", "n3"),
      edge("e2-4", "n2", "n4"),
      edge("e3-4", "n3", "n4"),
      edge("e4-5", "n4", "n5"),
      edge("e5-6", "n5", "n6"),
      edge("e6-7", "n6", "n7"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000 },
};

// ─── 2. Multi-product changeover ────────────────────────────────────────────
const MULTI_PRODUCT_CHANGEOVER: Preset = {
  id: "multi-product-changeover",
  title: "Multi-product changeover",
  blurb:
    "Two products (A 60% / B 40%) running on a 4-station chain. The Filler has a changeover matrix — A→B costs 800ms, B→A costs 500ms, same-product transitions are free.",
  highlight: "Multi-product mix + changeover matrix",
  graph: {
    nodes: [
      station("n1", "Mixer", "input", 60, 160, { cycleDistribution: constant(40) }),
      station("n2", "Filler", "machine", 280, 160, {
        cycleDistribution: constant(100),
        setupDistribution: constant(50),
        changeoverMatrix: {
          A: { B: constant(800) },
          B: { A: constant(500) },
        },
      }),
      station("n3", "Capper", "machine", 500, 160, { cycleDistribution: constant(120) }),
      station("n4", "Packer", "output", 720, 160, { cycleDistribution: constant(60) }),
    ],
    edges: [edge("e1-2", "n1", "n2"), edge("e2-3", "n2", "n3"), edge("e3-4", "n3", "n4")],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    samplerIntervalMs: 1_000,
    products: {
      enabled: true,
      list: [
        { id: "A", name: "Product A", weight: 60 },
        { id: "B", name: "Product B", weight: 40 },
      ],
    },
  },
};

// ─── 3. Maintenance-bound ───────────────────────────────────────────────────
const MAINTENANCE_BOUND: Preset = {
  id: "maintenance-bound",
  title: "Maintenance-bound",
  blurb:
    "A 3-station chain where the middle station eats two 8-second maintenance windows. Watch throughput collapse during each window on the chart.",
  highlight: "Planned maintenance windows",
  graph: {
    nodes: [
      station("n1", "Feeder", "input", 80, 160, { cycleDistribution: constant(50) }),
      station("n2", "Conditioner", "machine", 320, 160, {
        cycleDistribution: constant(100),
        maintenanceWindows: [
          { startMs: 15_000, endMs: 23_000 },
          { startMs: 40_000, endMs: 48_000 },
        ],
      }),
      station("n3", "Packer", "output", 560, 160, { cycleDistribution: constant(60) }),
    ],
    edges: [edge("e1-2", "n1", "n2"), edge("e2-3", "n2", "n3")],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 500 },
};

// ─── 4. Worker bottleneck ───────────────────────────────────────────────────
const WORKER_BOTTLENECK: Preset = {
  id: "worker-bottleneck",
  title: "Worker bottleneck",
  blurb:
    "Four stations all need a worker, but only two workers are on the floor (one knows capping, one knows labelling, both can do qc). Labor utilization caps the line.",
  highlight: "Workers + skills + labor utilization",
  graph: {
    nodes: [
      station("n1", "Input", "input", 60, 160, { cycleDistribution: constant(40) }),
      station("n2", "Capper", "machine", 260, 160, {
        cycleDistribution: constant(100),
        skills: ["cap"],
      }),
      station("n3", "Labeler", "machine", 460, 160, {
        cycleDistribution: constant(100),
        skills: ["label"],
      }),
      station("n4", "QC", "qc", 660, 160, {
        cycleDistribution: constant(80),
        skills: ["qc"],
      }),
      station("n5", "Packer", "output", 860, 160, { cycleDistribution: constant(50) }),
    ],
    edges: [
      edge("e1-2", "n1", "n2"),
      edge("e2-3", "n2", "n3"),
      edge("e3-4", "n3", "n4"),
      edge("e4-5", "n4", "n5"),
    ],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    samplerIntervalMs: 1_000,
    workers: {
      enabled: true,
      list: [
        { name: "Alex", skills: ["cap", "qc"], shiftEndMs: 60_000 },
        { name: "Sam", skills: ["label", "qc"], shiftEndMs: 60_000 },
      ],
    },
  },
};

// ─── 5. Parallel fillers (VROL-649 — showcases VROL-646 capacity > 1) ───────
const PARALLEL_FILLERS: Preset = {
  id: "parallel-fillers",
  title: "Parallel fillers",
  blurb:
    "Source → three parallel fillers (one node, capacity 3) → fast capper → QC. The Filler's parallel cycles match the Capper's higher rate so neither side bottlenecks.",
  highlight: "capacity > 1 (parallel cycles)",
  graph: {
    nodes: [
      station("n1", "Source", "input", 60, 180, { cycleDistribution: constant(30) }),
      station("n2", "Filler", "machine", 260, 180, {
        cycleDistribution: constant(300),
        capacity: 3,
      }),
      station("n3", "Capper", "machine", 460, 180, { cycleDistribution: constant(100) }),
      station("n4", "QC", "qc", 660, 180, { cycleDistribution: constant(50) }),
    ],
    edges: [edge("e1-2", "n1", "n2"), edge("e2-3", "n2", "n3"), edge("e3-4", "n3", "n4")],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000 },
};

export const PRESETS: readonly Preset[] = [
  BOTTLING_LINE,
  MULTI_PRODUCT_CHANGEOVER,
  MAINTENANCE_BOUND,
  WORKER_BOTTLENECK,
  PARALLEL_FILLERS,
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

const PENDING_PRESET_KEY = "vrolen.pending-preset";

/**
 * Landing page → editor handoff. The landing page writes a preset id here
 * and navigates to /editor; the editor reads + clears the key on mount and
 * loads that preset's graph + settings.
 */
export function setPendingPreset(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem?.(PENDING_PRESET_KEY, id);
  } catch {
    // sessionStorage unavailable — nav still happens; editor just shows the default.
  }
}

export function consumePendingPreset(): Preset | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const id = window.sessionStorage?.getItem?.(PENDING_PRESET_KEY) ?? null;
    if (!id) return undefined;
    window.sessionStorage?.removeItem?.(PENDING_PRESET_KEY);
    return getPreset(id);
  } catch {
    return undefined;
  }
}
