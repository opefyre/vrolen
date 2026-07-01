/**
 * VROL-212 (Sprint 200) — derive worker sprites from ChainResult +
 * iso layout.
 *
 * The engine doesn't emit continuous worker positions today; VROL-212's
 * "spatial state from engine (E05)" reference is optimistic. We derive
 * an approximation from the data we DO have:
 *
 *   - `perStationRunningPct` — share of the window each station was
 *     Running. Stations with pct > 0 get a worker sprite.
 *   - Palette index = station idx mod palette count (stable across
 *     ticks so a station always keeps the same colour worker).
 *
 * Each worker sits at its station's world tile position and is marked
 * "working" when its station is running-heavy, "idle" otherwise. Real
 * walk-between-stations animation lands when the engine grows per-tick
 * position events (out of scope for this ticket).
 */

import type { ChainResult } from "@/engine";
import type { RenderWorker } from "./protocol";

interface IsoLayout {
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}

const IDLE_THRESHOLD = 0.05;

export function scenarioToWorkers(
  layout: IsoLayout,
  result: ChainResult | null,
  topologyIndexToNodeId: ReadonlyMap<number, string>,
): readonly RenderWorker[] {
  if (!result) return [];
  const runningPcts = result.perStationRunningPct;
  const labels = result.perStationLabels ?? [];
  const workers: RenderWorker[] = [];
  for (let i = 0; i < runningPcts.length; i++) {
    const pct = runningPcts[i] ?? 0;
    if (pct <= 0) continue;
    const nodeId = topologyIndexToNodeId.get(i);
    if (!nodeId) continue;
    const pos = layout.positions.get(nodeId);
    if (!pos) continue;
    const label = labels[i];
    workers.push({
      id: `w-${nodeId}`,
      x: pos.x + 0.35, // slight offset so the worker sits next to the station body
      y: pos.y + 0.35,
      z: 0,
      mode: pct >= IDLE_THRESHOLD ? "working" : "idle",
      palette: i,
      ...(label !== undefined ? { label } : {}),
    });
  }
  return workers;
}

/**
 * Build a topology-index → node-id map so ChainResult's per-index
 * arrays (perStationRunningPct, perStationOee, …) can be traced back
 * to the react-flow nodes they came from. Matches by label; consumes
 * each topology index once so parallel Fillers stay addressable as
 * distinct nodes.
 */
export function topologyIndexToNodeIdMap(
  nodes: readonly { readonly id: string; readonly type?: string; readonly data?: unknown }[],
  perStationLabels: ReadonlyArray<string | undefined>,
): Map<number, string> {
  const out = new Map<number, string>();
  const consumed = new Set<number>();
  const stationNodes = nodes.filter((n) => n.type === "station");
  for (const n of stationNodes) {
    const nodeLabel = (n.data as { label?: unknown } | undefined)?.label;
    if (typeof nodeLabel !== "string") continue;
    for (let i = 0; i < perStationLabels.length; i++) {
      if (consumed.has(i)) continue;
      if (perStationLabels[i] === nodeLabel) {
        out.set(i, n.id);
        consumed.add(i);
        break;
      }
    }
  }
  return out;
}
