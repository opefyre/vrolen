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
  asResourceId,
  type ChainBreakdownConfig,
  type ChainMaintenanceConfig,
  type ChainMaterialConfig,
  type ChainProductsConfig,
  type ChainResult,
  type ChainWorkerConfig,
  constant,
  type Distribution,
  runChain,
  SeededPrng,
} from "@/engine";

import { graphToChainOptions } from "./graph-to-chain";
import { settingsToMaterialsCfg } from "./settings-to-materials-cfg";
import type { RunSettings } from "@/routes/editor-run-settings";

export interface ScenarioRunMeta {
  chainNodeIds: string[];
  stationLabels: string[];
  /** Stable station keys aligned with chainNodeIds. Used for cross-run matching. */
  stationKeys: string[];
  /** "sourceNodeId→targetNodeId" keys, in the order the engine returned them. */
  edgeKeys: string[];
  /**
   * VROL-867 v1 — per-station unit-of-measure label, aligned with
   * chainNodeIds. Empty string when the station has no explicit unit
   * (treated as "parts" by display callers). The sink's value drives
   * the result-panel throughput label so non-discrete lines (dairy,
   * chemistry, etc.) read as kg/h, L/h, doses/h instead of parts/h.
   */
  perStationUnit: string[];
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
    materialsCfg = settingsToMaterialsCfg(settings.materials, stationIndex);
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
  // VROL-982 — fold the shift calendar into per-station maintenance so
  // TEEP's loading-fraction (which divides by maintenanceMs/horizon)
  // reflects calendar reality.
  const shiftWindows: { startMs: number; endMs: number }[] = [];
  if (
    settings.shiftCalendar?.enabled &&
    settings.shiftCalendar.operatingMs > 0 &&
    settings.shiftCalendar.operatingMs < settings.horizonMs
  ) {
    shiftWindows.push({
      startMs: settings.shiftCalendar.operatingMs,
      endMs: settings.horizonMs,
    });
  }
  for (const br of settings.shiftCalendar?.breaks ?? []) {
    if (br.durationMs > 0) {
      shiftWindows.push({ startMs: br.atMs, endMs: br.atMs + br.durationMs });
    }
  }
  if (shiftWindows.length > 0) {
    const stationCount = translation.chainNodeIds.length;
    for (let i = 0; i < stationCount; i++) {
      const existing = maintenanceMap.get(i) ?? [];
      maintenanceMap.set(i, [...existing, ...shiftWindows]);
    }
  }
  const maintenanceCfg: ChainMaintenanceConfig | undefined =
    maintenanceMap.size > 0 ? { perStationWindows: maintenanceMap } : undefined;

  const productsCfg: ChainProductsConfig | undefined =
    settings.products.enabled && settings.products.list.length > 0
      ? {
          products: settings.products.list.map((p) => ({
            id: p.id || p.name || "default",
            weight: Math.max(0, p.weight),
          })),
          // VROL-664 — production plan if set.
          ...(settings.products.productionPlan && settings.products.productionPlan.length > 0
            ? { productionPlan: settings.products.productionPlan }
            : {}),
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
      // VROL-1003 — per-edge conveyor delay from Transport nodes.
      ...(translation.bufferDelayMs && translation.bufferDelayMs.some((ms) => ms > 0)
        ? { bufferDelayMs: [...translation.bufferDelayMs] }
        : {}),
      interStationBufferCapacity: settings.interStationBufferCapacity,
      horizonMs: settings.horizonMs,
      warmupMs: Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2)),
      prng: new SeededPrng(settings.seed),
      ...(materialsCfg ? { materials: materialsCfg } : {}),
      ...(breakdownsCfg ? { breakdowns: breakdownsCfg } : {}),
      ...(workersCfg ? { workers: workersCfg } : {}),
      ...(maintenanceCfg ? { maintenance: maintenanceCfg } : {}),
      ...(productsCfg ? { products: productsCfg } : {}),
      ...(settings.source.enabled
        ? {
            source: {
              interArrivalMs: constant(settings.source.intervalMs),
              ...(settings.source.batchSize > 1 ? { batchSize: settings.source.batchSize } : {}),
            },
          }
        : {}),
      // VROL-AUDIT — without this, comparison runs return result.samples = []
      // and the throughput-over-time + WIP-curve cards render flat. Mirrors
      // EditorPage.handleRun (EditorPage.tsx ~1764).
      ...(settings.samplerIntervalMs > 0
        ? { sampler: { intervalMs: settings.samplerIntervalMs } }
        : {}),
      ...(settings.toolPools && settings.toolPools.length > 0
        ? {
            toolPools: settings.toolPools
              .filter(
                (p) =>
                  typeof p.name === "string" &&
                  p.name.length > 0 &&
                  Number.isFinite(p.capacity) &&
                  p.capacity > 0,
              )
              .map((p) => ({ name: p.name, capacity: Math.floor(p.capacity) })),
          }
        : {}),
      // VROL-988 — line-level changeover matrix. UI stores ms scalars;
      // engine wants Distributions. constant(ms) per entry.
      ...(settings.changeoverMatrix && Object.keys(settings.changeoverMatrix).length > 0
        ? (() => {
            const out: Record<string, Record<string, Distribution>> = {};
            for (const [from, row] of Object.entries(settings.changeoverMatrix)) {
              const r: Record<string, Distribution> = {};
              let any = false;
              for (const [to, ms] of Object.entries(row)) {
                if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
                  r[to] = constant(ms);
                  any = true;
                }
              }
              if (any) out[from] = r;
            }
            return Object.keys(out).length > 0 ? { changeoverMatrix: out } : {};
          })()
        : {}),
    });

    return {
      result: r,
      runMeta: {
        chainNodeIds: [...translation.chainNodeIds],
        stationLabels: [...translation.stationLabels],
        stationKeys: [...translation.stationKeys],
        edgeKeys: translation.topology
          ? translation.topology.edges.map((e) => `${e.source}→${e.target}`)
          : translation.chainNodeIds
              .slice(0, -1)
              .map((id, i) => `${id}→${String(translation.chainNodeIds[i + 1])}`),
        // VROL-867 v1 — per-station UoM label aligned with chainNodeIds.
        // Defensive read: older callers using a mocked translation
        // without this field fall through to an empty array (treated as
        // "parts" by display callers).
        perStationUnit: translation.perStationUnit
          ? [...translation.perStationUnit]
          : translation.chainNodeIds.map(() => ""),
      },
      skippedNodeIds: translation.skippedNodeIds,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { kind: "engine", message };
  }
}
