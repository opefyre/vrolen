/**
 * VROL-683 — ChainResult → CSV string. Two CSV sections joined by a blank
 * line: a single-row "Line" with line-level KPIs, then a per-station table.
 * Tab-safe, comma-separated, header-rowed; safe to paste into Excel /
 * Sheets / a spreadsheet column importer.
 */

import type { ChainResult } from "@/engine";

/** Quote a value if it contains commas, quotes, or newlines. */
function csvCell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v;
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: readonly (string | number)[]): string {
  return cells.map(csvCell).join(",");
}

export function resultToCsv(result: ChainResult, stationLabels?: readonly string[]): string {
  const tPerHr = result.throughputLambda * 3_600_000;
  const lines: string[] = [];

  lines.push("section,metric,value");
  lines.push(row(["line", "completed", result.completed]));
  lines.push(row(["line", "throughput_per_hour", tPerHr.toFixed(2)]));
  lines.push(row(["line", "average_wip_l", result.averageWipL.toFixed(2)]));
  lines.push(row(["line", "avg_time_in_system_ms", result.avgTimeInSystemW.toFixed(0)]));
  lines.push(row(["line", "oee", result.lineOee.toFixed(4)]));
  lines.push("");

  lines.push(
    "station_idx,label,completed,scrapped,reworked,availability,performance,quality,oee,temp_spec_scrap,tool_blocked_ms,bom_starved,sku_routed",
  );
  for (let i = 0; i < result.perStationCompleted.length; i++) {
    const label = stationLabels?.[i] ?? result.bottlenecks[i]?.label ?? `s${String(i)}`;
    const oee = result.perStationOee[i];
    lines.push(
      row([
        i,
        label,
        result.perStationCompleted[i] ?? 0,
        result.perStationScrapped[i] ?? 0,
        result.perStationReworked[i] ?? 0,
        oee ? oee.availability.toFixed(4) : "",
        oee ? oee.performance.toFixed(4) : "",
        oee ? oee.quality.toFixed(4) : "",
        oee ? oee.oee.toFixed(4) : "",
        // VROL-945 — Sprint 90/91 counters.
        result.perStationTempScrap?.[i] ?? 0,
        result.perStationToolBlockedMs?.[i] ?? 0,
        result.perStationBomStarved?.[i] ?? 0,
        result.perStationSkuRouted?.[i] ?? 0,
      ]),
    );
  }

  return lines.join("\n");
}

/**
 * VROL-945 — constraint history → CSV. One row per binding-station
 * interval from computeConstraintHistory. Empty CSV (header-only) when
 * the run has no sampler / too few samples.
 */
export function constraintHistoryToCsv(
  intervals: ReadonlyArray<{
    fromMs: number;
    toMs: number;
    stationLabel: string;
    runningPct: number;
  }>,
): string {
  const lines: string[] = ["from_ms,to_ms,station_label,running_pct"];
  for (const iv of intervals) {
    lines.push(row([iv.fromMs, iv.toMs, iv.stationLabel, (iv.runningPct * 100).toFixed(2)]));
  }
  return lines.join("\n");
}

/**
 * VROL-991 — KPI summary CSV. A single flat row with line-level
 * headlines (completed, throughput/h, OEE, TEEP, etc.) for paste into
 * a board deck spreadsheet column.
 */
export function kpiSummaryToCsv(result: ChainResult): string {
  const tPerHr = result.throughputLambda * 3_600_000;
  const maintMs = (result.perStationMaintenanceMs ?? []).reduce((s, v) => s + v, 0);
  const stationCount = Math.max(1, result.perStationOee.length);
  const loading =
    result.elapsedMs > 0 ? Math.max(0, 1 - maintMs / stationCount / result.elapsedMs) : 1;
  const teep = result.lineOee * loading;
  const lines: string[] = [];
  lines.push(
    "completed,throughput_per_hour,line_oee,teep,avg_wip,avg_time_in_system_ms,line_scrap_rate,bottleneck,clamped_samples",
  );
  lines.push(
    row([
      result.completed,
      tPerHr.toFixed(2),
      result.lineOee.toFixed(4),
      teep.toFixed(4),
      result.averageWipL.toFixed(2),
      result.avgTimeInSystemW.toFixed(0),
      result.lineScrapRate.toFixed(4),
      result.bottlenecks[0]?.label ?? "",
      (result as { clampedSampleCount?: number }).clampedSampleCount ?? 0,
    ]),
  );
  return lines.join("\n");
}

/**
 * VROL-991 — six-loss decomposition CSV. One row per station; columns
 * are the five buckets mapped in lib/six-loss.ts (breakdown / setup /
 * minor-stop / speed-loss / defect) plus a total. Empty CSV
 * (header-only) when result has no per-station data.
 */
export function sixLossToCsv(
  rows: ReadonlyArray<{
    stationLabel: string;
    breakdownMs: number;
    setupMs: number;
    minorStopMs: number;
    speedLossMs: number;
    defectMs: number;
  }>,
): string {
  const lines: string[] = [
    "station_label,breakdown_ms,setup_ms,minor_stop_ms,speed_loss_ms,defect_ms,total_loss_ms",
  ];
  for (const r of rows) {
    const total = r.breakdownMs + r.setupMs + r.minorStopMs + r.speedLossMs + r.defectMs;
    lines.push(
      row([
        r.stationLabel,
        Math.round(r.breakdownMs),
        Math.round(r.setupMs),
        Math.round(r.minorStopMs),
        Math.round(r.speedLossMs),
        Math.round(r.defectMs),
        Math.round(total),
      ]),
    );
  }
  return lines.join("\n");
}

/**
 * VROL-991 — all-in-one CSV: concatenates KPI summary + station table +
 * six-loss + constraint history with `# section: ...` divider comments.
 * Spreadsheet importers ignore commented rows; humans get a labeled
 * single-file export.
 */
export function allInOneToCsv(
  result: ChainResult,
  stationLabels?: readonly string[],
  sixLossRows?: ReadonlyArray<{
    stationLabel: string;
    breakdownMs: number;
    setupMs: number;
    minorStopMs: number;
    speedLossMs: number;
    defectMs: number;
  }>,
  constraintIntervals?: ReadonlyArray<{
    fromMs: number;
    toMs: number;
    stationLabel: string;
    runningPct: number;
  }>,
): string {
  const parts: string[] = [];
  parts.push("# section: KPI summary");
  parts.push(kpiSummaryToCsv(result));
  parts.push("");
  parts.push("# section: Per-station");
  parts.push(resultToCsv(result, stationLabels));
  if (sixLossRows && sixLossRows.length > 0) {
    parts.push("");
    parts.push("# section: Six-loss decomposition");
    parts.push(sixLossToCsv(sixLossRows));
  }
  if (constraintIntervals && constraintIntervals.length > 0) {
    parts.push("");
    parts.push("# section: Constraint history");
    parts.push(constraintHistoryToCsv(constraintIntervals));
  }
  return parts.join("\n");
}
