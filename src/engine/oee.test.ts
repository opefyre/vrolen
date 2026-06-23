/**
 * OEE validation. The "Nakajima textbook" fixture (VROL-143) verifies the
 * formula matches the canonical 0.85 × 0.95 × 0.99 = 0.7994... reference.
 */

import { describe, expect, it } from "vitest";

import { newStationId } from "./ids";
import { computeOee } from "./oee";
import { StateTimeTracker } from "./state-time-tracker";
import { StationStateMachine } from "./state-machine";

describe("OEE — canonical formula", () => {
  it("reproduces a textbook A × P × Q product within float tolerance", () => {
    // Construct synthetic tracker state: 8 hours scheduled, 1 hour Down, 7 hours Running.
    // Ideal cycle = 60s. In 7h of running, ideal would produce 420 parts; actual good = 399.
    // Total parts = 405; defective = 6.
    //
    // Expected:
    //   A = 7 / (7 + 1) = 0.875
    //   P = (60_000 × 399) / (7 × 3_600_000) = 23_940_000 / 25_200_000 = 0.95
    //   Q = 399 / 405 ≈ 0.985185
    //   OEE = 0.875 × 0.95 × (399/405) ≈ 0.81913...
    const stationId = newStationId();
    const sm = new StationStateMachine(stationId);
    const tracker = new StateTimeTracker(sm.state, 0);
    sm.onStateChange((e) => {
      tracker.recordTransition(e.toState, e.timeMs);
    });

    const HOUR = 3_600_000;
    // Idle for 0 ms (starts in Idle but immediately runs)
    sm.transition("Running", "start-cycle", 0);
    // Run for 7 hours
    sm.transition("Down", "breakdown", 7 * HOUR);
    // Down for 1 hour
    sm.transition("Running", "repair-complete", 8 * HOUR);
    tracker.finalize(8 * HOUR);

    const metrics = computeOee({
      stateTimeTracker: tracker,
      idealCycleTimeMs: 60_000,
      goodParts: 399,
      totalParts: 405,
    });

    expect(metrics.availability).toBeCloseTo(0.875, 6);
    expect(metrics.performance).toBeCloseTo(0.95, 6);
    expect(metrics.quality).toBeCloseTo(399 / 405, 6);
    const expectedOee = 0.875 * 0.95 * (399 / 405);
    expect(metrics.oee).toBeCloseTo(expectedOee, 6);
    expect(metrics.runTimeMs).toBe(7 * HOUR);
    expect(metrics.downTimeMs).toBe(1 * HOUR);
  });

  it("treats zero loading time as 100% availability (textbook: machine was available but not needed)", () => {
    // VROL-897 — a station that never went Running AND never went Down
    // experienced zero unplanned downtime. By textbook semantics it's
    // 100% available. The previous behavior (pinning availability to 0)
    // mis-attributed external starvation/blocking to the station's own
    // unavailability. Performance still drops to 0 (no good parts), so
    // OEE remains 0 — but the breakdown chart now points at the right lever.
    const sm = new StationStateMachine(newStationId());
    const tracker = new StateTimeTracker(sm.state, 0);
    sm.onStateChange((e) => {
      tracker.recordTransition(e.toState, e.timeMs);
    });
    // Never went Running or Down — only Idle for the whole window
    tracker.finalize(60_000);
    const m = computeOee({
      stateTimeTracker: tracker,
      idealCycleTimeMs: 100,
      goodParts: 0,
      totalParts: 0,
    });
    expect(m.availability).toBe(1);
    expect(m.performance).toBe(0);
    expect(m.quality).toBe(1); // empty-set quality treated as perfect (matches industry convention)
    expect(m.oee).toBe(0);
  });

  it("clamps performance to 1.0 when actual run beats ideal (likely bad ideal estimate)", () => {
    const sm = new StationStateMachine(newStationId());
    const tracker = new StateTimeTracker(sm.state, 0);
    sm.onStateChange((e) => {
      tracker.recordTransition(e.toState, e.timeMs);
    });
    sm.transition("Running", "start-cycle", 0);
    tracker.finalize(1000);
    // 1000 parts in 1000 ms at "ideal" 2 ms/part → ratio = 2
    const m = computeOee({
      stateTimeTracker: tracker,
      idealCycleTimeMs: 2,
      goodParts: 1000,
      totalParts: 1000,
    });
    expect(m.performance).toBe(1);
  });

  it("Quality reflects defects independently of A or P", () => {
    const sm = new StationStateMachine(newStationId());
    const tracker = new StateTimeTracker(sm.state, 0);
    sm.onStateChange((e) => {
      tracker.recordTransition(e.toState, e.timeMs);
    });
    sm.transition("Running", "start-cycle", 0);
    tracker.finalize(10_000);
    const m = computeOee({
      stateTimeTracker: tracker,
      idealCycleTimeMs: 100,
      goodParts: 80,
      totalParts: 100, // 20 scrapped
    });
    expect(m.quality).toBeCloseTo(0.8, 6);
    expect(m.availability).toBe(1); // never went Down
  });
});
