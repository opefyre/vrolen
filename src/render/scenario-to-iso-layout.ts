/**
 * VROL-858 (Sprint 197 backlog) — auto-layout scenario nodes onto the
 * iso grid.
 *
 * The editor's react-flow uses arbitrary pixel positions; the iso
 * playback view needs tile coords with sensible left-to-right topology
 * order. This module runs a Kahn-style topological sort over station
 * nodes, assigns each to an iso-x layer (0-indexed from any source
 * station), and staggers siblings in the same layer along iso-y so
 * parallel branches don't stack.
 *
 * Pure — output depends only on the (nodes, edges) input, so it's
 * covered by unit tests and safe to call every scene tick.
 */

import type { Edge, Node } from "@xyflow/react";

export interface IsoLayoutResult {
  /** Map of node id → { x, y } world tile coordinates. */
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  /** Number of iso-x layers used (max depth + 1). */
  readonly layerCount: number;
}

/**
 * Compute topological layers over station nodes. Nodes with no incoming
 * edge get layer 0; every other node's layer is `max(source layers) + 1`.
 * Cycles are broken by taking the layer of any already-visited node as
 * upstream — the graph is a DAG by design in Vrolen, but bugs happen.
 */
function layerOf(stationIds: readonly string[], edges: readonly Edge[]): Map<string, number> {
  const inEdges = new Map<string, string[]>();
  const ids = new Set(stationIds);
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const list = inEdges.get(e.target) ?? [];
    list.push(e.source);
    inEdges.set(e.target, list);
  }
  const layer = new Map<string, number>();
  // BFS-like: fixpoint iterate until every node has a layer. Bounded
  // by O(nodes²) in the pathological case (deep chain traversed once
  // per pass); fine for the hundreds-of-nodes scale we target.
  let changed = true;
  let iterations = 0;
  const MAX_ITER = stationIds.length + 2;
  while (changed && iterations < MAX_ITER) {
    changed = false;
    iterations++;
    for (const id of stationIds) {
      const inList = inEdges.get(id) ?? [];
      let next = 0;
      let ready = true;
      for (const src of inList) {
        const srcLayer = layer.get(src);
        if (srcLayer === undefined) {
          ready = false;
          break;
        }
        if (srcLayer + 1 > next) next = srcLayer + 1;
      }
      // Sources or cycle-breakers land at layer 0 on the first pass.
      if (!ready && inList.length === 0) {
        ready = true;
        next = 0;
      }
      if (!ready) continue;
      if (layer.get(id) !== next) {
        layer.set(id, next);
        changed = true;
      }
    }
  }
  // Any node still unmapped (part of a cycle none of whose members
  // has a computed layer) gets layer 0 so it renders somewhere.
  for (const id of stationIds) {
    if (!layer.has(id)) layer.set(id, 0);
  }
  return layer;
}

/**
 * Stagger nodes in the same layer along iso-y. The first node sits on
 * row 0; additional nodes alternate -1, +1, -2, +2, … so branches
 * bloom symmetrically around the trunk.
 */
function rowOf(layer: Map<string, number>): Map<string, number> {
  const perLayer = new Map<number, string[]>();
  for (const [id, l] of layer) {
    const list = perLayer.get(l) ?? [];
    list.push(id);
    perLayer.set(l, list);
  }
  const row = new Map<string, number>();
  for (const [, ids] of perLayer) {
    // Stable order by id so re-renders don't shuffle branches.
    ids.sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === undefined) continue;
      const sign = i % 2 === 1 ? -1 : 1;
      const distance = Math.floor((i + 1) / 2);
      row.set(id, sign * distance);
    }
  }
  return row;
}

/**
 * VROL-1232 — spacing multiplier applied to raw layer / row indices.
 * At 1.0 (previous default), a bottling-line preset packed 7 stations
 * into a diagonal stack where sprites overlapped 30-50 % each. Bumping
 * to LAYER_SPACING = 2.0 (right-axis) and ROW_SPACING = 2.4 (down-axis)
 * gives every sprite its own iso cell at fit-view zoom, matches the
 * width of the new procedural sprites (VROL-1228, ~60 px at zoom=1),
 * and leaves visual breathing room between parallel branches.
 */
const LAYER_SPACING = 2.0;
const ROW_SPACING = 2.4;

export function scenarioToIsoLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
): IsoLayoutResult {
  const stationNodes = nodes.filter((n) => n.type === "station");
  const stationIds = stationNodes.map((n) => n.id);
  const layer = layerOf(stationIds, edges);
  const row = rowOf(layer);
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  let maxLayer = 0;
  for (const id of stationIds) {
    const rawLayer = layer.get(id) ?? 0;
    const rawRow = row.get(id) ?? 0;
    positions.set(id, { x: rawLayer * LAYER_SPACING, y: rawRow * ROW_SPACING });
    if (rawLayer > maxLayer) maxLayer = rawLayer;
  }
  return { positions, layerCount: maxLayer + 1 };
}
