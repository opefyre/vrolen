/**
 * Cost & revenue economics — turns engine output (parts, scrap, OEE)
 * into CFO-language: total cost, revenue, gross margin, cost per good
 * part, and break-even throughput.
 *
 * Each station has optional cost knobs stored on its node.data. If no
 * stations expose costs, this returns null and the UI skips the card.
 *
 * Costs:
 *   - costPerHour     ($/h) — labor + machine fixed cost while running
 *   - costPerCycle    ($/cycle) — consumable cost per cycle attempted
 *   - costPerScrap    ($/scrap) — material write-off per scrapped part
 *
 * Revenue:
 *   - revenuePerPart  ($/good part at the sink) — set on output stations
 *     (or, when absent, on any station with revenuePerPart > 0).
 */

import type { ChainResult } from "@/engine";
import type { Node } from "@xyflow/react";

export interface StationCostInputs {
  readonly costPerHour?: number;
  readonly costPerCycle?: number;
  readonly costPerScrap?: number;
  readonly revenuePerPart?: number;
}

export interface CostBreakdown {
  readonly stationLabel: string;
  readonly costHour: number;
  readonly costCycles: number;
  readonly costScrap: number;
  readonly total: number;
}

export interface CostSummary {
  readonly horizonHours: number;
  readonly revenue: number;
  readonly costRunningTime: number;
  readonly costCycles: number;
  readonly costScrap: number;
  readonly totalCost: number;
  readonly grossMargin: number;
  readonly perGoodPart: number;
  readonly breakEvenThroughputPerHour: number | null;
  readonly perStation: readonly CostBreakdown[];
}

/**
 * Read cost inputs off the node data. Returns zeros when the user
 * hasn't set anything for that station so the math degrades cleanly.
 */
function readCosts(data: unknown): StationCostInputs {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = d[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
    return v;
  };
  return {
    costPerHour: num("costPerHour"),
    costPerCycle: num("costPerCycle"),
    costPerScrap: num("costPerScrap"),
    revenuePerPart: num("revenuePerPart"),
  };
}

export function hasAnyCostInputs(nodes: readonly Node[]): boolean {
  return nodes.some((n) => {
    const c = readCosts(n.data);
    return (
      (c.costPerHour ?? 0) > 0 ||
      (c.costPerCycle ?? 0) > 0 ||
      (c.costPerScrap ?? 0) > 0 ||
      (c.revenuePerPart ?? 0) > 0
    );
  });
}

export function summarizeCosts(
  result: ChainResult,
  horizonMs: number,
  chainNodeIds: readonly string[],
  stationLabels: readonly string[],
  nodes: readonly Node[],
): CostSummary | null {
  const horizonHours = horizonMs / 3_600_000;
  // Map chain index → node lookup.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let revenue = 0;
  let costRunningTime = 0;
  let costCycles = 0;
  let costScrap = 0;
  const perStation: CostBreakdown[] = [];
  for (let i = 0; i < chainNodeIds.length; i++) {
    const nodeId = chainNodeIds[i]!;
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const inputs = readCosts(node.data);
    const completed = result.perStationCompleted[i] ?? 0;
    const scrap = result.perStationScrapped[i] ?? 0;
    const bn = result.bottlenecks.find((b) => String(b.stationId) === nodeId);
    // Productive time fraction at this station — use the Running share of
    // its time-weighted state breakdown, default to 100% if the bottleneck
    // summary is missing.
    const runningFraction = bn?.breakdown.find((s) => s.state === "Running")?.pct ?? 1.0;
    const stationCostHour = (inputs.costPerHour ?? 0) * horizonHours * runningFraction;
    // Cycles attempted ≈ completed + scrap (every cycle either completes or scraps).
    const cyclesAttempted = completed + scrap;
    const stationCostCycles = (inputs.costPerCycle ?? 0) * cyclesAttempted;
    const stationCostScrap = (inputs.costPerScrap ?? 0) * scrap;
    const stationTotal = stationCostHour + stationCostCycles + stationCostScrap;
    revenue += (inputs.revenuePerPart ?? 0) * completed;
    costRunningTime += stationCostHour;
    costCycles += stationCostCycles;
    costScrap += stationCostScrap;
    if (stationTotal > 0 || (inputs.revenuePerPart ?? 0) > 0) {
      perStation.push({
        stationLabel: stationLabels[i] ?? `Station ${String(i + 1)}`,
        costHour: stationCostHour,
        costCycles: stationCostCycles,
        costScrap: stationCostScrap,
        total: stationTotal,
      });
    }
  }
  const totalCost = costRunningTime + costCycles + costScrap;
  const grossMargin = revenue - totalCost;
  // Output at the sink — line completed.
  const goodParts = result.completed;
  const perGoodPart = goodParts > 0 ? totalCost / goodParts : 0;
  // Find average revenue per part across configured stations so we can
  // compute break-even.
  const revStations = chainNodeIds
    .map((id) => nodeById.get(id))
    .filter((n): n is Node => !!n)
    .map((n) => readCosts(n.data).revenuePerPart ?? 0)
    .filter((v) => v > 0);
  const avgRevPerPart =
    revStations.length > 0 ? revStations.reduce((a, b) => a + b, 0) / revStations.length : 0;
  const breakEvenPerHour =
    avgRevPerPart > 0 && horizonHours > 0 ? totalCost / horizonHours / avgRevPerPart : null;
  if (totalCost === 0 && revenue === 0) return null;
  return {
    horizonHours,
    revenue,
    costRunningTime,
    costCycles,
    costScrap,
    totalCost,
    grossMargin,
    perGoodPart,
    breakEvenThroughputPerHour: breakEvenPerHour,
    perStation,
  };
}
