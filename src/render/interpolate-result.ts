/**
 * VROL-226 (Sprint 202) — sample interpolation for the Playback view.
 *
 * The engine emits `TimeseriesSample[]` at fixed `samplerIntervalMs`
 * intervals; every counter on a sample is monotonic. Given a
 * simTimeMs from the scrubber, this module linearly interpolates the
 * cumulative counters at that instant and rebuilds the derived state
 * (per-station running-pct, bottleneck, throughput) so Playback can
 * replay a scenario through time rather than showing steady-state.
 *
 * Design choices:
 *   - Pure function; no clock reads, no Date.now. The parent owns the
 *     controlled clock (already the editor's playback engine).
 *   - Returns a partial ChainResult with only the fields the Playback
 *     scene builder reads (perStationRunningPct, bottleneckStationIdx,
 *     throughputLambda, perStationCompleted, samples[last]. Everything
 *     else is copied from the source result.
 *   - Rolling window for running-pct: (Running ms in last WINDOW_MS) /
 *     span so early-run frames don't average against zero history and
 *     late-run frames don't drown detail in lifetime cumulative.
 */

import type { ChainResult, TimeseriesSample } from "@/engine";

const ROLLING_WINDOW_MS = 5_000;

/** Find the interval [i, i+1] bracketing tMs. Returns null when out of range. */
function bracket(
  samples: readonly TimeseriesSample[],
  tMs: number,
): { readonly a: TimeseriesSample; readonly b: TimeseriesSample; readonly f: number } | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (tMs <= first.tMs) return { a: first, b: first, f: 0 };
  if (tMs >= last.tMs) return { a: last, b: last, f: 0 };
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    if (a.tMs <= tMs && tMs <= b.tMs) {
      const span = b.tMs - a.tMs;
      const f = span > 0 ? (tMs - a.tMs) / span : 0;
      return { a, b, f };
    }
  }
  return { a: last, b: last, f: 0 };
}

function interpScalar(
  samples: readonly TimeseriesSample[],
  tMs: number,
  key: keyof TimeseriesSample,
): number {
  const bk = bracket(samples, tMs);
  if (!bk) return 0;
  const va = (bk.a[key] as number | undefined) ?? 0;
  const vb = (bk.b[key] as number | undefined) ?? va;
  return va + (vb - va) * bk.f;
}

function interpArray(
  samples: readonly TimeseriesSample[],
  tMs: number,
  key: keyof TimeseriesSample,
): number[] {
  const bk = bracket(samples, tMs);
  if (!bk) return [];
  const arrA = (bk.a[key] as readonly number[] | undefined) ?? [];
  const arrB = (bk.b[key] as readonly number[] | undefined) ?? [];
  const n = Math.max(arrA.length, arrB.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const va = arrA[i] ?? 0;
    const vb = arrB[i] ?? va;
    out[i] = va + (vb - va) * bk.f;
  }
  return out;
}

function interpStateMs(
  samples: readonly TimeseriesSample[],
  tMs: number,
): Readonly<Record<string, number>>[] {
  const bk = bracket(samples, tMs);
  if (!bk) return [];
  const n = Math.max(bk.a.perStationStateMs.length, bk.b.perStationStateMs.length);
  const out: Record<string, number>[] = [];
  for (let i = 0; i < n; i++) {
    const sa = bk.a.perStationStateMs[i] ?? {};
    const sb = bk.b.perStationStateMs[i] ?? sa;
    const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
    const merged: Record<string, number> = {};
    for (const k of keys) {
      const va = sa[k] ?? 0;
      const vb = sb[k] ?? va;
      merged[k] = va + (vb - va) * bk.f;
    }
    out.push(merged);
  }
  return out;
}

/** Rolling running-pct per station over WINDOW_MS ending at tMs. */
function rollingRunningPct(
  samples: readonly TimeseriesSample[],
  tMs: number,
  stationCount: number,
): number[] {
  const windowStart = Math.max(0, tMs - ROLLING_WINDOW_MS);
  const now = interpStateMs(samples, tMs);
  const then = interpStateMs(samples, windowStart);
  const spanMs = tMs - windowStart;
  const out = new Array<number>(stationCount).fill(0);
  if (spanMs <= 0) return out;
  for (let i = 0; i < stationCount; i++) {
    const nowMs = now[i]?.["Running"] ?? 0;
    const thenMs = then[i]?.["Running"] ?? 0;
    out[i] = Math.max(0, Math.min(1, (nowMs - thenMs) / spanMs));
  }
  return out;
}

function pickBottleneckIdx(runningPcts: readonly number[]): number {
  let best = -1;
  let bestVal = -1;
  for (let i = 0; i < runningPcts.length; i++) {
    const v = runningPcts[i] ?? 0;
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

/**
 * Return a snapshot ChainResult at simTimeMs. When the source result
 * has fewer than 2 samples the input is returned unchanged (nothing
 * to interpolate against).
 */
export function interpolateResultAt(result: ChainResult, simTimeMs: number): ChainResult {
  const samples = result.samples;
  if (samples.length < 2) return result;
  const stationCount = result.perStationRunningPct.length;
  const runningPcts = rollingRunningPct(samples, simTimeMs, stationCount);
  const bottleneckIdx = pickBottleneckIdx(runningPcts);
  const windowStart = Math.max(0, simTimeMs - ROLLING_WINDOW_MS);
  const spanMs = simTimeMs - windowStart;
  const lineNow = interpScalar(samples, simTimeMs, "lineCompleted");
  const lineThen = interpScalar(samples, windowStart, "lineCompleted");
  const throughputPerMs = spanMs > 0 ? Math.max(0, (lineNow - lineThen) / spanMs) : 0;
  const completedInterp = interpArray(samples, simTimeMs, "perStationCompleted");

  const syntheticSample: TimeseriesSample = {
    tMs: simTimeMs,
    lineCompleted: lineNow,
    perStationCompleted: completedInterp,
    perEdgeBufferFill: interpArray(samples, simTimeMs, "perEdgeBufferFill"),
    perStationStateMs: interpStateMs(samples, simTimeMs),
    perStationRework: interpArray(samples, simTimeMs, "perStationRework"),
    perStationTempScrap: interpArray(samples, simTimeMs, "perStationTempScrap"),
    perStationToolBlockedMs: interpArray(samples, simTimeMs, "perStationToolBlockedMs"),
    perStationBomStarved: interpArray(samples, simTimeMs, "perStationBomStarved"),
    perStationSkuRouted: interpArray(samples, simTimeMs, "perStationSkuRouted"),
    perStationEnergyJ: interpArray(samples, simTimeMs, "perStationEnergyJ"),
    perStationWaterL: interpArray(samples, simTimeMs, "perStationWaterL"),
    perStationCO2eG: interpArray(samples, simTimeMs, "perStationCO2eG"),
  };

  return {
    ...result,
    perStationRunningPct: runningPcts,
    bottleneckStationIdx: bottleneckIdx >= 0 ? bottleneckIdx : result.bottleneckStationIdx,
    throughputLambda: throughputPerMs,
    perStationCompleted: completedInterp.map((v) => Math.round(v)),
    samples: [syntheticSample],
  };
}
