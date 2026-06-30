import type { ChainResult } from "@/engine";
import type { ReactNode } from "react";

/**
 * VROL-1188 (Sprint 195) — overview KPI 4-tile grid extracted from
 * ResultPanel.tsx. The `tile` render-prop stays in ResultPanel because
 * it closes over local helpers (glossary lookups, replication KPIs,
 * drilldown setters, tooltips) that don't make sense to thread through
 * as props. This component owns the grid layout + the TEEP IIFE branch
 * so ResultPanel's overview body shrinks to a single call.
 *
 * Hides the TEEP tile when no maintenance windows were configured
 * (TEEP would equal OEE and the tile would be visually redundant).
 */
export type OverviewTileRenderer = (
  label: string,
  value: string,
  hint?: string,
  term?: string,
) => ReactNode;

export function OverviewKpiGrid({
  result,
  tile,
  fmt,
}: {
  readonly result: ChainResult;
  readonly tile: OverviewTileRenderer;
  readonly fmt: (n: number, digits?: number) => string;
}) {
  const teepTile = (() => {
    const maintMs = (result.perStationMaintenanceMs ?? []).reduce((s, v) => s + v, 0);
    if (result.elapsedMs <= 0 || maintMs <= 0) return null;
    const stationCount = result.perStationOee.length || 1;
    const avgMaintMs = maintMs / stationCount;
    const loading = Math.max(0, 1 - avgMaintMs / result.elapsedMs);
    const teep = result.lineOee * loading;
    return tile("TEEP", `${fmt(teep * 100)}%`, "OEE × loading (includes maintenance)", "teep");
  })();
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" data-testid="result-overview-kpi-grid">
      {tile(
        "Completed",
        result.completed.toLocaleString(),
        "during measurement window",
        "throughput",
      )}
      {tile("Line efficiency", `${fmt(result.lineOee * 100)}%`, "throughput vs theoretical", "oee")}
      {teepTile}
      {tile("Time-in-system", `${fmt(result.avgTimeInSystemW, 0)} ms`, "average W per part", "wip")}
    </div>
  );
}
