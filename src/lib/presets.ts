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

import { constant, type Distribution } from "@/engine";
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

// ─── 10. Bakery / food processing (VROL-458) ────────────────────────────────
const BAKERY: Preset = {
  id: "bakery",
  title: "Bakery line",
  blurb:
    "Mixer → Shape → Proof → Oven (capacity 4, slow cycle) → Cool → Pack. The oven runs four trays in parallel — shifts the bottleneck from cycle to dough handling.",
  highlight: "batch oven via capacity > 1",
  graph: {
    nodes: [
      station("mix", "Mixer", "input", 60, 160, { cycleDistribution: constant(120) }),
      station("shape", "Shape", "manual", 240, 160, { cycleDistribution: constant(60) }),
      station("proof", "Proof", "machine", 420, 160, { cycleDistribution: constant(180) }),
      // The oven: long cycle but bakes 4 trays in parallel.
      station("oven", "Oven", "machine", 600, 160, {
        cycleDistribution: constant(800),
        capacity: 4,
      }),
      station("cool", "Cool", "machine", 780, 160, { cycleDistribution: constant(150) }),
      station("pack", "Pack", "output", 960, 160, { cycleDistribution: constant(50) }),
    ],
    edges: [
      edge("e1", "mix", "shape"),
      edge("e2", "shape", "proof"),
      edge("e3", "proof", "oven"),
      edge("e4", "oven", "cool"),
      edge("e5", "cool", "pack"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 120_000 },
};

// ─── 11. Electronics SMT line (VROL-461) ────────────────────────────────────
const ELECTRONICS: Preset = {
  id: "electronics-smt",
  title: "Electronics SMT line",
  blurb:
    "Pick-and-place → reflow oven (cap 3, 400ms) → AOI inspection (15% defects route back to rework) → functional test → pack. Watch the rework loop bunch up at the inspector.",
  highlight: "rework loop + parallel reflow",
  graph: {
    nodes: [
      station("src", "Source", "input", 60, 160, { cycleDistribution: constant(40) }),
      station("pnp", "Pick & place", "machine", 240, 160, { cycleDistribution: constant(90) }),
      station("reflow", "Reflow", "machine", 420, 160, {
        cycleDistribution: constant(400),
        capacity: 3,
      }),
      // AOI flags defects; failed boards route to manual rework.
      station("aoi", "AOI", "qc", 600, 160, {
        cycleDistribution: constant(80),
        defectRate: 0.15,
        reworkTargetNodeId: "rework",
      }),
      station("rework", "Rework", "manual", 420, 320, { cycleDistribution: constant(180) }),
      station("test", "Functional test", "qc", 780, 160, {
        cycleDistribution: constant(120),
        defectRate: 0.03,
      }),
      station("pack", "Pack", "output", 960, 160, { cycleDistribution: constant(40) }),
    ],
    edges: [
      edge("e1", "src", "pnp"),
      edge("e2", "pnp", "reflow"),
      edge("e3", "reflow", "aoi"),
      edge("e4", "aoi", "test"),
      edge("e5", "test", "pack"),
      // Rework loops back to AOI so reworked boards get re-inspected.
      edge("e6", "rework", "aoi"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 90_000 },
};

// ─── 12. Beverage canning line (VROL-736) ──────────────────────────────────
const BEVERAGE_CANNING: Preset = {
  id: "beverage-canning",
  title: "Beverage canning line",
  blurb:
    "Filler → seamer → labeller → tray packer with breakdowns on the seamer. Demonstrates how a moderately-failing station drags the entire line.",
  highlight: "breakdowns on a critical station",
  graph: {
    nodes: [
      station("src", "Source", "input", 60, 200, { cycleDistribution: constant(60) }),
      station("fill", "Filler", "machine", 220, 200, { cycleDistribution: constant(90) }),
      station("seam", "Seamer", "machine", 380, 200, {
        cycleDistribution: constant(110),
        mtbfMs: 120_000,
        mttrMs: 20_000,
      }),
      station("label", "Labeller", "machine", 540, 200, { cycleDistribution: constant(80) }),
      station("pack", "Tray pack", "output", 700, 200, { cycleDistribution: constant(120) }),
    ],
    edges: [
      edge("e1", "src", "fill"),
      edge("e2", "fill", "seam"),
      edge("e3", "seam", "label"),
      edge("e4", "label", "pack"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 120_000 },
};

// ─── 13. Assembly cell (VROL-737) ──────────────────────────────────────────
const ASSEMBLY_CELL: Preset = {
  id: "assembly-cell",
  title: "Assembly cell",
  blurb:
    "Manual sub-assembly → automated press → manual final assembly. The two manual cells starve the press; shows how worker pacing shapes throughput.",
  highlight: "manual + automated mix",
  graph: {
    nodes: [
      station("src", "Source", "input", 60, 200, { cycleDistribution: constant(120) }),
      station("sub", "Manual sub-asm", "manual", 220, 200, { cycleDistribution: constant(240) }),
      station("press", "Press", "machine", 400, 200, {
        cycleDistribution: constant(60),
        capacity: 1,
      }),
      station("final", "Manual final", "manual", 580, 200, { cycleDistribution: constant(220) }),
      station("out", "Done", "output", 760, 200, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1", "src", "sub"),
      edge("e2", "sub", "press"),
      edge("e3", "press", "final"),
      edge("e4", "final", "out"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 120_000 },
};

// VROL-937 — Unilever-style shampoo line exercising the Sprint 90-92
// engine breadth: BOM feeders on the fill station (needs 2 caps per
// bottle), shared autoclave tool pool, per-SKU label routing for two
// shampoo variants. Reproduces the "all stations 100 % running but only
// one at nominal" case discussed in VROL-899/900.
//
// VROL-969 — every station now samples its cycle from a triangular
// distribution (CoV ~10-15 %) and the Filler + Capper have MTBF/MTTR so
// the demo actually exercises the stochastic + reliability paths. A
// previous all-constant() version produced a deterministic sawtooth that
// a reviewer could mistake for the engine being naive.
const tri = (min: number, mode: number, max: number): Distribution => ({
  kind: "triangular",
  min,
  mode,
  max,
});

const SHAMPOO_LINE: Preset = {
  id: "shampoo-line",
  title: "Shampoo line",
  blurb:
    "Unilever-style FMCG line: mix → fill (BOM: 2 caps/cycle) → cap → label (split by SKU) → pack → palletise. Autoclave tool pool shared between mix + cap (capacity 1) creates serialised contention. Stochastic cycle times + Filler/Capper breakdowns.",
  highlight: "BOM + tool pool + per-SKU + stochastic",
  graph: {
    nodes: [
      station("src", "Bulk in", "input", 40, 200, { cycleDistribution: tri(50, 60, 75) }),
      station("cap-feeder", "Cap feeder", "machine", 200, 80, {
        cycleDistribution: tri(32, 40, 52),
      }),
      station("mix", "Mix tank", "machine", 200, 320, {
        cycleDistribution: tri(65, 80, 100),
        requiredToolPool: "autoclave",
      }),
      station("fill", "Filler", "machine", 380, 200, {
        cycleDistribution: tri(58, 70, 88),
        bomFeeders: [{ feederStationId: "cap-feeder", qtyPerCycle: 2 }],
      }),
      station("cap", "Capper", "machine", 540, 200, {
        cycleDistribution: tri(50, 60, 78),
        requiredToolPool: "autoclave",
      }),
      station("label-family", "Family label", "machine", 700, 120, {
        cycleDistribution: tri(42, 50, 62),
      }),
      station("label-kids", "Kids label", "machine", 700, 280, {
        cycleDistribution: tri(58, 70, 88),
      }),
      station("pack", "Packer", "machine", 880, 200, {
        cycleDistribution: tri(38, 45, 58),
        perSkuRouting: {
          "family-shampoo": "label-family",
          "kids-shampoo": "label-kids",
        },
      }),
      station("pallet", "Palletise", "output", 1050, 200, {
        cycleDistribution: tri(34, 40, 52),
      }),
    ],
    edges: [
      edge("e1", "src", "cap-feeder"),
      edge("e2", "src", "mix"),
      edge("e3", "mix", "fill"),
      edge("e4", "cap-feeder", "fill"),
      edge("e5", "fill", "cap"),
      edge("e6", "cap", "pack"),
      edge("e7", "label-family", "pallet"),
      edge("e8", "label-kids", "pallet"),
      edge("e9", "pack", "pallet"),
    ],
  },
  settings: {
    ...DEFAULT_RUN_SETTINGS,
    horizonMs: 120_000,
    samplerIntervalMs: 1_000,
    // VROL-969 — line-wide breakdowns so Filler/Capper actually fail
    // over a 2-minute horizon (MTBF 30s for visibility on the demo;
    // production scenarios would use minute-scale numbers).
    breakdowns: {
      enabled: true,
      mtbfMs: 30_000,
      mttrMs: 4_000,
    },
    toolPools: [{ name: "autoclave", capacity: 1 }],
    products: {
      enabled: true,
      list: [
        { id: "family-shampoo", name: "Family Shampoo", weight: 60 },
        { id: "kids-shampoo", name: "Kids Shampoo", weight: 40 },
      ],
    },
  },
};

// VROL-1005 — conveyor showcase. 5-station bottling layout with a real
// conveyor between Filler and Capper. The conveyor's lengthM/speedMps
// flow through graph-to-chain into ChainOptions.bufferDelayMs[],
// modeling a 5s transit between the two stations. Demonstrates the
// Sprint 112-115 conveyor work end-to-end in a realistic scenario.
const CONVEYOR_LINE: Preset = {
  id: "conveyor-line",
  title: "Conveyor between stations",
  blurb:
    "Filler → 10m conveyor at 2 m/s → Capper → out. The conveyor adds a real 5-second residence time between the two stations; watch the first part appear at the Capper only after the conveyor fills.",
  highlight: "transport / residence-time conveyor",
  graph: {
    nodes: [
      station("src", "Source", "input", 40, 200, { cycleDistribution: constant(80) }),
      station("filler", "Filler", "machine", 220, 200, { cycleDistribution: constant(600) }),
      station("conv", "Conveyor", "transport", 400, 200, {
        cycleDistribution: constant(1),
        lengthM: 10,
        speedMps: 2,
      }),
      station("capper", "Capper", "machine", 580, 200, { cycleDistribution: constant(600) }),
      station("out", "Done", "output", 760, 200, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1", "src", "filler"),
      edge("e2", "filler", "conv"),
      edge("e3", "conv", "capper"),
      edge("e4", "capper", "out"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 120_000 },
};

// VROL-1006 — UoM-aware dairy line showcasing the per-station unit
// label from VROL-867 v1. Every station declares unit="kg" so the
// result-panel throughput chip reads "X kg / hour" instead of the
// default "parts / hour". A reasonable approximation of a fluid-
// processing line: raw milk arrives, passes through pasteurization
// + separation + homogenization + filling, and exits.
const DAIRY_LINE: Preset = {
  id: "dairy-line",
  title: "Dairy line (kg)",
  blurb:
    "Bulk-fluid processing line: raw milk → pasteurizer → separator → homogenizer → filler. Every station declares unit='kg' AND unitsPerPart=0.5, so 1000 parts/h displays as 500 kg/h — the first preset that exercises both UoM v1 (label) and v2 (ratio).",
  highlight: "unit-of-measure: kg / hour at 0.5 kg/part",
  graph: {
    nodes: [
      station("src", "Raw milk", "input", 40, 200, {
        cycleDistribution: constant(200),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
      station("pasteurizer", "Pasteurizer", "machine", 220, 200, {
        cycleDistribution: constant(900),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
      station("separator", "Separator", "machine", 400, 200, {
        cycleDistribution: constant(450),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
      station("homogenizer", "Homogenizer", "machine", 580, 200, {
        cycleDistribution: constant(400),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
      station("filler", "Filler", "machine", 760, 200, {
        cycleDistribution: constant(350),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
      station("out", "Done", "output", 940, 200, {
        cycleDistribution: constant(50),
        unit: "kg",
        unitsPerPart: 0.5,
      }),
    ],
    edges: [
      edge("e1", "src", "pasteurizer"),
      edge("e2", "pasteurizer", "separator"),
      edge("e3", "separator", "homogenizer"),
      edge("e4", "homogenizer", "filler"),
      edge("e5", "filler", "out"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 120_000 },
};

// VROL-889 v1 — 3D-print build-plate batching. The "printer" station
// holds off until 10 parts have queued up, then runs one 20s print
// cycle that emits 10 parts at completion. The post-process station
// then drains them one at a time. Demonstrates the batch-fire engine
// addition end-to-end.
const PRINT_BATCH_LINE: Preset = {
  id: "print-batch-line",
  title: "3D-print batch (build plate)",
  blurb:
    "Additive workflow: parts queue up at the printer until a 10-piece build plate is full, then one 20-second print cycle emits all 10 together. Post-process drains them. Throughput is set by the plate fill rate + print time, not the slowest individual cycle.",
  highlight: "batch-fire / build-plate",
  graph: {
    nodes: [
      station("src", "Source", "input", 40, 200, { cycleDistribution: constant(80) }),
      station("prep", "Prep tray", "machine", 220, 200, { cycleDistribution: constant(500) }),
      station("printer", "3D printer", "machine", 400, 200, {
        cycleDistribution: constant(20_000),
        batchSize: 10,
      }),
      station("post", "Post-process", "machine", 580, 200, { cycleDistribution: constant(300) }),
      station("out", "Done", "output", 760, 200, { cycleDistribution: constant(30) }),
    ],
    edges: [
      edge("e1", "src", "prep"),
      edge("e2", "prep", "printer"),
      edge("e3", "printer", "post"),
      edge("e4", "post", "out"),
    ],
  },
  settings: { ...DEFAULT_RUN_SETTINGS, samplerIntervalMs: 1_000, horizonMs: 180_000 },
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
  BAKERY,
  ELECTRONICS,
  BEVERAGE_CANNING,
  ASSEMBLY_CELL,
  SHAMPOO_LINE,
  CONVEYOR_LINE,
  DAIRY_LINE,
  PRINT_BATCH_LINE,
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

const PENDING_PRESET_KEY = "vrolen.pending-preset";
const PENDING_AUTORUN_KEY = "vrolen.pending-autorun";

/**
 * Landing page → editor handoff. The landing page writes a preset id here
 * and navigates to /editor; the editor reads + clears the key on mount and
 * loads that preset's graph + settings.
 *
 * Optional `autorun` flag fires the simulation as soon as the preset loads
 * — used by the demo CTA so the first-time visitor sees results on first
 * interaction instead of an empty canvas (VROL-816).
 */
export function setPendingPreset(id: string, opts?: { autorun?: boolean }): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem?.(PENDING_PRESET_KEY, id);
    if (opts?.autorun) {
      window.sessionStorage?.setItem?.(PENDING_AUTORUN_KEY, "1");
    } else {
      window.sessionStorage?.removeItem?.(PENDING_AUTORUN_KEY);
    }
  } catch {
    // sessionStorage unavailable — nav still happens; editor just shows the default.
  }
}

export function consumePendingPreset(): { preset: Preset; autorun: boolean } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const id = window.sessionStorage?.getItem?.(PENDING_PRESET_KEY) ?? null;
    if (!id) return undefined;
    const autorun = window.sessionStorage?.getItem?.(PENDING_AUTORUN_KEY) === "1";
    window.sessionStorage?.removeItem?.(PENDING_PRESET_KEY);
    window.sessionStorage?.removeItem?.(PENDING_AUTORUN_KEY);
    const preset = getPreset(id);
    if (!preset) return undefined;
    return { preset, autorun };
  } catch {
    return undefined;
  }
}
