import { describe, expect, it } from "vitest";

import { detectBottlenecks, topBottlenecks } from "./bottleneck";
import { asStationId } from "./ids";
import { StateTimeTracker } from "./state-time-tracker";

function trackerFromStateRecord(
  startState: string,
  transitions: Array<{ toState: string; atMs: number }>,
  endMs: number,
): StateTimeTracker {
  const t = new StateTimeTracker(startState as never, 0);
  for (const tr of transitions) {
    t.recordTransition(tr.toState as never, tr.atMs);
  }
  t.finalize(endMs);
  return t;
}

describe("detectBottlenecks", () => {
  it("identifies the slowest station (highest running %) as the bottleneck", () => {
    // Station A: 90% Running (slow constraint), 10% Idle
    // Station B: 50% Running, 50% Starved (waiting for A)
    // Station C: 50% Running, 50% Blocked (waiting on A downstream)
    const stations = [
      {
        stationId: asStationId("station-a"),
        label: "Capper",
        tracker: trackerFromStateRecord("Running", [{ toState: "Idle", atMs: 900 }], 1000),
      },
      {
        stationId: asStationId("station-b"),
        label: "Filler",
        tracker: trackerFromStateRecord("Running", [{ toState: "Starved", atMs: 500 }], 1000),
      },
      {
        stationId: asStationId("station-c"),
        label: "Labeler",
        tracker: trackerFromStateRecord("Running", [{ toState: "BlockedOut", atMs: 500 }], 1000),
      },
    ];

    const ranked = detectBottlenecks(stations);
    expect(ranked[0]?.label).toBe("Capper");
    expect(ranked[0]?.runningPct).toBeCloseTo(0.9, 5);
  });

  it("classifies starvation as primary reason for stations waiting on upstream", () => {
    const stations = [
      {
        stationId: asStationId("downstream"),
        label: "Capper",
        tracker: trackerFromStateRecord("Starved", [{ toState: "Running", atMs: 800 }], 1000),
      },
    ];
    const r = detectBottlenecks(stations);
    expect(r[0]?.primaryReason).toBe("starvation");
    expect(r[0]?.primaryReasonPct).toBeCloseTo(0.8, 5);
  });

  it("classifies blocking as primary reason for stations whose downstream is full", () => {
    const stations = [
      {
        stationId: asStationId("upstream"),
        label: "Filler",
        tracker: trackerFromStateRecord("BlockedOut", [{ toState: "Running", atMs: 700 }], 1000),
      },
    ];
    const r = detectBottlenecks(stations);
    expect(r[0]?.primaryReason).toBe("blocking");
    expect(r[0]?.primaryReasonPct).toBeCloseTo(0.7, 5);
  });

  it("classifies breakdown when station spends most time Down", () => {
    const stations = [
      {
        stationId: asStationId("broken"),
        label: "Brokenly",
        tracker: trackerFromStateRecord("Down", [{ toState: "Running", atMs: 600 }], 1000),
      },
    ];
    const r = detectBottlenecks(stations);
    expect(r[0]?.primaryReason).toBe("breakdown");
  });

  it("breakdown array is sorted by percentage descending", () => {
    const stations = [
      {
        stationId: asStationId("s"),
        tracker: trackerFromStateRecord(
          "Running",
          [
            { toState: "Idle", atMs: 700 }, // Running = 700
            { toState: "Starved", atMs: 900 }, // Idle = 200
          ],
          1000,
        ), // Starved = 100
      },
    ];
    const r = detectBottlenecks(stations);
    const breakdown = r[0]?.breakdown ?? [];
    expect(breakdown[0]?.state).toBe("Running");
    expect(breakdown[1]?.state).toBe("Idle");
    expect(breakdown[2]?.state).toBe("Starved");
  });

  it("topBottlenecks returns at most N entries", () => {
    const stations = [1, 2, 3, 4, 5].map((n) => ({
      stationId: asStationId(`s-${String(n)}`),
      tracker: trackerFromStateRecord("Running", [{ toState: "Idle", atMs: n * 100 }], 1000),
    }));
    expect(topBottlenecks(stations, 3)).toHaveLength(3);
    expect(topBottlenecks(stations, 10)).toHaveLength(5);
  });
});
