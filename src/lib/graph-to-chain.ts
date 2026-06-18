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

import { constant, type Distribution, meanOf } from "@/engine";

export interface GraphToChainResult {
  /** Node ids in chain order (source → sink). Empty when error is set. */
  readonly chainNodeIds: readonly string[];
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
  /** Set when the graph can't be turned into a chain at all. */
  readonly error: string | null;
}

const DEFAULT_CYCLE_MS = 100;

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

function labelOf(node: Node): string {
  const raw = (node.data as { label?: unknown } | undefined)?.label;
  return typeof raw === "string" && raw.length > 0 ? raw : node.id;
}

export function graphToChainOptions(
  nodes: ReadonlyArray<Node>,
  edges: ReadonlyArray<Edge>,
): GraphToChainResult {
  const empty: GraphToChainResult = {
    chainNodeIds: [],
    cycleDistributions: [],
    cycleTimes: [],
    stationLabels: [],
    skippedNodeIds: [],
    error: null,
  };
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

  // Walk the longest linear path. A "linear" path is one where every node has
  // exactly one successor (the last node may have zero).
  const sources = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  if (sources.length === 0) {
    // Topo check passed but no zero-in-degree node — should only happen on an
    // empty graph after edge filtering, which we already handled.
    return { ...empty, error: "No source node (every node has an incoming edge)" };
  }

  let bestChain: string[] = [];
  for (const src of sources) {
    const chain: string[] = [src.id];
    let cur = src.id;
    while (true) {
      const outs = outEdges.get(cur) ?? [];
      if (outs.length !== 1) break;
      const next = outs[0]!;
      // Stop on cycles defensively (shouldn't happen post-Kahn, but cheap).
      if (chain.includes(next)) break;
      chain.push(next);
      cur = next;
    }
    if (chain.length > bestChain.length) bestChain = chain;
  }

  if (bestChain.length === 0) {
    return { ...empty, error: "No usable linear chain found" };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const cycleDistributions = bestChain.map((id) => distributionOf(nodeById.get(id)!));
  const cycleTimes = cycleDistributions.map((d) => meanOf(d));
  const stationLabels = bestChain.map((id) => labelOf(nodeById.get(id)!));
  const chainSet = new Set(bestChain);
  const skippedNodeIds = nodes.filter((n) => !chainSet.has(n.id)).map((n) => n.id);

  return {
    chainNodeIds: bestChain,
    cycleDistributions,
    cycleTimes,
    stationLabels,
    skippedNodeIds,
    error: null,
  };
}
