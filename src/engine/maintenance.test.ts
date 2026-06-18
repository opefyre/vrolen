import { describe, expect, it } from "vitest";

import type { EngineEvent } from "./events";
import { newStationId } from "./ids";
import { MaintenanceManager, type MaintenanceWindow } from "./maintenance";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";

describe("MaintenanceManager", () => {
  it("rejects windows with endMs <= startMs", () => {
    expect(
      () =>
        new MaintenanceManager(
          newStationId(),
          [{ startMs: 100, endMs: 100 }],
          new StationStateMachine(newStationId()),
          new Scheduler<EngineEvent>(),
        ),
    ).toThrow();
  });

  it("schedules maintenance-start and maintenance-end events for each window", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    const windows: MaintenanceWindow[] = [
      { startMs: 1000, endMs: 2000 },
      { startMs: 5000, endMs: 6000 },
    ];
    const mgr = new MaintenanceManager(id, windows, sm, scheduler);
    mgr.schedule(0);

    expect(scheduler.size).toBe(4);
    const events: EngineEvent[] = [];
    while (scheduler.size > 0) events.push(scheduler.popMin().payload);
    expect(events.map((e) => e.kind)).toEqual([
      "maintenance-start",
      "maintenance-end",
      "maintenance-start",
      "maintenance-end",
    ]);
  });

  it("transitions Running → Maintenance on start, Maintenance → Idle on end", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);

    const mgr = new MaintenanceManager(id, [{ startMs: 100, endMs: 200 }], sm, scheduler);
    mgr.schedule(0);

    // Pop start
    const startEv = scheduler.popMin();
    expect(startEv.payload.kind).toBe("maintenance-start");
    mgr.handleMaintenanceStart(startEv.timeMs);
    expect(sm.state).toBe("Maintenance");

    // Pop end
    const endEv = scheduler.popMin();
    expect(endEv.payload.kind).toBe("maintenance-end");
    mgr.handleMaintenanceEnd(endEv.timeMs);
    expect(sm.state).toBe("Idle");
  });

  it("does not transition out of Down when maintenance starts (Down wins)", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    sm.transition("Running", "start-cycle", 0);
    sm.transition("Down", "breakdown", 50);

    const mgr = new MaintenanceManager(id, [{ startMs: 100, endMs: 200 }], sm, scheduler);
    mgr.schedule(0);

    scheduler.popMin(); // maintenance-start
    mgr.handleMaintenanceStart(100);
    expect(sm.state).toBe("Down"); // unchanged
  });

  it("skips windows whose start is in the past", () => {
    const id = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const sm = new StationStateMachine(id);
    const mgr = new MaintenanceManager(
      id,
      [
        { startMs: 50, endMs: 100 }, // past
        { startMs: 500, endMs: 600 }, // future
      ],
      sm,
      scheduler,
    );
    mgr.schedule(200); // current time = 200

    // Only future window's events should be scheduled (2 events)
    expect(scheduler.size).toBe(2);
  });
});
