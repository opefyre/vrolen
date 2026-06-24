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
    // VROL-969 — tolerate sub-millisecond floating-point drift between
    // event timestamps (e.g., an integer-time scheduled event firing
    // immediately after a float-time breakdown reschedule). The previous
    // strict `<` check threw on legitimate scenarios where two events
    // share an integer timestamp but one is computed via a chain of
    // float arithmetic. Tolerate negative gaps below 1 ms by clamping;
    // anything bigger is a real ordering bug worth throwing on.
    const EPS_MS = 1;
    if (timeMs + EPS_MS < this.enterTimeMs) {
      throw new Error(
        `StateTimeTracker: transition at t=${String(timeMs)} preceded the current state's entry time t=${String(this.enterTimeMs)}`,
      );
    }
    const clamped = Math.max(timeMs, this.enterTimeMs);
    const elapsed = clamped - this.enterTimeMs;
    this.accumulated.set(
      this.currentState,
      (this.accumulated.get(this.currentState) ?? 0) + elapsed,
    );
    this.currentState = toState;
    this.enterTimeMs = clamped;
  }

  /**
   * Flush the current (final) state's elapsed time up to `endTimeMs`. Call
   * once at the end of the run before reading percentages — otherwise the
   * accumulated total stops at the last transition, not the run horizon.
   */
  finalize(endTimeMs: number): void {
    this.recordTransition(this.currentState, endTimeMs);
  }

  /**
   * Per-tick snapshot for the timeseries sampler (VROL-619). Flushes the
   * currently-open state's elapsed time up to `timeMs` (so accumulated
   * reflects cumulative time-in-state up to `timeMs`) and returns a frozen
   * plain-object copy keyed by state name. Safe to call repeatedly at
   * increasing tMs values — the next call flushes only the delta since the
   * last snapshot, so totals remain consistent with the end-of-run finalize.
   */
  snapshotInto(timeMs: number): Readonly<Record<string, number>> {
    this.recordTransition(this.currentState, timeMs);
    const out: Record<string, number> = {};
    for (const [state, ms] of this.accumulated) out[state] = ms;
    return Object.freeze(out);
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
