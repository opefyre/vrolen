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

  lines.push("station_idx,label,completed,scrapped,reworked,availability,performance,quality,oee");
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
      ]),
    );
  }

  return lines.join("\n");
}
