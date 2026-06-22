/**
 * Instantaneous-rate helper for the throughput chart (VROL-845).
 *
 * The Sprint-845 audit asked for a second view on top of the cumulative
 * throughput curve: parts-per-hour computed as a moving window over the
 * raw samples. This lets the reader see throughput dip during maintenance,
 * recover after warmup, and oscillate as buffers fill — detail that the
 * cumulative line smooths away.
 *
 * Pure function, no React, easy to unit-test in isolation.
 */

import type { TimeseriesSample } from "@/engine";

export interface RatePoint {
  readonly tMs: number;
  readonly ratePerHour: number;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Compute a windowed dx/dt rate (in parts/hour) for each sample after warmup.
 *
 * For sample i, find the largest k such that `samples[i-k].tMs >= samples[i].tMs - windowMs`,
 * then divide the delta in lineCompleted by the delta in tMs and scale to parts/hour.
 *
 * Warmup-period samples are excluded entirely — they never appear in the output,
 * and they never serve as a lookback anchor for post-warmup samples either, so
 * the rate is computed cleanly from the post-warmup horizon.
 *
 * Returns [] if fewer than 2 post-warmup samples are available.
 */
export function computeInstantaneousRate(
  samples: readonly TimeseriesSample[],
  windowMs: number,
  warmupMs: number,
): RatePoint[] {
  const postWarmup = samples.filter((s) => s.tMs >= warmupMs);
  if (postWarmup.length < 2) return [];
  const out: RatePoint[] = [];
  for (let i = 1; i < postWarmup.length; i++) {
    const cur = postWarmup[i];
    if (!cur) continue;
    const cutoff = cur.tMs - windowMs;
    // Find the largest k (smallest index) such that postWarmup[i-k].tMs >= cutoff.
    let anchor = i - 1;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = postWarmup[j];
      if (!candidate) break;
      if (candidate.tMs >= cutoff) {
        anchor = j;
      } else {
        break;
      }
    }
    const ref = postWarmup[anchor];
    if (!ref) continue;
    const dt = cur.tMs - ref.tMs;
    if (dt <= 0) continue;
    const dParts = cur.lineCompleted - ref.lineCompleted;
    const ratePerHour = (dParts / dt) * MS_PER_HOUR;
    out.push({ tMs: cur.tMs, ratePerHour });
  }
  return out;
}
