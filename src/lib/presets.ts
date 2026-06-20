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

// ─── 6. Source rate (VROL-656 — showcases VROL-648 finite-rate source) ─────
const SOURCE_RATE: Preset = {
  id: "source-rate",
  title: "Source rate",
  blurb:
    "Three-station line where the source only emits a part every 2 minutes. Stations idle between arrivals — throughput is gated by upstream supply, not station cycles.",
  highlight: "finite-rate source (inter-arrival)",
  graph: {
    nodes: [
      station("n1", "Source", "input", 60, 180, { cycleDistribution: constant(30) }),
      station("n2", "Filler", "machine", 260, 180, { cycleDistribution: constant(100) }),
      station("n3", "Capper", "machine", 460, 180, { cycleDistribution: constant(100) }),
      station("n4", "QC", "qc", 660, 180, { cycleDistribution: constant(50) }),
    ],
    edges: [edge("e1-2", "n1", "n2"), edge("e2-3", "n2", "n3"), edge("e3-4", "n3", "n4")],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    samplerIntervalMs: 1_000,
    source: { enabled: true, intervalMs: 120_000, batchSize: 1 },
  },
};

// ─── 7. Two-line shared packing (VROL-449) ──────────────────────────────────
const TWO_LINE_PACKING: Preset = {
  id: "two-line-packing",
  title: "Two-line shared packing",
  blurb:
    "Two parallel lines (Filler→Capper each) merge into a single Packer. Packer is the bottleneck — both upstream cappers compete for it.",
  highlight: "merge topology + downstream bottleneck",
  graph: {
    nodes: [
      // Single shared source feeds both lines (engine requires single source).
      station("src", "Source", "input", 60, 180, { cycleDistribution: constant(30) }),
      station("a2", "Filler A", "machine", 260, 80, { cycleDistribution: constant(120) }),
      station("a3", "Capper A", "machine", 440, 80, { cycleDistribution: constant(150) }),
      station("b2", "Filler B", "machine", 260, 280, { cycleDistribution: constant(120) }),
      station("b3", "Capper B", "machine", 440, 280, { cycleDistribution: constant(150) }),
      // Packer is intentionally slower — bottleneck where both lines merge.
      station("p", "Packer", "machine", 640, 180, { cycleDistribution: constant(220) }),
      station("o", "Output", "output", 840, 180, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("esrc-a2", "src", "a2"),
      edge("esrc-b2", "src", "b2"),
      edge("ea2-a3", "a2", "a3"),
      edge("ea3-p", "a3", "p"),
      edge("eb2-b3", "b2", "b3"),
      edge("eb3-p", "b3", "p"),
      edge("ep-o", "p", "o"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000 },
};

// ─── 8. Mixed-model job shop (VROL-452) ─────────────────────────────────────
const MIXED_MODEL_JOB_SHOP: Preset = {
  id: "mixed-model-job-shop",
  title: "Mixed-model job shop",
  blurb:
    "Three SKUs sharing one line. Cycle times + defect rates vary by product; changeovers between SKUs cost real time. Demonstrates per-product KPIs and the cost of variety.",
  highlight: "per-product cycles + asymmetric changeovers",
  graph: {
    nodes: [
      station("src", "Source", "input", 60, 160, { cycleDistribution: constant(40) }),
      station("op1", "Lathe", "machine", 260, 160, {
        cycleDistribution: constant(150),
        // Per-product cycle times — B is the hard one (heavier feature set).
        cycleByProduct: {
          A: constant(120),
          B: constant(220),
          C: constant(150),
        },
        // Changeover matrix: A↔B share toolpaths cheaply; C needs different fixture.
        changeoverMatrix: {
          A: { B: constant(300), C: constant(900) },
          B: { A: constant(300), C: constant(900) },
          C: { A: constant(900), B: constant(900) },
        },
      }),
      station("op2", "Mill", "machine", 460, 160, {
        cycleDistribution: constant(180),
        cycleByProduct: {
          A: constant(150),
          B: constant(200),
          C: constant(190),
        },
      }),
      station("qc", "QC", "qc", 660, 160, {
        cycleDistribution: constant(80),
        defectRate: 0.05,
      }),
      station("out", "Output", "output", 860, 160, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1", "src", "op1"),
      edge("e2", "op1", "op2"),
      edge("e3", "op2", "qc"),
      edge("e4", "qc", "out"),
    ],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    samplerIntervalMs: 1_000,
    horizonMs: 120_000,
    products: {
      enabled: true,
      list: [
        { id: "A", name: "Widget A", weight: 50 },
        { id: "B", name: "Widget B", weight: 30 },
        { id: "C", name: "Widget C", weight: 20 },
      ],
    },
  },
};

// ─── 9. Pharma packaging (VROL-455) ─────────────────────────────────────────
const PHARMA_PACKAGING: Preset = {
  id: "pharma-packaging",
  title: "Pharmaceutical packaging",
  blurb:
    "Validation-required workers on the QC stations; only certified staff can sign off batches. Shows how skill restrictions become the constraint when staffing is tight.",
  highlight: "skill-restricted assignment + double QC",
  graph: {
    nodes: [
      station("src", "Source", "input", 60, 160, { cycleDistribution: constant(30) }),
      station("fill", "Filler", "machine", 240, 160, { cycleDistribution: constant(100) }),
      station("cap", "Capper", "machine", 420, 160, { cycleDistribution: constant(100) }),
      // QC steps require certified skills.
      station("qc1", "QC visual", "qc", 600, 80, {
        cycleDistribution: constant(140),
        defectRate: 0.03,
        skills: ["qc-cert"],
      }),
      station("qc2", "QC seal", "qc", 600, 240, {
        cycleDistribution: constant(140),
        defectRate: 0.02,
        skills: ["qc-cert"],
      }),
      station("label", "Labeler", "machine", 800, 160, { cycleDistribution: constant(80) }),
      station("out", "Output", "output", 980, 160, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1", "src", "fill"),
      edge("e2", "fill", "cap"),
      edge("e3", "cap", "qc1"),
      edge("e4", "cap", "qc2"),
      edge("e5", "qc1", "label"),
      edge("e6", "qc2", "label"),
      edge("e7", "label", "out"),
    ],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    samplerIntervalMs: 1_000,
    workers: {
      enabled: true,
      list: [
        // Only ONE worker has the QC cert — both QC stations compete for them.
        { name: "Marcia (cert)", skills: ["qc-cert", "any"], shiftEndMs: 60_000 },
        { name: "James", skills: ["any"], shiftEndMs: 60_000 },
      ],
    },
  },
};

export const PRESETS: readonly Preset[] = [
  BOTTLING_LINE,
  MULTI_PRODUCT_CHANGEOVER,
  MAINTENANCE_BOUND,
  WORKER_BOTTLENECK,
  PARALLEL_FILLERS,
  SOURCE_RATE,
  TWO_LINE_PACKING,
  MIXED_MODEL_JOB_SHOP,
  PHARMA_PACKAGING,
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
