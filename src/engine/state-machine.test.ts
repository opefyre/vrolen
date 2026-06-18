import { describe, expect, it, vi } from "vitest";

import { newStationId } from "./ids";
import {
  InvalidTransitionError,
  StationStateMachine,
  isProductive,
  isUnavailable,
  isUnplannedDowntime,
  type StationState,
  type StationStateChange,
} from "./state-machine";

describe("StationStateMachine — initial state", () => {
  it("starts in Idle", () => {
    const sm = new StationStateMachine(newStationId());
    expect(sm.state).toBe("Idle");
  });
});

describe("StationStateMachine — valid transitions", () => {
  it("Idle → Running emits a StationStateChange event", () => {
    const id = newStationId();
    const sm = new StationStateMachine(id);
    const events: StationStateChange[] = [];
    sm.onStateChange((e) => events.push(e));

    sm.transition("Running", "start-cycle", 100);

    expect(sm.state).toBe("Running");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      stationId: id,
      fromState: "Idle",
      toState: "Running",
      reason: "start-cycle",
      timeMs: 100,
    });
  });

  it("Running → Down (breakdown) is allowed", () => {
    const sm = new StationStateMachine(newStationId());
    sm.transition("Running", "start-cycle", 0);
    expect(() => {
      sm.transition("Down", "breakdown", 500);
    }).not.toThrow();
    expect(sm.state).toBe("Down");
  });

  it("Down → Running (repair complete, part queued) is allowed", () => {
    const sm = new StationStateMachine(newStationId());
    sm.transition("Running", "start-cycle", 0);
    sm.transition("Down", "breakdown", 500);
    sm.transition("Running", "repair-complete", 1000);
    expect(sm.state).toBe("Running");
  });

  it("Running → BlockedOut → Running cycle works", () => {
    const sm = new StationStateMachine(newStationId());
    sm.transition("Running", "start-cycle", 0);
    sm.transition("BlockedOut", "blocked-downstream", 100);
    expect(sm.state).toBe("BlockedOut");
    sm.transition("Running", "downstream-cleared", 200);
    expect(sm.state).toBe("Running");
  });
});

describe("StationStateMachine — invalid transitions", () => {
  it("throws InvalidTransitionError on Idle → BlockedOut (not in allowed set)", () => {
    const sm = new StationStateMachine(newStationId());
    expect(() => {
      sm.transition("BlockedOut", "blocked-downstream", 0);
    }).toThrow(InvalidTransitionError);
    // State is unchanged on failure
    expect(sm.state).toBe("Idle");
  });

  it("throws InvalidTransitionError on Down → BlockedOut", () => {
    const sm = new StationStateMachine(newStationId());
    sm.transition("Running", "start-cycle", 0);
    sm.transition("Down", "breakdown", 100);
    expect(() => {
      sm.transition("BlockedOut", "blocked-downstream", 200);
    }).toThrow(InvalidTransitionError);
  });

  it("throws on same-state transition (X → X)", () => {
    const sm = new StationStateMachine(newStationId());
    sm.transition("Running", "start-cycle", 0);
    expect(() => {
      sm.transition("Running", "cycle-complete", 100);
    }).toThrow(InvalidTransitionError);
  });

  it("error message includes both states and the allowed targets", () => {
    const sm = new StationStateMachine(newStationId());
    try {
      sm.transition("BlockedOut", "blocked-downstream", 0);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.fromState).toBe("Idle");
      expect(err.toState).toBe("BlockedOut");
      expect(err.message).toContain("Idle");
      expect(err.message).toContain("BlockedOut");
      // Should list allowed transitions from Idle
      expect(err.message).toContain("Running");
    }
  });
});

describe("StationStateMachine — listeners", () => {
  it("supports multiple listeners — all receive each event", () => {
    const sm = new StationStateMachine(newStationId());
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    sm.onStateChange(fn1);
    sm.onStateChange(fn2);

    sm.transition("Running", "start-cycle", 0);
    sm.transition("Idle", "cycle-complete", 100);

    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops further notifications", () => {
    const sm = new StationStateMachine(newStationId());
    const fn = vi.fn();
    const unsub = sm.onStateChange(fn);

    sm.transition("Running", "start-cycle", 0);
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();

    sm.transition("Idle", "cycle-complete", 100);
    expect(fn).toHaveBeenCalledTimes(1); // still 1 — not called again
  });

  it("listener that unsubscribes inside its callback does not break iteration", () => {
    const sm = new StationStateMachine(newStationId());
    let unsub: () => void = () => {};
    const fn1 = vi.fn(() => {
      unsub();
    });
    const fn2 = vi.fn();
    unsub = sm.onStateChange(fn1);
    sm.onStateChange(fn2);

    sm.transition("Running", "start-cycle", 0);

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});

describe("convenience predicates", () => {
  it("isProductive only returns true for Running", () => {
    const states: StationState[] = [
      "Idle",
      "Setup",
      "Running",
      "BlockedOut",
      "Starved",
      "Down",
      "Maintenance",
    ];
    expect(states.filter(isProductive)).toEqual(["Running"]);
  });

  it("isUnavailable returns true only for Down and Maintenance", () => {
    expect(isUnavailable("Down")).toBe(true);
    expect(isUnavailable("Maintenance")).toBe(true);
    expect(isUnavailable("Running")).toBe(false);
    expect(isUnavailable("BlockedOut")).toBe(false);
  });

  it("isUnplannedDowntime returns true only for Down (Maintenance is planned)", () => {
    expect(isUnplannedDowntime("Down")).toBe(true);
    expect(isUnplannedDowntime("Maintenance")).toBe(false);
  });
});
