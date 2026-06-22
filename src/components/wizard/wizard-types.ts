/**
 * Wizard draft state — the canonical in-progress scenario the wizard
 * builds up across its 8 steps. The shell holds this state; each step
 * reads + mutates it via a single `update(partial)` callback so step
 * components remain pure.
 *
 * Commit-time the host transforms the draft into:
 *   - canvas nodes + edges (via shape + per-station data)
 *   - RunSettings patch (horizon, source rate, realism, materials, …)
 *
 * VROL-820 — exposes per-step validation predicates so the shell can
 * gate the Next button and steps can render inline error messages.
 *
 * VROL-871 — rebuilt from 5 → 8 steps so the wizard authors a complete,
 * runnable scenario without dropping into Inspector for distributions,
 * connections, products, changeovers, maintenance, workers, materials,
 * or the full run window.
 */

import type { Edge, Node } from "@xyflow/react";

import { constant, type Distribution } from "@/engine";

export type RealismLevel = "simple" | "realistic" | "stress";

/** Shape variants the wizard understands. */
export type ShapeKind = "single-line" | "two-lines" | "branching" | "custom";

export interface WizardStation {
  /** Stable identifier (kept while user is editing). */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Engine station type — machine / qc / buffer / etc. */
  readonly stationType: string;
  /** Cycle-time distribution. Mean is derived for display. */
  readonly cycleDistribution: Distribution;
  /** Parallel cycle capacity (1..10). */
  readonly parallelCapacity: number;
  /** Per-station defect rate (0..1). */
  readonly defectRate: number;
  /** Optional setup / changeover distribution; null disables setup. */
  readonly setupDistribution: Distribution | null;
  /** Per-station required skill (worker-routing). Empty disables. */
  readonly requiredSkill: string;
  /** Maintenance windows applied to this station. */
  readonly maintenanceWindows: readonly { readonly startMs: number; readonly endMs: number }[];
  /** Defects from this station route here (node id) instead of scrap. */
  readonly reworkTargetId: string | null;
  /** Max rework passes before scrap. */
  readonly reworkPassLimit: number;
}

export interface WizardConnection {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
}

export interface WizardProduct {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}

/**
 * Per-station per-product cycle override:
 *   perProductCycles[stationId][productId] = Distribution
 */
export type PerProductCycles = Readonly<Record<string, Readonly<Record<string, Distribution>>>>;

/**
 * Per-station changeover matrix:
 *   changeoverMatrices[stationId][fromProductId][toProductId] = Distribution
 */
export type ChangeoverMatrices = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, Distribution>>>>>
>;

export interface WizardWorker {
  readonly name: string;
  readonly shiftEndMs: number;
  readonly skills: readonly string[];
}

export interface WizardMaterials {
  readonly enabled: boolean;
  readonly bottles: number;
  readonly caps: number;
  readonly bottlesPerPart: number;
  readonly capsPerPart: number;
  readonly replenishment: {
    readonly enabled: boolean;
    readonly atMs: number;
    readonly amount: number;
  };
  readonly recurring: readonly {
    readonly material: "bottles" | "caps";
    readonly amount: number;
    readonly intervalMs: number;
    readonly maxInventory?: number;
  }[];
}

export interface WizardArrivals {
  readonly enabled: boolean;
  readonly interArrivalDist: Distribution;
  readonly batchSize: number;
}

export interface WizardBreakdowns {
  readonly enabled: boolean;
  readonly mtbfMs: number;
  readonly mttrMs: number;
}

export interface WizardRunWindow {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly interStationBufferCapacity: number;
  readonly replications: number;
  /** When 0 the sampler is off. */
  readonly samplerIntervalMs: number;
}

export interface WizardDraft {
  /**
   * Shape kind chosen on step 1.
   *
   * VROL-821 — defaults to `null` so the picker shows no selection until
   * the user explicitly clicks a card. `validateShape` blocks Next while
   * this is null.
   */
  readonly shapeKind: ShapeKind | null;
  /** Stations the wizard is composing. */
  readonly stations: readonly WizardStation[];
  /** Edges authored on step 3. */
  readonly connections: readonly WizardConnection[];
  /** Products step — gated by `productsEnabled`. */
  readonly productsEnabled: boolean;
  readonly products: readonly WizardProduct[];
  readonly perProductCycles: PerProductCycles;
  readonly changeoverMatrices: ChangeoverMatrices;
  /** Realism block — breakdowns, workers. */
  readonly breakdowns: WizardBreakdowns;
  readonly workersEnabled: boolean;
  readonly workers: readonly WizardWorker[];
  /** Arrivals + materials. */
  readonly arrivals: WizardArrivals;
  readonly materials: WizardMaterials;
  /** Run window. */
  readonly runWindow: WizardRunWindow;
  /** Realism preset (kept for back-compat with commit-draft). */
  readonly realism: RealismLevel;
}

export interface WizardCommit {
  readonly nodes: Node[];
  readonly edges: Edge[];
  /** Overrides to apply on top of DEFAULT_RUN_SETTINGS. */
  readonly settingsPatch: {
    horizonMs: number;
    warmupMs: number;
    seed: number;
    interStationBufferCapacity: number;
    replications: number;
    source: { enabled: boolean; intervalMs: number; batchSize: number };
    breakdowns?: { enabled: boolean; mtbfMs: number; mttrMs: number };
    /** Default per-station defect rate (used as a fallback). */
    defaultDefectRate: number;
    samplerIntervalMs: number;
    products?: {
      enabled: boolean;
      list: { id: string; name: string; weight: number }[];
    };
    workers?: {
      enabled: boolean;
      list: { name: string; skills: string[]; shiftEndMs: number }[];
    };
    materials?: {
      enabled: boolean;
      bottles: number;
      caps: number;
      bottlesPerPart: number;
      capsPerPart: number;
      replenishment: { enabled: boolean; atMs: number; amount: number };
      recurring: {
        material: "bottles" | "caps";
        amount: number;
        intervalMs: number;
        maxInventory?: number;
      }[];
    };
  };
}

const DEFAULT_HORIZON_MS = 8 * 60 * 60 * 1000; // 1 shift (8 h)
const DEFAULT_WARMUP_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_SEED = 0xc0ffee;
const DEFAULT_BUFFER_CAP = 10;

function defaultStation(
  id: string,
  label: string,
  stationType: string,
  cycleMs: number,
): WizardStation {
  return {
    id,
    label,
    stationType,
    cycleDistribution: constant(cycleMs),
    parallelCapacity: 1,
    defectRate: 0,
    setupDistribution: null,
    requiredSkill: "",
    maintenanceWindows: [],
    reworkTargetId: null,
    reworkPassLimit: 3,
  };
}

export function defaultDraft(): WizardDraft {
  const stations: WizardStation[] = [
    defaultStation("s1", "Filler", "machine", 800),
    defaultStation("s2", "Capper", "machine", 1_200),
    defaultStation("s3", "Labeler", "machine", 900),
    defaultStation("s4", "Packer", "packaging", 1_000),
  ];
  return {
    // VROL-821 — no silent preselect. The user must click a shape card on
    // step 1; the stations/connections list above is a placeholder, only
    // committed once a card is picked (the picker rebuilds both lists
    // from the chosen preset).
    shapeKind: null,
    stations,
    connections: linearConnections(stations),
    productsEnabled: false,
    products: [
      { id: "A", name: "Product A", weight: 60 },
      { id: "B", name: "Product B", weight: 40 },
    ],
    perProductCycles: {},
    changeoverMatrices: {},
    breakdowns: { enabled: true, mtbfMs: 30 * 60 * 1000, mttrMs: 5 * 60 * 1000 },
    workersEnabled: false,
    workers: [{ name: "Worker 1", shiftEndMs: DEFAULT_HORIZON_MS, skills: ["any"] }],
    arrivals: { enabled: true, interArrivalDist: constant(1_000), batchSize: 1 },
    materials: {
      enabled: false,
      bottles: 1000,
      caps: 1000,
      bottlesPerPart: 1,
      capsPerPart: 1,
      replenishment: { enabled: false, atMs: 10_000, amount: 500 },
      recurring: [],
    },
    runWindow: {
      horizonMs: DEFAULT_HORIZON_MS,
      warmupMs: DEFAULT_WARMUP_MS,
      seed: DEFAULT_SEED,
      interStationBufferCapacity: DEFAULT_BUFFER_CAP,
      replications: 1,
      samplerIntervalMs: 0,
    },
    realism: "realistic",
  };
}

/** Build a straight-line edge list for the given stations. */
export function linearConnections(stations: readonly WizardStation[]): WizardConnection[] {
  const out: WizardConnection[] = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const src = stations[i];
    const dst = stations[i + 1];
    if (!src || !dst) continue;
    out.push({ id: `e${String(i + 1)}`, sourceId: src.id, targetId: dst.id });
  }
  return out;
}

/**
 * Shape preset metadata used by step 1's picker. Each kind also has a
 * builder for the initial station list when the user picks it.
 */
export interface ShapePreset {
  readonly kind: ShapeKind;
  readonly title: string;
  readonly blurb: string;
  /** Build a fresh station list for this shape. */
  buildStations(): WizardStation[];
  /** Build the matching connection list. */
  buildConnections(stations: readonly WizardStation[]): WizardConnection[];
}

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  {
    kind: "single-line",
    title: "Single line",
    blurb: "Sequential stations feeding one sink.",
    buildStations: () => [
      defaultStation("s1", "Filler", "machine", 800),
      defaultStation("s2", "Capper", "machine", 1_200),
      defaultStation("s3", "Labeler", "machine", 900),
      defaultStation("s4", "Packer", "packaging", 1_000),
    ],
    buildConnections: linearConnections,
  },
  {
    kind: "two-lines",
    title: "Two parallel lines",
    blurb: "Two independent lines that merge into a shared packer.",
    buildStations: () => [
      defaultStation("a1", "Line A · machine", "machine", 1_000),
      defaultStation("a2", "Line A · QC", "qc", 800),
      defaultStation("b1", "Line B · machine", "machine", 1_100),
      defaultStation("b2", "Line B · QC", "qc", 850),
      defaultStation("p", "Shared packer", "packaging", 600),
    ],
    buildConnections: (s) => {
      const get = (id: string) => s.find((x) => x.id === id);
      const out: WizardConnection[] = [];
      const pairs: [string, string][] = [
        ["a1", "a2"],
        ["b1", "b2"],
        ["a2", "p"],
        ["b2", "p"],
      ];
      pairs.forEach(([a, b], i) => {
        if (get(a) && get(b)) out.push({ id: `e${String(i + 1)}`, sourceId: a, targetId: b });
      });
      return out;
    },
  },
  {
    kind: "branching",
    title: "Branching DAG",
    blurb: "One source splits into two parallel branches, then merges.",
    buildStations: () => [
      defaultStation("s1", "Intake", "input", 500),
      defaultStation("s2", "Branch A", "machine", 900),
      defaultStation("s3", "Branch B", "machine", 1_100),
      defaultStation("s4", "Final QC", "qc", 600),
    ],
    buildConnections: (s) => {
      const ids = s.map((x) => x.id);
      const out: WizardConnection[] = [];
      if (ids.length >= 4) {
        out.push({ id: "e1", sourceId: ids[0]!, targetId: ids[1]! });
        out.push({ id: "e2", sourceId: ids[0]!, targetId: ids[2]! });
        out.push({ id: "e3", sourceId: ids[1]!, targetId: ids[3]! });
        out.push({ id: "e4", sourceId: ids[2]!, targetId: ids[3]! });
      }
      return out;
    },
  },
  {
    kind: "custom",
    title: "Start blank",
    blurb: "One station, no edges. Build the rest from scratch.",
    buildStations: () => [defaultStation("s1", "Station 1", "machine", 1_000)],
    buildConnections: () => [],
  },
];

/* ----------------------------- validation -------------------------------- */

/**
 * Per-step validation result. Discriminated by `step` so callers narrow on
 * the index. Errors are keyed by an opaque field id the step renders.
 */
export interface WizardStepValidation {
  readonly step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly valid: boolean;
  /** field-id → human-readable error message; empty when valid. */
  readonly errors: Readonly<Record<string, string>>;
}

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

export function validateShape(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  const kinds: ShapeKind[] = ["single-line", "two-lines", "branching", "custom"];
  if (draft.shapeKind === null || !kinds.includes(draft.shapeKind)) {
    errors["shapeKind"] = "Pick a starting shape to continue.";
  }
  return { step: 0, valid: Object.keys(errors).length === 0, errors };
}

export function validateStations(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.stations.length < 1) {
    errors["count"] = "Add at least one station.";
  }
  draft.stations.forEach((s, i) => {
    if (s.label.trim() === "") {
      errors[`station-${String(i)}-label`] = "Station name can't be empty.";
    }
    if (!isFiniteNumber(s.parallelCapacity) || s.parallelCapacity < 1 || s.parallelCapacity > 10) {
      errors[`station-${String(i)}-capacity`] = "Parallel capacity must be between 1 and 10.";
    }
    if (!isFiniteNumber(s.defectRate) || s.defectRate < 0 || s.defectRate > 1) {
      errors[`station-${String(i)}-defect`] = "Defect rate must be between 0 and 1.";
    }
  });
  return { step: 1, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate the connections step — every station except the source must
 * have at least one incoming edge; every station except the sink must
 * have at least one outgoing edge; single source + single sink (engine
 * requirement).
 */
export function validateConnections(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  const ids = new Set(draft.stations.map((s) => s.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  draft.connections.forEach((e, i) => {
    if (!ids.has(e.sourceId) || !ids.has(e.targetId)) {
      errors[`edge-${String(i)}`] = "Edge references a station that no longer exists.";
      return;
    }
    if (e.sourceId === e.targetId) {
      errors[`edge-${String(i)}`] = "Self-loops aren't allowed.";
      return;
    }
    outgoing.set(e.sourceId, (outgoing.get(e.sourceId) ?? 0) + 1);
    incoming.set(e.targetId, (incoming.get(e.targetId) ?? 0) + 1);
  });
  if (draft.stations.length > 1) {
    const sources = draft.stations.filter((s) => (incoming.get(s.id) ?? 0) === 0);
    const sinks = draft.stations.filter((s) => (outgoing.get(s.id) ?? 0) === 0);
    if (sources.length === 0) {
      errors["sources"] = "Pick exactly one starting station — every edge points somewhere.";
    } else if (sources.length > 1) {
      errors["sources"] = "Only one starting station is allowed (single source).";
    }
    if (sinks.length === 0) {
      errors["sinks"] = "Pick exactly one ending station — no cycles allowed.";
    } else if (sinks.length > 1) {
      errors["sinks"] = "Only one ending station is allowed (single sink).";
    }
  }
  return { step: 2, valid: Object.keys(errors).length === 0, errors };
}

export function validateProducts(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (!draft.productsEnabled) {
    return { step: 3, valid: true, errors };
  }
  if (draft.products.length < 1) {
    errors["count"] = "Add at least one product, or turn off multi-product mode.";
  }
  const seen = new Set<string>();
  draft.products.forEach((p, i) => {
    if (p.id.trim() === "") errors[`product-${String(i)}-id`] = "Product id can't be empty.";
    if (p.name.trim() === "") errors[`product-${String(i)}-name`] = "Product name can't be empty.";
    if (!isFiniteNumber(p.weight) || p.weight <= 0)
      errors[`product-${String(i)}-weight`] = "Weight must be greater than 0.";
    if (seen.has(p.id)) errors[`product-${String(i)}-id`] = "Product ids must be unique.";
    seen.add(p.id);
  });
  return { step: 3, valid: Object.keys(errors).length === 0, errors };
}

export function validateRealism(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.breakdowns.enabled) {
    if (!isFiniteNumber(draft.breakdowns.mtbfMs) || draft.breakdowns.mtbfMs <= 0) {
      errors["mtbf"] = "MTBF must be greater than 0 ms.";
    }
    if (!isFiniteNumber(draft.breakdowns.mttrMs) || draft.breakdowns.mttrMs <= 0) {
      errors["mttr"] = "MTTR must be greater than 0 ms.";
    }
  }
  if (draft.workersEnabled) {
    if (draft.workers.length < 1)
      errors["workers"] = "Add at least one worker, or turn off workers.";
    draft.workers.forEach((w, i) => {
      if (w.name.trim() === "") errors[`worker-${String(i)}-name`] = "Worker name can't be empty.";
      if (!isFiniteNumber(w.shiftEndMs) || w.shiftEndMs <= 0)
        errors[`worker-${String(i)}-shift`] = "Shift end must be greater than 0 ms.";
    });
  }
  // Per-station rework target reachability is a soft check — surface a warning
  // string in errors but still allow advance. Strict check happens in review.
  draft.stations.forEach((s, i) => {
    if (s.reworkTargetId && !draft.stations.some((x) => x.id === s.reworkTargetId)) {
      errors[`station-${String(i)}-rework`] =
        "Rework target points at a station that no longer exists.";
    }
  });
  return { step: 4, valid: Object.keys(errors).length === 0, errors };
}

export function validateArrivals(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  if (draft.arrivals.enabled) {
    if (!isFiniteNumber(draft.arrivals.batchSize) || draft.arrivals.batchSize < 1) {
      errors["batchSize"] = "Batch size must be at least 1.";
    }
  }
  if (draft.materials.enabled) {
    if (!isFiniteNumber(draft.materials.bottles) || draft.materials.bottles < 0)
      errors["bottles"] = "Initial bottles can't be negative.";
    if (!isFiniteNumber(draft.materials.caps) || draft.materials.caps < 0)
      errors["caps"] = "Initial caps can't be negative.";
    if (!isFiniteNumber(draft.materials.bottlesPerPart) || draft.materials.bottlesPerPart < 0)
      errors["bottlesPerPart"] = "Bottles per part can't be negative.";
    if (!isFiniteNumber(draft.materials.capsPerPart) || draft.materials.capsPerPart < 0)
      errors["capsPerPart"] = "Caps per part can't be negative.";
  }
  return { step: 5, valid: Object.keys(errors).length === 0, errors };
}

export function validateRunWindow(draft: WizardDraft): WizardStepValidation {
  const errors: Record<string, string> = {};
  const r = draft.runWindow;
  if (!isFiniteNumber(r.horizonMs) || r.horizonMs <= 0) errors["horizonMs"] = "Pick a run length.";
  if (!isFiniteNumber(r.warmupMs) || r.warmupMs < 0)
    errors["warmupMs"] = "Warm-up can't be negative.";
  if (r.warmupMs >= r.horizonMs)
    errors["warmupMs"] = "Warm-up must be shorter than the run length.";
  if (!isFiniteNumber(r.seed)) errors["seed"] = "Seed must be a finite number.";
  if (!isFiniteNumber(r.interStationBufferCapacity) || r.interStationBufferCapacity < 1)
    errors["bufferCap"] = "Buffer capacity must be at least 1.";
  if (!isFiniteNumber(r.replications) || r.replications < 1 || r.replications > 50)
    errors["replications"] = "Replications must be between 1 and 50.";
  if (!isFiniteNumber(r.samplerIntervalMs) || r.samplerIntervalMs < 0)
    errors["samplerIntervalMs"] = "Sampler interval can't be negative.";
  return { step: 6, valid: Object.keys(errors).length === 0, errors };
}

/**
 * Review step rolls up every upstream validator so the user can't commit
 * a draft that fails any earlier check.
 */
export function validateReview(draft: WizardDraft): WizardStepValidation {
  const upstream = [
    validateShape(draft),
    validateStations(draft),
    validateConnections(draft),
    validateProducts(draft),
    validateRealism(draft),
    validateArrivals(draft),
    validateRunWindow(draft),
  ];
  const errors: Record<string, string> = {};
  upstream.forEach((v) => {
    if (!v.valid) {
      errors[`step-${String(v.step)}`] = `Step ${String(v.step + 1)} has unresolved errors.`;
    }
  });
  return { step: 7, valid: Object.keys(errors).length === 0, errors };
}

export type WizardStepValidator = (draft: WizardDraft) => WizardStepValidation;

export const STEP_VALIDATORS: readonly WizardStepValidator[] = [
  validateShape,
  validateStations,
  validateConnections,
  validateProducts,
  validateRealism,
  validateArrivals,
  validateRunWindow,
  validateReview,
];
