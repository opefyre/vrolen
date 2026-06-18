/**
 * Time-in-state accumulator.
 *
 * Subscribe to a StationStateMachine and the tracker records how long the
 * station spends in each state over the run. Feeds bottleneck detection
 * (VROL-144) and the full OEE suite (VROL-138, future).
 *
 * Usage:
 *   const tracker = new StateTimeTracker(sm.state, currentTimeMs);
 *   sm.onStateChange((e) => tracker.recordTransition(e.toState, e.timeMs));
 *   // ... run sim ...
 *   tracker.finalize(endTimeMs);
 *   const runningPct = tracker.percentages().get("Running") ?? 0;
 *
 * The tracker is stateful but doesn't subscribe to the state machine itself —
 * the caller wires up the listener. This keeps the tracker testable in
 * isolation and lets one tracker observe events from multiple sources if
 * needed (not currently required, but the door is open).
 */

import type { StationState } from "./state-machine";

export class StateTimeTracker {
  private currentState: StationState;
  private enterTimeMs: number;
  private readonly accumulated: Map<StationState, number> = new Map();

  constructor(initialState: StationState, startTimeMs: number = 0) {
    this.currentState = initialState;
    this.enterTimeMs = startTimeMs;
  }

  /** Record a transition from currentState → toState at the given simulated time. */
  recordTransition(toState: StationState, timeMs: number): void {
    if (timeMs < this.enterTimeMs) {
      throw new Error(
        `StateTimeTracker: transition at t=${String(timeMs)} preceded the current state's entry time t=${String(this.enterTimeMs)}`,
      );
    }
    const elapsed = timeMs - this.enterTimeMs;
    this.accumulated.set(
      this.currentState,
      (this.accumulated.get(this.currentState) ?? 0) + elapsed,
    );
    this.currentState = toState;
    this.enterTimeMs = timeMs;
  }

  /**
   * Flush the current (final) state's elapsed time up to `endTimeMs`. Call
   * once at the end of the run before reading percentages — otherwise the
   * accumulated total stops at the last transition, not the run horizon.
   */
  finalize(endTimeMs: number): void {
    this.recordTransition(this.currentState, endTimeMs);
  }

  timeInState(state: StationState): number {
    return this.accumulated.get(state) ?? 0;
  }

  totalTime(): number {
    let total = 0;
    for (const t of this.accumulated.values()) total += t;
    return total;
  }

  /** Returns a fresh Map<state, percentage in [0, 1]>. Empty if no time has elapsed. */
  percentages(): Map<StationState, number> {
    const total = this.totalTime();
    if (total === 0) return new Map();
    const result = new Map<StationState, number>();
    for (const [state, time] of this.accumulated) {
      result.set(state, time / total);
    }
    return result;
  }
}
