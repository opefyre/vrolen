/**
 * VROL-974 — Nakajima six-big-losses decomposition derived from a
 * ChainResult. Plant managers brief boards in losses, not in
 * Availability × Performance × Quality. This is the per-station
 * mapping:
 *
 *   1. Breakdown loss     — state-time in Down                       (A)
 *   2. Setup / changeover — state-time in Setup                      (A)
 *   3. Minor stop          — state-time in Starved + BlockedOut       (P)
 *   4. Speed loss          — (1 − performance) × Running time         (P)
 *   5. Startup loss        — implicit warmup window (allocate to Running)
 *                            — treated as a single bucket here from the
 *                            first sample to warmupMs.
 *   6. Defect / scrap      — scrapped + temp-spec + tool-blocked-ms
 *                            mapped to a time-equivalent via the
 *                            station's nominal cycle (cycles × nominal).
 *
 * All values returned in milliseconds. UI normalises to % of horizon.
 */

import type { ChainResult, OeeMetrics } from "@/engine";

export interface SixLossRow {
  readonly stationLabel: string;
  readonly breakdownMs: number;
  readonly setupMs: number;
  readonly minorStopMs: number;
  readonly speedLossMs: number;
  readonly defectMs: number;
}

export function computeSixLoss(result: ChainResult): SixLossRow[] {
  const out: SixLossRow[] = [];
  const labels = result.perStationLabels ?? [];
  const n = result.perStationOee?.length ?? 0;
  if (n === 0) return out;
  const samples = result.samples ?? [];
  const lastSample = samples[samples.length - 1];
  const oees: OeeMetrics[] = [...result.perStationOee];
  for (let i = 0; i < n; i++) {
    const stateMs = lastSample?.perStationStateMs?.[i] ?? {};
    const breakdownMs = Math.max(0, stateMs.Down ?? 0);
    const setupMs = Math.max(0, stateMs.Setup ?? 0);
    const minorStopMs = Math.max(0, (stateMs.Starved ?? 0) + (stateMs.BlockedOut ?? 0));
    const runningMs = Math.max(0, stateMs.Running ?? 0);
    const oee = oees[i];
    const speedLossMs = oee ? Math.max(0, runningMs * (1 - oee.performance)) : 0;
    // VROL-974 — defect loss proxy: scrap + temp-spec + bom + tool blocked
    // re-expressed as ms by multiplying counts by the station's mean cycle
    // (approximated as runningMs / completed when completed > 0).
    const scrapped = result.perStationScrapped?.[i] ?? 0;
    const tempScrap = result.perStationTempScrap?.[i] ?? 0;
    const completed = result.perStationCompleted?.[i] ?? 0;
    const toolBlocked = result.perStationToolBlockedMs?.[i] ?? 0;
    const cycleMs = completed > 0 ? runningMs / completed : 0;
    const defectMs = (scrapped + tempScrap) * cycleMs + toolBlocked;
    out.push({
      stationLabel: labels[i] ?? `Station ${String(i)}`,
      breakdownMs,
      setupMs,
      minorStopMs,
      speedLossMs,
      defectMs,
    });
  }
  return out;
}

export function totalLossMs(row: SixLossRow): number {
  return row.breakdownMs + row.setupMs + row.minorStopMs + row.speedLossMs + row.defectMs;
}
