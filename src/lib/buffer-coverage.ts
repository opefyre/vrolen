/**
 * VROL-902 — Buffer coverage relative to MTTR.
 *
 * Real lines stop when ANY station breaks if the buffers between stations
 * aren't big enough to absorb the outage. The right buffer size is bottleneck
 * rate × mean MTTR — anything smaller leaves the bottleneck starved/blocked
 * for the duration of every Down event. The classic textbook formula:
 *
 *     buffer >= bottleneckRate × MTTR
 *
 * This util takes a ChainResult and the MTTR distribution from the run config
 * and returns a per-edge coverage ratio. coverageRatio < 1.0 means the buffer
 * can't absorb one mean breakdown — the line is tightly coupled and throughput
 * collapses on every Down event. coverageRatio >= 1.5 (recommended) means
 * comfortable headroom.
 *
 * The function returns an empty array when:
 *   - no breakdowns are configured (nothing to absorb)
 *   - no buffer capacity is recorded (engine ran with capacity 0)
 *   - lineThroughput is 0 (degenerate)
 */

import type { Distribution } from "@/engine/distribution";
import { meanOf } from "@/engine/distribution";

export interface BufferCoverageInput {
  /** Capacity of THIS edge's buffer (parts). */
  readonly capacity: number;
  /** Stable id for the consumer (the canvas / Recommendations card). */
  readonly edgeId: string;
  /** Optional label like "Mixer → Filler". Only used for human display. */
  readonly label?: string;
}

export interface BufferCoverage {
  readonly edgeId: string;
  readonly label?: string;
  readonly capacity: number;
  /** Parts the buffer needs to hold to absorb one mean breakdown. */
  readonly partsToAbsorbOneMTTR: number;
  /** capacity / partsToAbsorbOneMTTR. < 1 = too small. >= 1.5 = comfortable. */
  readonly coverageRatio: number;
  /** Recommended capacity = ceil(partsToAbsorbOneMTTR × 1.5). */
  readonly recommendedCapacity: number;
  /** True when coverageRatio < 1.0 (the buffer can't absorb one mean breakdown). */
  readonly tightlyCoupled: boolean;
}

export interface BufferCoverageOptions {
  /** Line throughput, parts per ms. */
  readonly throughputLambda: number;
  /** MTTR distribution from the breakdown config. */
  readonly mttrDistribution: Distribution | undefined;
  /** Per-edge buffer capacities + identifiers, in canvas-edge order. */
  readonly edges: ReadonlyArray<BufferCoverageInput>;
  /** Safety factor for the recommended capacity. Default 1.5. */
  readonly safetyFactor?: number;
}

export function computeBufferCoverage(opts: BufferCoverageOptions): readonly BufferCoverage[] {
  const { throughputLambda, mttrDistribution, edges } = opts;
  const safety = opts.safetyFactor ?? 1.5;
  if (!mttrDistribution) return [];
  if (throughputLambda <= 0) return [];
  if (edges.length === 0) return [];
  const meanMTTRms = meanOf(mttrDistribution);
  if (!Number.isFinite(meanMTTRms) || meanMTTRms <= 0) return [];

  const partsToAbsorbOneMTTR = throughputLambda * meanMTTRms;
  if (partsToAbsorbOneMTTR <= 0) return [];

  return edges.map((e): BufferCoverage => {
    const coverageRatio = e.capacity / partsToAbsorbOneMTTR;
    const recommendedCapacity = Math.max(1, Math.ceil(partsToAbsorbOneMTTR * safety));
    return {
      edgeId: e.edgeId,
      ...(e.label !== undefined ? { label: e.label } : {}),
      capacity: e.capacity,
      partsToAbsorbOneMTTR,
      coverageRatio,
      recommendedCapacity,
      tightlyCoupled: coverageRatio < 1.0,
    };
  });
}
