/**
 * VROL-855 (Sprint 197) — adapter that projects the editor's react-flow
 * scenario state into the RenderStation/RenderEdge shape the Pixi worker
 * consumes. Pure function; safe to call every frame or once per scene
 * change.
 *
 * Positioning: editor stations sit in pixel space (react-flow
 * `node.position`). The renderer thinks in tile-space (world coords),
 * so we divide by the same X/Y grid the scenario-from-ai converter uses
 * (200 × 140 px per tile). Result: a scenario authored in the editor
 * lands on the iso grid with roughly the same left-to-right layout.
 *
 * State: without a ChainResult, every station is "idle". With one,
 * the dominant state (max ms in the last sample) at the matching
 * topology index drives the ring colour, and the engine's
 * `bottleneckStationIdx` marks the outline.
 */

import type { Edge, Node } from "@xyflow/react";

import type { ChainResult } from "@/engine";
import type { RenderEdge, RenderStation } from "./protocol";

const TILE_PX_X = 200;
const TILE_PX_Y = 140;

const STATE_ORDER: readonly RenderStation["state"][] = [
  "running",
  "blocked",
  "starved",
  "down",
  "setup",
  "idle",
];

const STATE_ALIAS: Readonly<Record<string, RenderStation["state"]>> = {
  Running: "running",
  BlockedOut: "blocked",
  Blocked: "blocked",
  Starved: "starved",
  Down: "down",
  Setup: "setup",
  Idle: "idle",
  Maintenance: "down",
};

function dominantState(stateMs: Readonly<Record<string, number>>): RenderStation["state"] {
  let best: RenderStation["state"] = "idle";
  let bestMs = -1;
  for (const [key, ms] of Object.entries(stateMs)) {
    const mapped = STATE_ALIAS[key];
    if (mapped === undefined) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = mapped;
    }
  }
  // Stable tiebreak by canonical order so runs with identical ms
  // don't render differently across frames.
  if (bestMs === 0) return STATE_ORDER[STATE_ORDER.length - 1] ?? "idle";
  return best;
}

/**
 * Build a lookup from `node.id` → topology index by matching the label
 * on the react-flow node against `result.perStationLabels`. Handles
 * duplicate labels by consuming each label only once — the first node
 * with that label gets the first matching index.
 */
function buildIdToIdx(
  nodes: readonly Node[],
  labels: ReadonlyArray<string | undefined>,
): Map<string, number> {
  const out = new Map<string, number>();
  const consumed = new Set<number>();
  for (const n of nodes) {
    const nodeLabel = (n.data as { label?: unknown } | undefined)?.label;
    if (typeof nodeLabel !== "string") continue;
    for (let i = 0; i < labels.length; i++) {
      if (consumed.has(i)) continue;
      if (labels[i] === nodeLabel) {
        out.set(n.id, i);
        consumed.add(i);
        break;
      }
    }
  }
  return out;
}

export interface ScenarioToRenderOutput {
  readonly stations: readonly RenderStation[];
  readonly edges: readonly RenderEdge[];
}

export function scenarioToRender(
  nodes: readonly Node[],
  edges: readonly Edge[],
  result: ChainResult | null,
): ScenarioToRenderOutput {
  const stationNodes = nodes.filter((n) => n.type === "station");
  const labels = result?.perStationLabels ?? [];
  const idToIdx = buildIdToIdx(stationNodes, labels);
  const lastSample = result?.samples[result.samples.length - 1];
  const perStationStateMs = lastSample?.perStationStateMs ?? [];

  const stations: RenderStation[] = stationNodes.map((n) => {
    const idx = idToIdx.get(n.id);
    const stateMs = idx !== undefined ? perStationStateMs[idx] : undefined;
    const state: RenderStation["state"] = stateMs ? dominantState(stateMs) : "idle";
    const isBottleneck =
      result !== null && idx !== undefined && idx === result.bottleneckStationIdx;
    const nodeLabel = (n.data as { label?: unknown } | undefined)?.label;
    const label = typeof nodeLabel === "string" ? nodeLabel : n.id;
    return {
      id: n.id,
      x: n.position.x / TILE_PX_X,
      y: n.position.y / TILE_PX_Y,
      z: 0,
      label,
      state,
      isBottleneck,
    };
  });

  const stationIds = new Set(stationNodes.map((n) => n.id));
  const throughputPerSec = result ? Math.max(0, result.throughputLambda * 1000) : 0;
  const renderEdges: RenderEdge[] = edges
    .filter((e) => stationIds.has(e.source) && stationIds.has(e.target))
    .map((e) => ({
      id: e.id,
      sourceId: e.source,
      targetId: e.target,
      flowRate: throughputPerSec,
    }));

  return { stations, edges: renderEdges };
}
