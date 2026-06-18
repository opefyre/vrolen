/**
 * KPI accumulators — minimum viable set for Phase 0 (VROL-120).
 *
 * The full OEE / utilization / labor-utilization stack lands in VROL-138.
 * This file ships only what Phase 0 needs:
 *   - ThroughputKPI: counts completed parts and computes throughput (parts /
 *     simulated unit time). Subscribes to CycleExecutor completion events.
 *
 * Throughput is the load-bearing KPI for the Phase 0 milestone: validates
 * that scheduler + state machine + sampling + cycle execution + buffers
 * all compose correctly. Little's Law (L = λW) is the regression test for
 * the engine's internal consistency.
 */

import type { StationId } from "./ids";
import type { CycleExecutor, CompletionEvent } from "./cycle-execution";

export class ThroughputKPI {
  private completed_ = 0;
  private scrapped_ = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    public readonly stationId: StationId,
    public readonly startTimeMs: number = 0,
  ) {}

  /** Subscribe to a CycleExecutor's completion stream. Idempotent. */
  attach<P>(executor: CycleExecutor<P>): void {
    this.unsubscribe?.();
    this.unsubscribe = executor.onCompletion((event: CompletionEvent<P>) => {
      if (event.defective) {
        this.scrapped_ += 1;
      } else {
        this.completed_ += 1;
      }
    });
  }

  /** Stop counting (e.g., at sprint end). Safe to call multiple times. */
  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Good parts that made it downstream. */
  get completed(): number {
    return this.completed_;
  }

  /** Defective parts that were scrapped. */
  get scrapped(): number {
    return this.scrapped_;
  }

  /** Total parts attempted (good + scrapped). */
  get total(): number {
    return this.completed_ + this.scrapped_;
  }

  /** Throughput in parts-per-millisecond at simulated time `endTimeMs`. */
  throughput(endTimeMs: number): number {
    const elapsed = endTimeMs - this.startTimeMs;
    if (elapsed <= 0) return 0;
    return this.completed_ / elapsed;
  }

  /** Throughput in parts-per-second for human-readable reporting. */
  throughputPerSecond(endTimeMs: number): number {
    return this.throughput(endTimeMs) * 1000;
  }

  /** Throughput in parts-per-hour. */
  throughputPerHour(endTimeMs: number): number {
    return this.throughput(endTimeMs) * 3_600_000;
  }
}
