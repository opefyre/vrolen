/**
 * Live simulation playback derivation.
 *
 * Given a finished ChainResult + a desired playback time (ms), derive
 * the per-station "current state" and per-edge buffer fill at that
 * instant so the canvas can paint stations + edges as if the simulation
 * were running live.
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

export function derivePlayback(result: ChainResult, tMs: number): PlaybackSnapshot {
  const samples = result.samples;
  if (samples.length === 0) {
    return {
      tMs,
      lineCompleted: result.completed,
      perStationState: [],
      perEdgeFill: [],
      perStationCompleted: result.perStationCompleted,
    };
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

  return {
    tMs: clampedT,
    lineCompleted,
    perStationState,
    perEdgeFill,
    perStationCompleted,
  };
}
