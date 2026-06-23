/**
 * Live simulation playback derivation.
 *
 * Given a finished ChainResult + a desired playback time (ms), derive
 * everything the canvas + KPI strip + result-panel charts need to render
 * the world AT THAT INSTANT, not at horizon-end.
 *
 * Approach:
 *   - Binary-search samples[] for the closest sample <= playbackTimeMs.
 *   - For station "current state", diff perStationStateMs between the
 *     surrounding samples and pick the state whose increment was
 *     largest in that interval (the dominant state during the window).
 *     Falls back to the first sample's dominant state for t < first
 *     sample.
 *   - For buffer fill, lerp linearly between surrounding samples.
 *   - lineCompleted lerps linearly too, so the playback clock shows
 *     a smooth count rather than the sample step.
 *
 * VROL-905 — Widened snapshot. Adds:
 *   - sampleIdxAtT: which sample the playhead currently sits at. Charts can
 *     slice `result.samples.slice(0, sampleIdxAtT + 1)` to render only the
 *     "so far" series.
 *   - kpi: throughput/h, line efficiency, completed, time-in-system,
 *     bottleneck label + run-pct, computed AT the playhead, not at horizon.
 *   - perStation: time-weighted state mix, running pct, and completed count
 *     AT the playhead. Used by canvas state-mix bars and any per-station
 *     surface that should animate (VROL-907).
 *
 * Performance budget: one O(stations + edges + states) walk per tick.
 * Designed for 60fps over typical sampler-resolution runs (≤ 30k samples).
 */

import type { ChainResult, TimeseriesSample } from "@/engine";

export type StationState =
  | "Running"
  | "Starved"
  | "BlockedOut"
  | "Down"
  | "Setup"
  | "Maintenance"
  | "Idle";

export interface PlaybackKpi {
  /** Line throughput at the playhead, parts per hour. */
  readonly throughputPerHr: number;
  /** Line efficiency = actual throughput / theoretical bottleneck rate, 0–1. */
  readonly lineEfficiencyPct: number;
  /** Completed parts to date at the playhead (interpolated). */
  readonly completed: number;
  /** Average time-in-system at the playhead, ms. Approximated by Little's Law. */
  readonly avgTimeInSystemMs: number;
  /** Empirical bottleneck label at the playhead (highest cumulative runningPct). */
  readonly bottleneckLabel: string | null;
  /** Bottleneck running %, 0–1. */
  readonly bottleneckRunPct: number;
}

export interface PlaybackPerStation {
  /** Time-weighted state mix UP TO the playhead. */
  readonly stateMix: ReadonlyArray<{ readonly state: string; readonly pct: number }>;
  /** Running fraction up to the playhead, 0–1. */
  readonly runningPct: number;
  /** Cumulative parts completed up to the playhead (interpolated). */
  readonly completed: number;
}

export interface PlaybackSnapshot {
  /** Effective playback time clamped to [0, horizon]. */
  readonly tMs: number;
  /** Smoothly-interpolated line completed count at tMs. */
  readonly lineCompleted: number;
  /** Per-station dominant state at tMs. Empty when no samples. */
  readonly perStationState: readonly StationState[];
  /** Per-edge buffer fill at tMs (linear-interpolated). Empty when no samples. */
  readonly perEdgeFill: readonly number[];
  /** Per-station cumulative completed count at tMs (linear-interpolated). */
  readonly perStationCompleted: readonly number[];
  /** VROL-905 — index of the sample at or just below the playhead. */
  readonly sampleIdxAtT: number;
  /** VROL-905 — line-level KPI snapshot at the playhead. */
  readonly kpi: PlaybackKpi;
  /** VROL-905 — per-station state mix + running pct + completed at the playhead. */
  readonly perStation: readonly PlaybackPerStation[];
}

const STATE_KEYS: readonly StationState[] = [
  "Running",
  "Starved",
  "BlockedOut",
  "Down",
  "Setup",
  "Maintenance",
  "Idle",
];

function dominantStateFromCumulative(cum: Readonly<Record<string, number>>): StationState {
  let best: StationState = "Idle";
  let bestMs = -1;
  for (const k of STATE_KEYS) {
    const v = cum[k] ?? 0;
    if (v > bestMs) {
      bestMs = v;
      best = k;
    }
  }
  return best;
}

function dominantStateFromDelta(
  prev: Readonly<Record<string, number>>,
  next: Readonly<Record<string, number>>,
): StationState {
  let best: StationState = "Idle";
  let bestDelta = -1;
  for (const k of STATE_KEYS) {
    const d = (next[k] ?? 0) - (prev[k] ?? 0);
    if (d > bestDelta) {
      bestDelta = d;
      best = k;
    }
  }
  // If no state advanced at all in this interval, fall back to the
  // dominant cumulative state from `next`.
  if (bestDelta <= 0) return dominantStateFromCumulative(next);
  return best;
}

function findSampleIdx(samples: readonly TimeseriesSample[], tMs: number): number {
  if (samples.length === 0) return -1;
  // Binary search for the largest i with samples[i].tMs <= tMs.
  let lo = 0;
  let hi = samples.length - 1;
  if (tMs <= (samples[0]?.tMs ?? 0)) return 0;
  if (tMs >= (samples[hi]?.tMs ?? 0)) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((samples[mid]?.tMs ?? 0) <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lerp(a: number, b: number, frac: number): number {
  return a + (b - a) * frac;
}

/**
 * VROL-905 — fallback snapshot when there are no samples. Returns the
 * end-of-run aggregates so consumers can fall back to "static" data and
 * the type stays uniform regardless of sampler config.
 */
function emptySnapshot(result: ChainResult, tMs: number): PlaybackSnapshot {
  const bottlenecks = result.bottlenecks ?? [];
  return {
    tMs,
    lineCompleted: result.completed ?? 0,
    perStationState: [],
    perEdgeFill: [],
    perStationCompleted: result.perStationCompleted ?? [],
    sampleIdxAtT: -1,
    kpi: {
      throughputPerHr: (result.throughputLambda ?? 0) * 3_600_000,
      lineEfficiencyPct: result.lineOee ?? 0,
      completed: result.completed ?? 0,
      avgTimeInSystemMs: result.avgTimeInSystemW ?? 0,
      bottleneckLabel: bottlenecks[0]?.label ?? null,
      bottleneckRunPct: bottlenecks[0]?.runningPct ?? 0,
    },
    perStation: [],
  };
}

export function derivePlayback(result: ChainResult, tMs: number): PlaybackSnapshot {
  const samples = result.samples;
  if (samples.length === 0) {
    return emptySnapshot(result, tMs);
  }
  const last = samples[samples.length - 1]!;
  const first = samples[0]!;
  const clampedT = Math.max(first.tMs, Math.min(tMs, last.tMs));
  const i = findSampleIdx(samples, clampedT);
  const cur = samples[i]!;
  const next = samples[i + 1];
  const frac = next && next.tMs > cur.tMs ? (clampedT - cur.tMs) / (next.tMs - cur.tMs) : 0;

  // Line completed — lerp between cur and next when we have one.
  const lineCompleted = next
    ? lerp(cur.lineCompleted, next.lineCompleted, frac)
    : cur.lineCompleted;

  // Per-station completed — lerp aligned counts.
  const stations = cur.perStationCompleted.length;
  const perStationCompleted = new Array<number>(stations);
  for (let s = 0; s < stations; s++) {
    perStationCompleted[s] = next
      ? lerp(cur.perStationCompleted[s] ?? 0, next.perStationCompleted[s] ?? 0, frac)
      : (cur.perStationCompleted[s] ?? 0);
  }

  // Per-edge fill — lerp aligned fills.
  const edges = cur.perEdgeBufferFill.length;
  const perEdgeFill = new Array<number>(edges);
  for (let e = 0; e < edges; e++) {
    perEdgeFill[e] = next
      ? lerp(cur.perEdgeBufferFill[e] ?? 0, next.perEdgeBufferFill[e] ?? 0, frac)
      : (cur.perEdgeBufferFill[e] ?? 0);
  }

  // Per-station dominant state — diff perStationStateMs between i-1 and i
  // (or between i and i+1 when at the start). When the sampler ran with
  // a single sample we can only fall back to cumulative.
  const perStationState = new Array<StationState>(stations);
  for (let s = 0; s < stations; s++) {
    const stateCur = cur.perStationStateMs[s];
    if (!stateCur) {
      perStationState[s] = "Idle";
      continue;
    }
    // For t inside (cur, next), the "what's happening NOW" is the
    // delta forward. Fall back to the delta from the prior sample when
    // we're at the last sample, or to cumulative when neither neighbor
    // exists.
    if (next) {
      const stateNext = next.perStationStateMs[s];
      if (stateNext) {
        perStationState[s] = dominantStateFromDelta(stateCur, stateNext);
        continue;
      }
    }
    if (i > 0) {
      const stateLast = samples[i - 1]?.perStationStateMs[s];
      if (stateLast) {
        perStationState[s] = dominantStateFromDelta(stateLast, stateCur);
        continue;
      }
    }
    perStationState[s] = dominantStateFromCumulative(stateCur);
  }

  // VROL-905 — KPI block at the playhead. Derived from the same lerp/clip
  // values used by the canvas + station-mix surfaces so everything stays
  // internally consistent. Falls back to result.* at horizon-end so the
  // playhead-at-horizon invariant holds.
  // throughputLambda(t) in parts/ms = lineCompleted(t) / tMs(t).
  const lambdaAtT = clampedT > 0 ? lineCompleted / clampedT : 0;
  // Bottleneck theoretical cycle, derived from the end-of-run pair so we
  // don't need to recompute it per-tick. result.lineOee = lambda_horizon ×
  // bottleneckIdealCycleMs. Invert. Guard against 0/0.
  const bottleneckIdealCycleMs =
    result.throughputLambda > 0 ? result.lineOee / result.throughputLambda : 0;
  const efficiencyAtT =
    bottleneckIdealCycleMs > 0 ? Math.min(1, Math.max(0, lambdaAtT * bottleneckIdealCycleMs)) : 0;
  // Average time-in-system at t — Little's Law: W = L / λ. L is current WIP
  // ≈ sum(perEdgeFill). At horizon-end this only approximates result.avgTimeInSystemW
  // because the engine's W includes time spent IN stations too; this is a
  // playback-time approximation, not a re-derivation of the true W.
  let wipNow = 0;
  for (const f of perEdgeFill) wipNow += f;
  const lambdaPerMsAtT = lambdaAtT;
  const avgTimeInSystemMs = lambdaPerMsAtT > 0 ? wipNow / lambdaPerMsAtT : result.avgTimeInSystemW;

  // Per-station — state mix + running pct + completed at the playhead.
  // Cumulative ms / cur.tMs gives a time-weighted mix UP TO this sample.
  // For the playhead frac inside (cur, next) the mix doesn't move enough to
  // notice — we use cur for simplicity to keep this O(stations × states).
  const perStation = new Array<PlaybackPerStation>(stations);
  let bestBnIdx = -1;
  let bestBnRunPct = -1;
  const sampleT = cur.tMs;
  for (let s = 0; s < stations; s++) {
    const stateCur = cur.perStationStateMs[s];
    if (!stateCur || sampleT <= 0) {
      perStation[s] = {
        stateMix: [],
        runningPct: 0,
        completed: perStationCompleted[s] ?? 0,
      };
      continue;
    }
    let totalMs = 0;
    for (const k of STATE_KEYS) totalMs += stateCur[k] ?? 0;
    if (totalMs <= 0) {
      perStation[s] = {
        stateMix: [],
        runningPct: 0,
        completed: perStationCompleted[s] ?? 0,
      };
      continue;
    }
    const stateMix: Array<{ state: string; pct: number }> = [];
    for (const k of STATE_KEYS) {
      const ms = stateCur[k] ?? 0;
      if (ms <= 0) continue;
      stateMix.push({ state: k, pct: ms / totalMs });
    }
    stateMix.sort((a, b) => b.pct - a.pct);
    const runningPct = (stateCur.Running ?? 0) / totalMs;
    if (runningPct > bestBnRunPct) {
      bestBnRunPct = runningPct;
      bestBnIdx = s;
    }
    perStation[s] = {
      stateMix,
      runningPct,
      completed: perStationCompleted[s] ?? 0,
    };
  }
  const bottleneckLabel = bestBnIdx >= 0 ? (result.perStationLabels?.[bestBnIdx] ?? null) : null;
  const bottleneckRunPct = bestBnRunPct > 0 ? bestBnRunPct : 0;

  return {
    tMs: clampedT,
    lineCompleted,
    perStationState,
    perEdgeFill,
    perStationCompleted,
    sampleIdxAtT: i,
    kpi: {
      throughputPerHr: lambdaAtT * 3_600_000,
      lineEfficiencyPct: efficiencyAtT,
      completed: lineCompleted,
      avgTimeInSystemMs,
      bottleneckLabel,
      bottleneckRunPct,
    },
    perStation,
  };
}
