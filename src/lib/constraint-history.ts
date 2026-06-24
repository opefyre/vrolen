/**
 * VROL-932 — derive a per-interval "binding" station from the sampler stream.
 *
 * For each pair of consecutive samples, computes per-station running-share
 * across the interval (∆ms_running / ∆ms). The station with the largest
 * share is the interval's binding constraint — the empirical version of the
 * VROL-900 bindingScore but over time rather than across the whole horizon.
 *
 * Lightweight by design: no nominal-speed-ratio re-weighting (the static
 * bottlenecks card already shows that). Just the "where is the line working
 * hardest, moment by moment" view.
 */

import type { ChainResult, TimeseriesSample } from "@/engine";

export interface ConstraintInterval {
  readonly fromMs: number;
  readonly toMs: number;
  readonly stationIdx: number;
  readonly stationLabel: string;
  readonly runningPct: number;
}

export function computeConstraintHistory(result: ChainResult): ConstraintInterval[] {
  const samples = result.samples ?? [];
  if (samples.length < 2) return [];
  const labels = result.perStationLabels ?? [];
  const n = samples[0]?.perStationStateMs.length ?? 0;
  if (n === 0) return [];
  const out: ConstraintInterval[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a: TimeseriesSample = samples[i - 1] as TimeseriesSample;
    const b: TimeseriesSample = samples[i] as TimeseriesSample;
    const dt = b.tMs - a.tMs;
    if (dt <= 0) continue;
    let bestIdx = 0;
    let bestShare = -1;
    for (let s = 0; s < n; s++) {
      const aRun = (a.perStationStateMs[s] as Record<string, number>)?.Running ?? 0;
      const bRun = (b.perStationStateMs[s] as Record<string, number>)?.Running ?? 0;
      const share = Math.max(0, (bRun - aRun) / dt);
      if (share > bestShare) {
        bestShare = share;
        bestIdx = s;
      }
    }
    out.push({
      fromMs: a.tMs,
      toMs: b.tMs,
      stationIdx: bestIdx,
      stationLabel: labels[bestIdx] ?? `Station ${String(bestIdx)}`,
      runningPct: Math.max(0, bestShare),
    });
  }
  return out;
}
