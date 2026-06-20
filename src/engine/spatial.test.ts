import { describe, expect, it } from "vitest";

import {
  advanceWorker,
  applyShiftSignal,
  distance,
  rankWorkers,
  SpatialKpi,
  travelTimeMs,
  type WorkerSpatialState,
} from "./spatial";

const baseWorker = (overrides: Partial<WorkerSpatialState> = {}): WorkerSpatialState => ({
  id: "w1",
  position: { x: 0, y: 0 },
  target: null,
  speed: 1,
  mode: "idle",
  lastUpdateMs: 0,
  ...overrides,
});

describe("distance + travelTimeMs (VROL-163, VROL-166)", () => {
  it("Euclidean distance for axis + diagonal", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
  });

  it("travelTimeMs = distance / speed", () => {
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toBe(5);
  });

  it("travelTimeMs is Infinity for non-positive speed", () => {
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBe(Infinity);
    expect(travelTimeMs({ x: 0, y: 0 }, { x: 10, y: 0 }, -1)).toBe(Infinity);
  });
});

describe("advanceWorker — straight-line interpolation (VROL-166)", () => {
  it("no-op when target is null", () => {
    const w = baseWorker({ position: { x: 5, y: 5 } });
    const next = advanceWorker(w, 10, 10);
    expect(next.position).toEqual({ x: 5, y: 5 });
    expect(next.lastUpdateMs).toBe(10);
  });

  it("interpolates linearly along (position, target)", () => {
    const w = baseWorker({ target: { x: 10, y: 0 }, speed: 1, mode: "walking" });
    const next = advanceWorker(w, 4, 4);
    expect(next.position.x).toBeCloseTo(4);
    expect(next.target).toEqual({ x: 10, y: 0 });
  });

  it("clamps at target and flips walking → idle on arrival", () => {
    const w = baseWorker({ target: { x: 10, y: 0 }, speed: 1, mode: "walking" });
    const next = advanceWorker(w, 100, 100);
    expect(next.position).toEqual({ x: 10, y: 0 });
    expect(next.target).toBeNull();
    expect(next.mode).toBe("idle");
  });

  it("preserves non-walking mode on arrival (e.g. transition stays transition)", () => {
    const w = baseWorker({ target: { x: 10, y: 0 }, speed: 1, mode: "transition" });
    const next = advanceWorker(w, 100, 100);
    expect(next.position).toEqual({ x: 10, y: 0 });
    expect(next.mode).toBe("transition");
  });
});

describe("rankWorkers (VROL-170)", () => {
  it("ranks by travel time ascending", () => {
    const order = rankWorkers(
      [
        { id: "a", position: { x: 100, y: 0 }, speedMmPerMs: 1, mode: "idle" },
        { id: "b", position: { x: 10, y: 0 }, speedMmPerMs: 1, mode: "idle" },
        { id: "c", position: { x: 50, y: 0 }, speedMmPerMs: 1, mode: "idle" },
      ],
      { x: 0, y: 0 },
    );
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("ties broken by skill-match descending", () => {
    const order = rankWorkers(
      [
        { id: "low", position: { x: 10, y: 0 }, speedMmPerMs: 1, mode: "idle" },
        { id: "high", position: { x: 10, y: 0 }, speedMmPerMs: 1, mode: "idle" },
      ],
      { x: 0, y: 0 },
      { skillMatch: (id) => (id === "high" ? 5 : 1) },
    );
    expect(order).toEqual(["high", "low"]);
  });

  it("excludes off-shift + break by default", () => {
    const order = rankWorkers(
      [
        { id: "off", position: { x: 1, y: 0 }, speedMmPerMs: 1, mode: "off-shift" },
        { id: "brk", position: { x: 2, y: 0 }, speedMmPerMs: 1, mode: "break" },
        { id: "ok", position: { x: 100, y: 0 }, speedMmPerMs: 1, mode: "idle" },
      ],
      { x: 0, y: 0 },
    );
    expect(order).toEqual(["ok"]);
  });
});

describe("applyShiftSignal (VROL-178)", () => {
  it("start-shift → transition + targets the shift start", () => {
    const w = baseWorker({ mode: "off-shift" });
    const next = applyShiftSignal(w, { kind: "start-shift", shiftStartPos: { x: 1, y: 2 } }, 5);
    expect(next.target).toEqual({ x: 1, y: 2 });
    expect(next.mode).toBe("transition");
  });

  it("start-break with breakPos → moves toward it", () => {
    const w = baseWorker({ mode: "working" });
    const next = applyShiftSignal(w, { kind: "start-break", breakPos: { x: 9, y: 9 } }, 5);
    expect(next.target).toEqual({ x: 9, y: 9 });
    expect(next.mode).toBe("transition");
  });

  it("end-shift → no target, mode off-shift", () => {
    const next = applyShiftSignal(baseWorker(), { kind: "end-shift" }, 5);
    expect(next.target).toBeNull();
    expect(next.mode).toBe("off-shift");
  });
});

describe("SpatialKpi (VROL-182)", () => {
  it("accumulates walking distance + mode ms across two advance() calls", () => {
    const kpi = new SpatialKpi();
    const w0 = baseWorker({ position: { x: 0, y: 0 }, target: { x: 10, y: 0 }, mode: "walking" });
    const w1 = advanceWorker(w0, 5, 5);
    kpi.record(w0, w1);
    const w2 = advanceWorker(w1, 100, 105);
    kpi.record(w1, w2);
    const snap = kpi.snapshot();
    expect(snap.walkingMm.get("w1")).toBeCloseTo(10);
    const bucket = snap.modeMs.get("w1");
    expect(bucket?.get("walking")).toBe(105);
  });
});
