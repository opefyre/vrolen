/**
 * Planned maintenance manager.
 *
 * Driven by a deterministic list of maintenance windows (start/end pairs in
 * simulated time). Each window:
 *   - On start: transition station to Maintenance
 *   - On end: transition station back to Idle so cycles can resume
 *
 * Differs from BreakdownManager (VROL-123) in two ways:
 *   1. Deterministic: same Schedule → same windows. No PRNG involvement.
 *   2. State classification: Maintenance counts as PLANNED downtime in OEE
 *      Availability (vs Down = unplanned). This matters for the KPI suite
 *      landing in VROL-138.
 *
 * SCOPE (Phase-0 prototype):
 *   - Parts in-flight at maintenance start are LOST (same trade-off as
 *     BreakdownManager — see VROL-125 / part-resume in backlog).
 */

import type { EngineEvent } from "./events";
import type { StationId } from "./ids";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";

export interface MaintenanceWindow {
  readonly startMs: number;
  readonly endMs: number;
}

export class MaintenanceManager {
  constructor(
    public readonly stationId: StationId,
    public readonly windows: readonly MaintenanceWindow[],
    public readonly stateMachine: StationStateMachine,
    public readonly scheduler: Scheduler<EngineEvent>,
  ) {
    for (const w of windows) {
      if (w.endMs <= w.startMs) {
        throw new Error(
          `MaintenanceWindow must have endMs > startMs, got ${String(w.startMs)} → ${String(w.endMs)}`,
        );
      }
    }
  }

  /**
   * Schedule all configured maintenance start/end events upfront. Call once
   * at simulation start. The engine then dispatches maintenance-start /
   * maintenance-end events to this manager as they fire.
   */
  schedule(currentTimeMs: number): void {
    for (const w of this.windows) {
      if (w.startMs >= currentTimeMs) {
        this.scheduler.schedule(w.startMs, {
          kind: "maintenance-start",
          stationId: this.stationId,
        });
      }
      if (w.endMs >= currentTimeMs) {
        this.scheduler.schedule(w.endMs, {
          kind: "maintenance-end",
          stationId: this.stationId,
        });
      }
    }
  }

  /** Called by the orchestrator when a maintenance-start event fires for this station. */
  handleMaintenanceStart(timeMs: number): void {
    const state = this.stateMachine.state;
    // If already Down, the breakdown takes precedence — maintenance window is
    // "missed" for this iteration (a real shop would extend it, but the
    // simpler engine model is fine for Phase 0). Don't transition Maintenance
    // out of Down.
    if (state === "Down" || state === "Maintenance") return;
    this.stateMachine.transition("Maintenance", "maintenance-start", timeMs);
  }

  /** Called by the orchestrator when a maintenance-end event fires for this station. */
  handleMaintenanceEnd(timeMs: number): void {
    if (this.stateMachine.state === "Maintenance") {
      this.stateMachine.transition("Idle", "maintenance-end", timeMs);
    }
  }
}
