/**
 * Translate the editor's react-flow graph into the parameters the engine's
 * runChain harness needs.
 *
 * Phase 0 scope: the chain harness only models linear chains. We pick the
 * longest linear path starting from any in-degree-0 node where every step
 * has exactly one successor. Disconnected or branching nodes are flagged
 * via `skippedNodeIds` so the UI can warn — they're ignored in the run.
 *
 * Cycles → error. The harness can't loop.
 */

import type { Edge, Node } from "@xyflow/react";

import {
  type ChainTopology,
  type ChainTopologyEdge,
  type ChainTopologyNode,
  constant,
  type Distribution,
  meanOf,
} from "@/engine";

interface NodeMaintenanceWindow {
  startMs: number;
  endMs: number;
}

export interface GraphToChainResult {
  /** Node ids in chain order (source → sink). Empty when error is set. */
  readonly chainNodeIds: readonly string[];
  /**
   * Stable per-station keys aligned with chainNodeIds. Read from
   * node.data.stationKey when present, falls back to the node id when not.
   * Used by comparison views to match stations across runs even when labels
   * change (VROL-604).
   */
  readonly stationKeys: readonly string[];
  /**
   * Per-station cycle time distribution (matches chainNodeIds by index).
   * Reads `node.data.cycleDistribution` first; falls back to `constant(cycleMs)`
   * for graphs persisted before VROL-581 added the picker.
   */
  readonly cycleDistributions: readonly Distribution[];
  /** Convenience: mean of cycleDistributions in ms. Used for legacy callers + UI hints. */
  readonly cycleTimes: readonly number[];
  /** Display label per station (matches chainNodeIds by index). */
  readonly stationLabels: readonly string[];
  /** Nodes not part of the selected chain (disconnected or branching). */
  readonly skippedNodeIds: readonly string[];
  /**
   * When the graph contains valid splits or merges (branching DAG with a single
   * source + single sink), this is the ChainTopology ready to feed runChain.
   * Falls back to undefined for pure linear chains (callers use cycleDistributions).
   */
  readonly topology: ChainTopology | null;
  /**
   * Per-station maintenance windows in chain order. Empty array if no windows.
   * Index matches chainNodeIds / cycleDistributions.
   */
  readonly maintenanceWindows: ReadonlyArray<readonly NodeMaintenanceWindow[]>;
  /**
   * VROL-1003 — Per-topology-edge conveyor delay in ms. An entry > 0
   * means the source of that edge is a Transport node and parts
   * crossing the edge take residenceTimeMs = lengthM/speedMps*1000 to
   * arrive at the downstream station. Defaults to 0 for every edge
   * (no delay). In linear mode the array is aligned to the implicit
   * i → i+1 edges; in DAG mode it's aligned to topology.edges.
   */
  readonly bufferDelayMs: readonly number[];
  /** Set when the graph can't be turned into a chain at all. */
  readonly error: string | null;
}

const DEFAULT_CYCLE_MS = 100;

/**
 * VROL-1003 — Residence time (ms) for Transport stations, computed
 * from data.lengthM / data.speedMps. Returns 0 when the node is not
 * a Transport or either field is missing / zero / negative.
 */
function transportResidenceMs(node: Node): number {
  const d = node.data as { stationType?: string; lengthM?: number; speedMps?: number };
  if (d.stationType !== "transport") return 0;
  const lengthM = typeof d.lengthM === "number" && d.lengthM > 0 ? d.lengthM : 0;
  const speedMps = typeof d.speedMps === "number" && d.speedMps > 0 ? d.speedMps : 0;
  if (lengthM <= 0 || speedMps <= 0) return 0;
  return (lengthM / speedMps) * 1000;
}

function isDistribution(v: unknown): v is Distribution {
  if (!v || typeof v !== "object") return false;
  const kind = (v as { kind?: unknown }).kind;
  return (
    kind === "constant" ||
    kind === "uniform" ||
    kind === "normal" ||
    kind === "triangular" ||
    kind === "exponential"
  );
}

function distributionOf(node: Node): Distribution {
  const data = node.data as { cycleDistribution?: unknown; cycleMs?: unknown } | undefined;
  if (isDistribution(data?.cycleDistribution)) {
    return data.cycleDistribution;
  }
  const ms = typeof data?.cycleMs === "number" ? data.cycleMs : Number(data?.cycleMs);
  return constant(Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_CYCLE_MS);
}

function setupDistributionOf(node: Node): Distribution | undefined {
  const data = node.data as { setupDistribution?: unknown } | undefined;
  if (isDistribution(data?.setupDistribution)) return data.setupDistribution;
  return undefined;
}

function defectRateOf(node: Node): number | undefined {
  const raw = (node.data as { defectRate?: unknown } | undefined)?.defectRate;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (raw <= 0) return undefined;
  return Math.min(1, raw);
}

function reworkTargetIdOf(node: Node): string | undefined {
  const raw = (node.data as { reworkTargetNodeId?: unknown } | undefined)?.reworkTargetNodeId;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function reworkPassLimitOf(node: Node): number | undefined {
  const raw = (node.data as { reworkPassLimit?: unknown } | undefined)?.reworkPassLimit;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < 1) return undefined;
  return n;
}

function capacityOf(node: Node): number | undefined {
  const raw = (node.data as { capacity?: unknown } | undefined)?.capacity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < 1 || n > 10) return undefined;
  if (n === 1) return undefined; // default; drop from output to keep topology clean
  return n;
}

function materialRequirementsOf(
  node: Node,
): ReadonlyArray<{ readonly materialId: string; readonly qtyPerPart: number }> | undefined {
  // VROL-871 — per-station recipe override. Validated; non-positive or
  // malformed rows are silently dropped.
  const raw = (
    node.data as
      | { materialRequirements?: ReadonlyArray<{ materialId: string; qtyPerPart: number }> }
      | undefined
  )?.materialRequirements;
  if (!Array.isArray(raw)) return undefined;
  const out: { materialId: string; qtyPerPart: number }[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.materialId !== "string" || r.materialId.length === 0) continue;
    if (typeof r.qtyPerPart !== "number" || !Number.isFinite(r.qtyPerPart) || r.qtyPerPart <= 0) {
      continue;
    }
    out.push({ materialId: r.materialId, qtyPerPart: r.qtyPerPart });
  }
  return out.length > 0 ? out : undefined;
}

function nonNegNumOf(node: Node, key: string): number | undefined {
  const raw = (node.data as Record<string, unknown> | undefined)?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

function qualityGradesOf(
  node: Node,
): ReadonlyArray<{ readonly grade: string; readonly pct: number }> | undefined {
  // VROL-882 — qualityGrades is an array of { grade, pct }. Defaults to
  // undefined (single A grade) when missing or malformed.
  const raw = (node.data as { qualityGrades?: unknown } | undefined)?.qualityGrades;
  if (!Array.isArray(raw)) return undefined;
  const out: { grade: string; pct: number }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { grade?: unknown; pct?: unknown };
    if (typeof e.grade !== "string" || e.grade.length === 0) continue;
    if (typeof e.pct !== "number" || !Number.isFinite(e.pct) || e.pct <= 0) continue;
    out.push({ grade: e.grade, pct: e.pct });
  }
  return out.length > 0 ? out : undefined;
}

function unitsPerCycleOf(node: Node): number | undefined {
  // VROL-870 — multi-output station. Drop default 1 to keep topology clean.
  const raw = (node.data as { unitsPerCycle?: unknown } | undefined)?.unitsPerCycle;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n < 1 || n > 1000) return undefined;
  if (n === 1) return undefined;
  return n;
}

function nominalCycleTimeMsOf(node: Node): number | undefined {
  // VROL-899 — read the OEM-rated design max if the user set one. Engine
  // drops it silently when >= operating mean (over-rated → no throttle).
  const raw = (node.data as { nominalCycleTimeMs?: unknown } | undefined)?.nominalCycleTimeMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

function cycleByProductOf(node: Node): Record<string, Distribution> | undefined {
  const raw = (node.data as { cycleByProduct?: unknown } | undefined)?.cycleByProduct;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, Distribution> = {};
  let any = false;
  for (const [productId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isDistribution(value)) {
      out[productId] = value;
      any = true;
    }
  }
  return any ? out : undefined;
}

function changeoverMatrixOf(node: Node): Record<string, Record<string, Distribution>> | undefined {
  const raw = (node.data as { changeoverMatrix?: unknown } | undefined)?.changeoverMatrix;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, Record<string, Distribution>> = {};
  let any = false;
  for (const [fromId, rowRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!rowRaw || typeof rowRaw !== "object" || Array.isArray(rowRaw)) continue;
    const row: Record<string, Distribution> = {};
    let rowAny = false;
    for (const [toId, value] of Object.entries(rowRaw as Record<string, unknown>)) {
      if (isDistribution(value)) {
        row[toId] = value;
        rowAny = true;
      }
    }
    if (rowAny) {
      out[fromId] = row;
      any = true;
    }
  }
  return any ? out : undefined;
}

function maintenanceWindowsOf(node: Node): NodeMaintenanceWindow[] {
  const raw = (node.data as { maintenanceWindows?: unknown } | undefined)?.maintenanceWindows;
  if (!Array.isArray(raw)) return [];
  const out: NodeMaintenanceWindow[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const startMs = Number((w as { startMs?: unknown }).startMs);
    const endMs = Number((w as { endMs?: unknown }).endMs);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      out.push({ startMs, endMs });
    }
  }
  return out;
}

function labelOf(node: Node): string {
  const raw = (node.data as { label?: unknown } | undefined)?.label;
  return typeof raw === "string" && raw.length > 0 ? raw : node.id;
}

function stationKeyOf(node: Node): string {
  const raw = (node.data as { stationKey?: unknown } | undefined)?.stationKey;
  return typeof raw === "string" && raw.length > 0 ? raw : node.id;
}

/**
 * VROL-880 — single mapper for ChainTopologyNode shape. Used in BOTH the
 * single-source/single-sink branch AND the linear-fallback (multi-source /
 * multi-sink) branch so per-station settings (capacity, defectRate, setup,
 * changeoverMatrix, cycleByProduct, rework, sustainability, grades, units,
 * nominalCycle, PM) flow through every code path. Pre-VROL-880 the fallback
 * emitted only cycleDistributions, silently dropping every other setting.
 */
function finiteNumOf(node: Node, key: string): number | undefined {
  const raw = (node.data as Record<string, unknown> | undefined)?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return raw;
}

function positiveNumOf(node: Node, key: string): number | undefined {
  const v = finiteNumOf(node, key);
  if (v === undefined || v <= 0) return undefined;
  return v;
}

function stringOf(node: Node, key: string): string | undefined {
  const raw = (node.data as Record<string, unknown> | undefined)?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function bomFeedersOf(
  node: Node,
): ReadonlyArray<{ feederStationId: string; qtyPerCycle: number }> | undefined {
  const raw = (node.data as { bomFeeders?: unknown } | undefined)?.bomFeeders;
  if (!Array.isArray(raw)) return undefined;
  const out: { feederStationId: string; qtyPerCycle: number }[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const fid = (r as { feederStationId?: unknown }).feederStationId;
    const qty = (r as { qtyPerCycle?: unknown }).qtyPerCycle;
    if (typeof fid !== "string" || fid.length === 0) continue;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ feederStationId: fid, qtyPerCycle: qty });
  }
  return out.length > 0 ? out : undefined;
}

function perSkuRoutingOf(node: Node): Record<string, string | "skip"> | undefined {
  const raw = (node.data as { perSkuRouting?: unknown } | undefined)?.perSkuRouting;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string | "skip"> = {};
  let any = false;
  for (const [sku, dest] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof sku !== "string" || sku.length === 0) continue;
    if (typeof dest !== "string" || dest.length === 0) continue;
    out[sku] = dest;
    any = true;
  }
  return any ? out : undefined;
}

function buildTopologyNode(node: Node, id: string, topoSet: Set<string>): ChainTopologyNode {
  const setup = setupDistributionOf(node);
  const byProduct = cycleByProductOf(node);
  const matrix = changeoverMatrixOf(node);
  const defectRate = defectRateOf(node);
  // Only pass reworkTargetId through if the target is also in the chain.
  // Off-chain rework targets would throw at engine init; safer to drop them
  // here so the run still produces something.
  const reworkRaw = reworkTargetIdOf(node);
  const reworkTargetId = reworkRaw && topoSet.has(reworkRaw) ? reworkRaw : undefined;
  const reworkPassLimit = reworkTargetId ? reworkPassLimitOf(node) : undefined;
  const capacity = capacityOf(node);
  const nominalCycleTimeMs = nominalCycleTimeMsOf(node);
  const unitsPerCycle = unitsPerCycleOf(node);
  const energyPerCycleJ = nonNegNumOf(node, "energyPerCycleJ");
  const waterPerCycleL = nonNegNumOf(node, "waterPerCycleL");
  const co2ePerCycleG = nonNegNumOf(node, "co2ePerCycleG");
  const qualityGrades = qualityGradesOf(node);
  const materialRequirements = materialRequirementsOf(node);
  // Sprint 89/90/91 round-trips: maintenance/CIP/PM, temperature, tool
  // pool, BOM, per-SKU routing. All optional and dropped silently when
  // missing or malformed.
  const cipEveryMs = positiveNumOf(node, "cipEveryMs");
  const cipDurationMs = positiveNumOf(node, "cipDurationMs");
  const pmEveryNCycles = positiveNumOf(node, "pmEveryNCycles");
  const pmCycleDurationMs = positiveNumOf(node, "pmCycleDurationMs");
  const initialTempC = finiteNumOf(node, "initialTempC");
  const stationDeltaC = finiteNumOf(node, "stationDeltaC");
  const tempSpecLoC = finiteNumOf(node, "tempSpecLoC");
  const tempSpecHiC = finiteNumOf(node, "tempSpecHiC");
  const requiredToolPool = stringOf(node, "requiredToolPool");
  const bomFeeders = bomFeedersOf(node);
  const perSkuRouting = perSkuRoutingOf(node);
  return {
    id,
    label: labelOf(node),
    cycleTimeMs: distributionOf(node),
    ...(setup ? { setupTimeMs: setup } : {}),
    ...(byProduct ? { cycleByProduct: byProduct } : {}),
    ...(matrix ? { changeoverMatrix: matrix } : {}),
    ...(defectRate !== undefined ? { defectRate } : {}),
    ...(reworkTargetId ? { reworkTargetId } : {}),
    ...(reworkPassLimit !== undefined ? { reworkPassLimit } : {}),
    ...(capacity !== undefined ? { capacity } : {}),
    ...(nominalCycleTimeMs !== undefined ? { nominalCycleTimeMs } : {}),
    ...(unitsPerCycle !== undefined ? { unitsPerCycle } : {}),
    ...(energyPerCycleJ !== undefined ? { energyPerCycleJ } : {}),
    ...(waterPerCycleL !== undefined ? { waterPerCycleL } : {}),
    ...(co2ePerCycleG !== undefined ? { co2ePerCycleG } : {}),
    ...(qualityGrades ? { qualityGrades } : {}),
    ...(materialRequirements ? { materialRequirements } : {}),
    ...(cipEveryMs !== undefined ? { cipEveryMs } : {}),
    ...(cipDurationMs !== undefined ? { cipDurationMs } : {}),
    ...(pmEveryNCycles !== undefined ? { pmEveryNCycles } : {}),
    ...(pmCycleDurationMs !== undefined ? { pmCycleDurationMs } : {}),
    ...(initialTempC !== undefined ? { initialTempC } : {}),
    ...(stationDeltaC !== undefined ? { stationDeltaC } : {}),
    ...(tempSpecLoC !== undefined ? { tempSpecLoC } : {}),
    ...(tempSpecHiC !== undefined ? { tempSpecHiC } : {}),
    ...(requiredToolPool ? { requiredToolPool } : {}),
    ...(bomFeeders ? { bomFeeders } : {}),
    ...(perSkuRouting ? { perSkuRouting } : {}),
  };
}

export function graphToChainOptions(
  nodesIn: ReadonlyArray<Node>,
  edges: ReadonlyArray<Edge>,
): GraphToChainResult {
  const empty: GraphToChainResult = {
    chainNodeIds: [],
    stationKeys: [],
    cycleDistributions: [],
    cycleTimes: [],
    stationLabels: [],
    skippedNodeIds: [],
    topology: null,
    maintenanceWindows: [],
    bufferDelayMs: [],
    error: null,
  };
  // Decorative nodes (sticky notes, section frames) never participate
  // in the simulation graph — strip them before any topology work.
  const nodes = nodesIn.filter((n) => n.type !== "sticky" && n.type !== "frame");
  if (nodes.length === 0) {
    return { ...empty, error: "Empty graph — add at least one station" };
  }

  // Build adjacency + in-degree tables, restricted to nodes we know about.
  const ids = new Set(nodes.map((n) => n.id));
  const outEdges = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    outEdges.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    outEdges.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // Cycle detection — Kahn's algorithm. If the produced topological order is
  // shorter than the node count, a cycle exists.
  const remaining = new Map(inDegree);
  const queue: string[] = [];
  for (const [id, deg] of remaining) if (deg === 0) queue.push(id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const t of outEdges.get(id) ?? []) {
      const r = (remaining.get(t) ?? 0) - 1;
      remaining.set(t, r);
      if (r === 0) queue.push(t);
    }
  }
  if (visited < nodes.length) {
    return { ...empty, error: "Graph contains a cycle — can't run a cyclic chain" };
  }

  // Find sources (in-degree 0) + sinks (out-degree 0) of the FULL graph.
  const sources = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const sinks = nodes.filter((n) => (outEdges.get(n.id) ?? []).length === 0);
  if (sources.length === 0) {
    return { ...empty, error: "No source node (every node has an incoming edge)" };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));

  // BFS from each source to identify the reachable component.
  function reachableFrom(rootId: string): Set<string> {
    const seen = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const next of outEdges.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  }

  // DAG mode: exactly one source and one sink, and the source's reachable set
  // contains the sink AND every node in the set has the source as an ancestor.
  if (sources.length === 1 && sinks.length === 1) {
    const src = sources[0]!;
    const sinkId = sinks[0]!.id;
    const reachable = reachableFrom(src.id);
    if (reachable.has(sinkId)) {
      // Topo-order the reachable nodes (Kahn within the reachable subset).
      const subRemaining = new Map<string, number>();
      for (const id of reachable) {
        let count = 0;
        for (const e of edges) {
          if (e.target === id && reachable.has(e.source)) count++;
        }
        subRemaining.set(id, count);
      }
      const subQueue: string[] = [src.id];
      const topoOrder: string[] = [];
      while (subQueue.length > 0) {
        const id = subQueue.shift()!;
        topoOrder.push(id);
        for (const next of outEdges.get(id) ?? []) {
          if (!reachable.has(next)) continue;
          const r = (subRemaining.get(next) ?? 0) - 1;
          subRemaining.set(next, r);
          if (r === 0) subQueue.push(next);
        }
      }
      const topoSet = new Set(topoOrder);

      // VROL-880 — extracted so the linear-fallback path can use the same
      // full-fidelity per-station mapper. Pre-VROL-880 the fallback emitted
      // only cycleDistributions, silently dropping defectRate / capacity /
      // setup / changeoverMatrix / cycleByProduct / rework / skills.
      const topoNodes: ChainTopologyNode[] = topoOrder.map((id) =>
        buildTopologyNode(nodeById.get(id)!, id, topoSet),
      );
      const topoEdges: ChainTopologyEdge[] = edges
        .filter((e) => topoSet.has(e.source) && topoSet.has(e.target) && e.source !== e.target)
        .map((e) => ({ source: e.source, target: e.target }));

      // CRITICAL: emit `topology` for EVERY valid single-source/single-sink
      // graph, branching or linear. Previously we only set topology when
      // the chain branched; linear chains fell through to the engine's
      // linear-mode path that ONLY consumes stationCycleTimes + labels.
      // That silently dropped every per-station feature:
      //   - capacity (parallel cycles)
      //   - defectRate
      //   - setupDistribution
      //   - changeoverMatrix
      //   - reworkTargetId / reworkPassLimit
      //   - per-product cycleByProduct
      // Users would set "Parallel cycles = 10" on the bottleneck and see
      // no change because the engine never saw the value.
      const cycleDistributions = topoNodes.map((n) => n.cycleTimeMs);
      const cycleTimes = cycleDistributions.map((d) => meanOf(d));
      const stationLabels = topoNodes.map((n) => n.label ?? n.id);
      const skippedNodeIds = nodes.filter((n) => !topoSet.has(n.id)).map((n) => n.id);
      const maintenanceWindows = topoOrder.map((id) => maintenanceWindowsOf(nodeById.get(id)!));

      const stationKeys = topoOrder.map((id) => stationKeyOf(nodeById.get(id)!));
      // VROL-1003 — Transport node residence routes to the OUTGOING edge.
      const bufferDelayMs = topoEdges.map((e) => {
        const sourceNode = nodeById.get(e.source);
        return sourceNode ? transportResidenceMs(sourceNode) : 0;
      });

      return {
        chainNodeIds: topoOrder,
        stationKeys,
        cycleDistributions,
        cycleTimes,
        stationLabels,
        skippedNodeIds,
        topology: { nodes: topoNodes, edges: topoEdges },
        maintenanceWindows,
        bufferDelayMs,
        error: null,
      };
    }
  }

  // Fall back to "longest linear path" for graphs that aren't a single-source /
  // single-sink DAG. Preserves prior behavior (silently picks one chain).
  let bestChain: string[] = [];
  for (const src of sources) {
    const chain: string[] = [src.id];
    let cur = src.id;
    while (true) {
      const outs = outEdges.get(cur) ?? [];
      if (outs.length !== 1) break;
      const next = outs[0]!;
      if (chain.includes(next)) break;
      chain.push(next);
      cur = next;
    }
    if (chain.length > bestChain.length) bestChain = chain;
  }

  if (bestChain.length === 0) {
    return { ...empty, error: "No usable linear chain found" };
  }

  // VROL-880 — emit a full ChainTopology for the linear fallback path too,
  // not just for single-source/single-sink graphs. Without this, multi-source
  // / multi-sink topologies fell back to engine "linear mode" which only
  // consumes stationCycleTimes + labels — every other per-station setting
  // (capacity, defectRate, setup, changeoverMatrix, cycleByProduct, rework,
  // sustainability inputs, grades, units, nominal, PM) was silently dropped.
  const chainSet = new Set(bestChain);
  const fallbackTopoNodes: ChainTopologyNode[] = bestChain.map((id) =>
    buildTopologyNode(nodeById.get(id)!, id, chainSet),
  );
  const fallbackTopoEdges: ChainTopologyEdge[] = [];
  for (let i = 0; i < bestChain.length - 1; i++) {
    fallbackTopoEdges.push({ source: bestChain[i]!, target: bestChain[i + 1]! });
  }
  const cycleDistributions = fallbackTopoNodes.map((n) => n.cycleTimeMs);
  const cycleTimes = cycleDistributions.map((d) => meanOf(d));
  const stationLabels = fallbackTopoNodes.map((n) => n.label ?? n.id);
  const skippedNodeIds = nodes.filter((n) => !chainSet.has(n.id)).map((n) => n.id);
  const maintenanceWindows = bestChain.map((id) => maintenanceWindowsOf(nodeById.get(id)!));
  const stationKeys = bestChain.map((id) => stationKeyOf(nodeById.get(id)!));
  // VROL-1003 — for each edge, if the source is a Transport node, the
  // edge carries the Transport's residence time. The Transport node
  // keeps its (typically tiny) cycle distribution; parts traverse the
  // node nearly instantly and then sit on the delayed edge for the
  // residence before the downstream sees them.
  const bufferDelayMs = fallbackTopoEdges.map((e) => {
    const sourceNode = nodeById.get(e.source);
    return sourceNode ? transportResidenceMs(sourceNode) : 0;
  });

  return {
    chainNodeIds: bestChain,
    stationKeys,
    cycleDistributions,
    cycleTimes,
    stationLabels,
    skippedNodeIds,
    topology: { nodes: fallbackTopoNodes, edges: fallbackTopoEdges },
    maintenanceWindows,
    bufferDelayMs,
    error: null,
  };
}
