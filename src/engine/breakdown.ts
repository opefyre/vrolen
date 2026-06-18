/**
 * Stochastic breakdown manager.
 *
 * Mean Time Between Failures (MTBF) + Mean Time To Repair (MTTR) drive the
 * cadence:
 *   - On station entering Running: schedule a breakdown at currentTime + sample(MTBF).
 *   - On breakdown firing: transition station to Down, schedule repair at currentTime + sample(MTTR).
 *   - On repair firing: transition station to Idle, attempt restart.
 *
 * Long-run availability = MTBF / (MTBF + MTTR). Tests verify this within 2%
 * on a fixture run.
 *
 * SCOPE (Phase-0 prototype):
 *   - Parts in flight at the moment of breakdown are LOST (counted as
 *     scrap by downstream KPIs). Resuming an interrupted part with its
 *     remaining cycle time is a follow-up (VROL-125) — requires per-part
 *     scheduled-time tracking inside CycleExecutor.
 */

import type { Distribution } from "./distribution";
import type { EngineEvent } from "./events";
import type { StationId } from "./ids";
import type { Prng } from "./prng";
import { sample } from "./sampling";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";

export class BreakdownManager {
  private armed = false;

  constructor(
    public readonly stationId: StationId,
    public readonly mtbfMs: Distribution,
    public readonly mttrMs: Distribution,
    public readonly stateMachine: StationStateMachine,
    public readonly scheduler: Scheduler<EngineEvent>,
    public readonly prng: Prng,
  ) {}

  /**
   * Arm the breakdown clock — schedules the next failure event. Call when the
   * station enters Running for the first time (or after a repair).
   *
   * Idempotent within a single Running interval: subsequent calls without a
   * breakdown between them schedule a second timer (caller should only invoke
   * once per Running entry).
   */
  arm(timeMs: number): void {
    if (this.armed) return;
    const timeToFailure = sample(this.mtbfMs, this.prng, { min: 0 });
    this.scheduler.schedule(timeMs + timeToFailure, {
      kind: "breakdown-start",
      stationId: this.stationId,
    });
    this.armed = true;
  }

  /** Called by the engine when a breakdown-start event fires for this station. */
  handleBreakdown(timeMs: number): void {
    const state = this.stateMachine.state;
    // If station is already Down (rare race), no-op.
    if (state === "Down" || state === "Maintenance") {
      this.armed = false;
      return;
    }
    this.stateMachine.transition("Down", "breakdown", timeMs);
    const timeToRepair = sample(this.mttrMs, this.prng, { min: 0 });
    this.scheduler.schedule(timeMs + timeToRepair, {
      kind: "repair-complete",
      stationId: this.stationId,
    });
    this.armed = false;
  }

  /**
   * Called by the engine when a repair-complete event fires. Transitions the
   * station back to Idle so the cycle executor can attempt new work.
   * Caller re-arms the breakdown clock on the next Running entry.
   */
  handleRepair(timeMs: number): void {
    if (this.stateMachine.state === "Down") {
      this.stateMachine.transition("Idle", "repair-complete", timeMs);
    }
  }
}
