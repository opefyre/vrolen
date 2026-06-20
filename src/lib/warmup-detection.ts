/**
 * Welch's graphical method for warm-up period detection.
 *
 * Classic Banks / Law-Kelton heuristic: smooth the throughput-time
 * series with a moving average, then find the earliest index where
 * the curve flattens (the running mean has stabilized within a small
 * tolerance of the long-run mean).
 *
 * Reference: Law, A.M. & Kelton, W.D. — "Simulation Modeling and
 * Analysis" — Ch. 9.5.
 *
 * The function is intentionally cheap (single pass over samples) so
 * it can run on every result without a perf hit.
 */

import type { TimeseriesSample } from "@/engine";

export interface WarmupRecommendation {
  /** Recommended warmup horizon in ms, or null when the series is too short. */
  readonly recommendedMs: number | null;
  /** Confidence proxy: 0..1, higher when steady-state is more obvious. */
  readonly confidence: number;
  /** Long-run mean throughput rate used as the reference (parts/ms). */
  readonly meanLambda: number;
  /** Note suitable for surfacing in UI (short, single sentence). */
  readonly note: string;
}

const MIN_SAMPLES_FOR_DETECTION = 6;
const WINDOW_FRACTION = 0.15; // moving-average window = 15% of samples
const STABILITY_TOL = 0.05; // 5% of long-run mean

export function detectWarmup(
  samples: readonly TimeseriesSample[],
  horizonMs: number,
): WarmupRecommendation {
  if (samples.length < MIN_SAMPLES_FOR_DETECTION) {
    return {
      recommendedMs: null,
      confidence: 0,
      meanLambda: 0,
      note: "Not enough samples — run a longer horizon or smaller interval.",
    };
  }
  // Build per-sample throughput rate (parts / ms) from cumulative completed.
  const rates: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const cur = samples[i]!;
    const prev = samples[i - 1]!;
    const dt = cur.tMs - prev.tMs;
    if (dt <= 0) continue;
    rates.push((cur.lineCompleted - prev.lineCompleted) / dt);
  }
  if (rates.length < MIN_SAMPLES_FOR_DETECTION) {
    return {
      recommendedMs: null,
      confidence: 0,
      meanLambda: 0,
      note: "Throughput series collapsed — check sampler interval.",
    };
  }

  // Long-run mean rate from the last 50% of samples (post-warmup proxy).
  const tail = rates.slice(Math.floor(rates.length / 2));
  const meanLambda = tail.reduce((a, b) => a + b, 0) / tail.length;
  if (meanLambda <= 0) {
    return {
      recommendedMs: 0,
      confidence: 0,
      meanLambda: 0,
      note: "No throughput observed in steady-state window.",
    };
  }

  const w = Math.max(2, Math.floor(rates.length * WINDOW_FRACTION));
  // Forward-looking moving average — value at index i is the mean of
  // rates[i .. i+w]. We find the earliest i where the MA stays within
  // STABILITY_TOL of meanLambda for the rest of the series.
  let steadyIdx = rates.length - 1;
  for (let i = 0; i + w < rates.length; i++) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += rates[j]!;
    const ma = sum / w;
    if (Math.abs(ma - meanLambda) <= meanLambda * STABILITY_TOL) {
      steadyIdx = i;
      break;
    }
  }

  // Convert the sample index back to ms (samples[steadyIdx + 1] is the
  // first post-warmup sample because rates[i] corresponds to samples[i+1]).
  const sampleIdx = Math.min(steadyIdx + 1, samples.length - 1);
  const recommendedMs = Math.round(samples[sampleIdx]!.tMs);

  // Confidence ≈ how much of the horizon falls into steady-state. Closer
  // to 1 = strong steady-state signal; closer to 0 = warmup is the whole
  // run.
  const confidence = Math.max(0, Math.min(1, 1 - recommendedMs / Math.max(horizonMs, 1)));

  const ratioOfHorizon = recommendedMs / Math.max(horizonMs, 1);
  let note: string;
  if (ratioOfHorizon < 0.05) {
    note = "Steady-state reached almost immediately — warm-up isn't a worry here.";
  } else if (ratioOfHorizon < 0.3) {
    note = "Welch's method suggests this warm-up; KPIs from the truncated window should be stable.";
  } else if (ratioOfHorizon < 0.6) {
    note = "Warm-up takes a meaningful chunk of the horizon — consider a longer run.";
  } else {
    note = "Run never clearly reaches steady-state — extend the horizon before trusting KPIs.";
  }

  return { recommendedMs, confidence, meanLambda, note };
}
