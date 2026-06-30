/**
 * VROL-402 (Sprint 196) — convert an AI-emitted scenario into the
 * react-flow node/edge + RunSettings shape the editor consumes.
 *
 * The GeneratedScenario shape (src/ai/scenario-schema.ts) is a subset
 * of the full scenario format — linear-ish chains with optional
 * branching. This converter lays stations out left-to-right by their
 * order in the array; the user can rearrange after Apply.
 */

import type { Edge, Node } from "@xyflow/react";

import { constant } from "@/engine";
import { DEFAULT_RUN_SETTINGS, type RunSettings } from "@/routes/editor-run-settings";
import type { GeneratedScenario } from "@/ai/scenario-schema";

const STATION_X_GAP = 200;
const STATION_Y_GAP = 140;
const STATION_X_ORIGIN = 60;
const STATION_Y_ORIGIN = 180;

export interface AiScenarioGraph {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly settings: RunSettings;
}

/**
 * Map { stationId → row } so branches that diverge from the same
 * source station land on distinct y rows. First child stays on row 0,
 * additional children climb up/down alternately.
 */
function assignRows(stations: GeneratedScenario["stations"], edges: GeneratedScenario["edges"]) {
  const row: Record<string, number> = {};
  const outDegree: Record<string, number> = {};
  for (const s of stations) row[s.id] = 0;
  for (const e of edges) {
    const seen = outDegree[e.source] ?? 0;
    outDegree[e.source] = seen + 1;
    if (seen === 0) continue;
    const sign = seen % 2 === 1 ? -1 : 1;
    const distance = Math.floor((seen + 1) / 2);
    row[e.target] = row[e.source] + sign * distance;
  }
  return row;
}

export function aiScenarioToGraph(scenario: GeneratedScenario): AiScenarioGraph {
  const rows = assignRows(scenario.stations, scenario.edges);
  const sourceIds = new Set(scenario.stations.map((s) => s.id));
  for (const e of scenario.edges) {
    sourceIds.delete(e.target);
  }
  const nodes: Node[] = scenario.stations.map((s, i) => {
    const isSource = sourceIds.has(s.id) && i === 0;
    const isSink = i === scenario.stations.length - 1;
    const stationType = isSource ? "input" : isSink ? "output" : "machine";
    const data: Record<string, unknown> = {
      label: s.label,
      stationType,
      cycleDistribution: constant(s.cycleMs),
      defectRate: s.defectRate ?? 0,
    };
    if (s.capacity !== undefined) data["capacity"] = s.capacity;
    if (s.energyPerCycleJ !== undefined) data["energyPerCycleJ"] = s.energyPerCycleJ;
    return {
      id: s.id,
      type: "station",
      position: {
        x: STATION_X_ORIGIN + i * STATION_X_GAP,
        y: STATION_Y_ORIGIN + (rows[s.id] ?? 0) * STATION_Y_GAP,
      },
      data,
    };
  });
  const edges: Edge[] = scenario.edges.map((e, i) => {
    const out: Edge = {
      id: `e-${String(i)}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
    };
    if (e.bufferCapacity !== undefined) {
      out.data = { bufferCapacity: e.bufferCapacity };
    }
    return out;
  });
  const settings: RunSettings = {
    ...DEFAULT_RUN_SETTINGS,
    horizonMs: scenario.settings.horizonMs,
    warmupMs: scenario.settings.warmupMs,
    replications: scenario.settings.replications,
    interStationBufferCapacity: scenario.settings.interStationBufferCapacity,
  };
  return { nodes, edges, settings };
}
