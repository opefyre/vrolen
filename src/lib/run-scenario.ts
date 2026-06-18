/**
 * Pure helper to translate a graph + Run settings into a runChain invocation
 * and return both the engine result and the meta needed by the UI (chain
 * order, station labels, edge keys for canvas labels). Extracted from
 * EditorPage.handleRun in VROL-599 so callers can run an arbitrary scenario
 * payload (e.g., a saved scenario for side-by-side comparison) without
 * mutating editor state.
 */

import type { Edge, Node } from "@xyflow/react";

import {
  asMaterialId,
  asResourceId,
  type ChainBreakdownConfig,
  type ChainMaintenanceConfig,
  type ChainMaterialConfig,
  type ChainProductsConfig,
  type ChainResult,
  type ChainWorkerConfig,
  constant,
  runChain,
  SeededPrng,
} from "@/engine";

import { graphToChainOptions } from "./graph-to-chain";
import type { RunSettings } from "@/routes/editor-run-settings";

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

export interface ScenarioRunMeta {
  chainNodeIds: string[];
  stationLabels: string[];
  /** "sourceNodeId→targetNodeId" keys, in the order the engine returned them. */
  edgeKeys: string[];
}

export interface ScenarioRunOutcome {
  result: ChainResult;
  runMeta: ScenarioRunMeta;
  skippedNodeIds: readonly string[];
}

export type ScenarioRunFailure =
  | { kind: "translation"; message: string }
  | { kind: "materials-no-selection" }
  | { kind: "engine"; message: string };

/**
 * Run a scenario. Returns either the run outcome or a structured failure
 * describing what went wrong. Callers do the toast / UI dispatch — this
 * function stays pure-ish (it touches the PRNG and the engine, but no React
 * state or DOM).
 */
export function runScenario(
  nodes: readonly Node[],
  edges: readonly Edge[],
  settings: RunSettings,
  selectedNodeIdForMaterials: string | null,
): ScenarioRunOutcome | ScenarioRunFailure {
  const translation = graphToChainOptions(nodes, edges);
  if (translation.error) {
    return { kind: "translation", message: translation.error };
  }

  // Materials need a station to attach to (the inspector selection). If the
  // user enabled materials without selecting a node, surface the failure so
  // the caller can warn or skip.
  let materialsCfg: ChainMaterialConfig | undefined;
  if (settings.materials.enabled) {
    const stationIndex = selectedNodeIdForMaterials
      ? translation.chainNodeIds.indexOf(selectedNodeIdForMaterials)
      : -1;
    if (stationIndex < 0) {
      return { kind: "materials-no-selection" };
    }
    materialsCfg = {
      initialInventory: [
        [BOTTLES_ID, settings.materials.bottles],
        [CAPS_ID, settings.materials.caps],
      ],
      stationRecipes: [
        {
          stationIndex,
          requirements: [
            { materialId: BOTTLES_ID, qtyPerPart: 1 },
            { materialId: CAPS_ID, qtyPerPart: 1 },
          ],
        },
      ],
      ...(settings.materials.replenishment.enabled
        ? {
            replenishments: [
              {
                materialId: BOTTLES_ID,
                amount: settings.materials.replenishment.amount,
                atMs: settings.materials.replenishment.atMs,
              },
            ],
          }
        : {}),
    };
  }

  const perStationSkills: string[][] = translation.chainNodeIds.map((id) => {
    const node = nodes.find((n) => n.id === id);
    const raw = (node?.data as { skills?: unknown } | undefined)?.skills;
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
    return [];
  });

  const maintenanceMap = new Map<number, { startMs: number; endMs: number }[]>();
  translation.maintenanceWindows.forEach((windows, i) => {
    if (windows.length > 0) maintenanceMap.set(i, [...windows]);
  });
  const maintenanceCfg: ChainMaintenanceConfig | undefined =
    maintenanceMap.size > 0 ? { perStationWindows: maintenanceMap } : undefined;

  const productsCfg: ChainProductsConfig | undefined =
    settings.products.enabled && settings.products.list.length > 0
      ? {
          products: settings.products.list.map((p) => ({
            id: p.id || p.name || "default",
            weight: Math.max(0, p.weight),
          })),
        }
      : undefined;

  const workersCfg: ChainWorkerConfig | undefined =
    settings.workers.enabled && settings.workers.list.length > 0
      ? {
          workers: settings.workers.list.map((entry, i) => ({
            id: asResourceId(`w${String(i + 1)}`),
            name: entry.name || `Worker ${String(i + 1)}`,
            skills: entry.skills.length > 0 ? entry.skills : ["any"],
            shifts: [{ startMs: 0, endMs: Math.max(1, entry.shiftEndMs) }],
          })),
          perStationSkills,
          requireDefault: [],
        }
      : undefined;

  const breakdownsCfg: ChainBreakdownConfig | undefined = settings.breakdowns.enabled
    ? {
        mtbfMs: { kind: "exponential", rate: 1 / Math.max(1, settings.breakdowns.mtbfMs) },
        mttrMs: constant(Math.max(1, settings.breakdowns.mttrMs)),
      }
    : undefined;

  try {
    const r = runChain({
      ...(translation.topology
        ? { topology: translation.topology }
        : {
            stationCycleTimes: [...translation.cycleDistributions],
            stationLabels: [...translation.stationLabels],
          }),
      interStationBufferCapacity: settings.interStationBufferCapacity,
      horizonMs: settings.horizonMs,
      warmupMs: Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2)),
      prng: new SeededPrng(settings.seed),
      ...(materialsCfg ? { materials: materialsCfg } : {}),
      ...(breakdownsCfg ? { breakdowns: breakdownsCfg } : {}),
      ...(workersCfg ? { workers: workersCfg } : {}),
      ...(maintenanceCfg ? { maintenance: maintenanceCfg } : {}),
      ...(productsCfg ? { products: productsCfg } : {}),
    });

    return {
      result: r,
      runMeta: {
        chainNodeIds: [...translation.chainNodeIds],
        stationLabels: [...translation.stationLabels],
        edgeKeys: translation.topology
          ? translation.topology.edges.map((e) => `${e.source}→${e.target}`)
          : translation.chainNodeIds
              .slice(0, -1)
              .map((id, i) => `${id}→${String(translation.chainNodeIds[i + 1])}`),
      },
      skippedNodeIds: translation.skippedNodeIds,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { kind: "engine", message };
  }
}
