import { describe, expect, it } from "vitest";

import { BreakdownManager } from "./breakdown";
import type { Distribution } from "./distribution";
import { constant } from "./distribution";
import type { EngineEvent } from "./events";
import { newStationId } from "./ids";
import { SeededPrng } from "./prng";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";

describe("BreakdownManager", () => {
  it("schedules a breakdown event when armed", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);

    const mgr = new BreakdownManager(
      id,
      constant(1000),
      constant(100),
      sm,
      scheduler,
      new SeededPrng(1),
    );
    mgr.arm(0);

    expect(scheduler.size).toBe(1);
    const ev = scheduler.peek();
    expect(ev?.timeMs).toBe(1000);
    expect(ev?.payload.kind).toBe("breakdown-start");
  });

  it("transitions Running → Down on breakdown + schedules repair", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);

    const mgr = new BreakdownManager(
      id,
      constant(500),
      constant(200),
      sm,
      scheduler,
      new SeededPrng(1),
    );
    mgr.arm(0);
    // Fast-forward to breakdown
    const breakdownEvent = scheduler.popMin();
    expect(breakdownEvent.payload.kind).toBe("breakdown-start");

    mgr.handleBreakdown(500);

    expect(sm.state).toBe("Down");
    expect(scheduler.size).toBe(1);
    const repair = scheduler.peek();
    expect(repair?.timeMs).toBe(700); // 500 + 200
    expect(repair?.payload.kind).toBe("repair-complete");
  });

  it("transitions Down → Idle on repair", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);

    const mgr = new BreakdownManager(
      id,
      constant(500),
      constant(200),
      sm,
      scheduler,
      new SeededPrng(1),
    );
    mgr.arm(0);
    scheduler.popMin();
    mgr.handleBreakdown(500);
    scheduler.popMin();
    mgr.handleRepair(700);

    expect(sm.state).toBe("Idle");
    expect(scheduler.size).toBe(0);
  });

  it("availability ≈ MTBF / (MTBF + MTTR) over a long sim", () => {
    // MTBF = 1000ms, MTTR = 100ms. Expected availability = 1000/1100 ≈ 90.9%.
    // Simulate the breakdown manager in isolation, tracking time-in-Running
    // vs time-in-Down.
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    const mtbf: Distribution = { kind: "exponential", rate: 1 / 1000 };
    const mttr: Distribution = { kind: "exponential", rate: 1 / 100 };
    const mgr = new BreakdownManager(id, mtbf, mttr, sm, scheduler, new SeededPrng(42));

    sm.transition("Running", "start-cycle", 0);
    mgr.arm(0);

    let runningTime = 0;
    let downTime = 0;
    let lastTransitionMs = 0;

    sm.onStateChange((e) => {
      const delta = e.timeMs - lastTransitionMs;
      if (e.fromState === "Running") runningTime += delta;
      else if (e.fromState === "Down") downTime += delta;
      lastTransitionMs = e.timeMs;
    });

    const HORIZON = 1_000_000; // 1000 seconds simulated
    while (scheduler.size > 0) {
      const peeked = scheduler.peek();
      if (!peeked || peeked.timeMs > HORIZON) break;
      const ev = scheduler.popMin();
      if (ev.payload.kind === "breakdown-start") {
        mgr.handleBreakdown(ev.timeMs);
      } else if (ev.payload.kind === "repair-complete") {
        mgr.handleRepair(ev.timeMs);
        // Re-arm in Running (immediately re-enter Running for this isolated test).
        sm.transition("Running", "start-cycle", ev.timeMs);
        mgr.arm(ev.timeMs);
      }
    }

    // Catch the final segment up to horizon
    const finalDelta = HORIZON - lastTransitionMs;
    if (sm.state === "Running") runningTime += finalDelta;
    if (sm.state === "Down") downTime += finalDelta;

    const total = runningTime + downTime;
    expect(total).toBeGreaterThan(HORIZON * 0.99);
    const availability = runningTime / total;
    const expected = 1000 / 1100;
    expect(Math.abs(availability - expected)).toBeLessThan(0.02);
  });

  // VROL-968 — pre-fix, a breakdown that fired while the station was in
  // Maintenance was silently disarmed and never rescheduled. This biased
  // Availability upward on CIP-heavy / PM-heavy lines. The fix reschedules
  // the breakdown after one MTBF sample so failures actually count after
  // planned downtime ends.
  it("reschedules a breakdown that fires during Maintenance instead of dropping it", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);
    sm.transition("Maintenance", "maintenance-start", 100);

    const mgr = new BreakdownManager(
      id,
      constant(500),
      constant(50),
      sm,
      scheduler,
      new SeededPrng(1),
    );
    // Manually fire the breakdown handler while in Maintenance.
    mgr.handleBreakdown(200);

    // Post-fix: a NEW breakdown-start event has been scheduled. Station
    // stays in Maintenance; no Down transition happens.
    expect(sm.state).toBe("Maintenance");
    let scheduledBreakdowns = 0;
    while (scheduler.size > 0) {
      const ev = scheduler.popMin();
      if (ev.payload.kind === "breakdown-start") scheduledBreakdowns += 1;
    }
    expect(scheduledBreakdowns).toBeGreaterThan(0);
  });
});
