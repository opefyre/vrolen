/**
 * Editor graph persistence (extracted from EditorPage as part of VROL-810).
 *
 * Owns the localStorage round-trip for the user's working scenario graph,
 * the stable-id backfill, and the default bottling-line demo seed.
 */
import type { Edge, Node } from "@xyflow/react";

import { constant } from "@/engine";

export const STORAGE_KEY = "vrolen.editor-graph";

export interface PersistedGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Default bottling line — designed to surface every interesting engine
 * feature in a single Run so a first-time visitor sees the simulator do
 * something meaningful before they touch anything.
 *
 * Topology (DAG with branching):
 *
 *               ┌─→ Filler A ─┐
 *   Input ──────┤             ├─→ Capper ─→ QC ─→ Labeler ─→ Packer
 *               └─→ Filler B ─┘                ↺
 *                                           rework on
 *                                          QC defects
 */
export const INITIAL_NODES: Node[] = [
  {
    id: "n1",
    type: "station",
    position: { x: 60, y: 180 },
    data: {
      label: "Input",
      stationType: "input",
      cycleDistribution: constant(30),
      defectRate: 0,
    },
  },
  {
    id: "n2",
    type: "station",
    position: { x: 240, y: 60 },
    data: {
      label: "Filler A",
      stationType: "machine",
      cycleDistribution: constant(120),
      defectRate: 0,
      maintenanceWindows: [{ startMs: 30_000, endMs: 35_000 }],
    },
  },
  {
    id: "n3",
    type: "station",
    position: { x: 240, y: 300 },
    data: {
      label: "Filler B",
      stationType: "machine",
      cycleDistribution: constant(130),
      defectRate: 0,
    },
  },
  {
    id: "n4",
    type: "station",
    position: { x: 440, y: 180 },
    data: {
      label: "Capper",
      stationType: "machine",
      cycleDistribution: constant(180),
      setupDistribution: constant(40),
      defectRate: 0,
    },
  },
  {
    id: "n5",
    type: "station",
    position: { x: 640, y: 180 },
    data: {
      label: "QC",
      stationType: "qc",
      cycleDistribution: constant(60),
      defectRate: 0.15,
      reworkTargetNodeId: "n4",
    },
  },
  {
    id: "n6",
    type: "station",
    position: { x: 840, y: 180 },
    data: {
      label: "Labeler",
      stationType: "machine",
      cycleDistribution: constant(90),
      defectRate: 0,
    },
  },
  {
    id: "n7",
    type: "station",
    position: { x: 1040, y: 180 },
    data: {
      label: "Packer",
      stationType: "output",
      cycleDistribution: constant(30),
      defectRate: 0,
    },
  },
];

export const INITIAL_EDGES: Edge[] = [
  { id: "e1-2", source: "n1", target: "n2" },
  { id: "e1-3", source: "n1", target: "n3" },
  { id: "e2-4", source: "n2", target: "n4" },
  { id: "e3-4", source: "n3", target: "n4" },
  { id: "e4-5", source: "n4", target: "n5" },
  { id: "e5-6", source: "n5", target: "n6" },
  { id: "e6-7", source: "n6", target: "n7" },
];

/**
 * VROL-604 — Stable per-station identity, independent of the node's react-flow
 * id (which can collide after renames or palette drops). Used by the engine
 * translator to disambiguate metrics across runs.
 */
export function generateStationKey(): string {
  const rand = ((Math.sin(performance.now()) + 1) / 2).toString(36).slice(2, 10);
  return `sk_${performance.now().toString(36).replace(".", "")}_${rand}`;
}

/**
 * Backfill a stationKey on every node that's missing one. Mutates a copy of the
 * provided array and returns it. Safe to call on already-keyed nodes (no-op).
 */
export function ensureStationKeys(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    if (typeof data.stationKey === "string" && data.stationKey.length > 0) return n;
    return { ...n, data: { ...data, stationKey: generateStationKey() } };
  });
}

export function loadGraph(): PersistedGraph {
  if (typeof window === "undefined") return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
    const parsed = JSON.parse(raw) as Partial<PersistedGraph>;
    const baseNodes = parsed.nodes && parsed.nodes.length > 0 ? parsed.nodes : INITIAL_NODES;
    // VROL-607 — backfill stationKey before first render so a station's
    // identity survives even if the user reloads before mutating any state.
    // If the backfill changes anything, re-persist so the keys stick.
    const keyed = ensureStationKeys([...baseNodes]);
    const changed = keyed.some((n, i) => n !== baseNodes[i]);
    const result: PersistedGraph = { nodes: keyed, edges: parsed.edges ?? [] };
    if (changed) saveGraph(result);
    return result;
  } catch {
    return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
  }
}

export function saveGraph(g: PersistedGraph): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(g));
  } catch {
    // Persistence unavailable — in-memory state still works.
  }
}
