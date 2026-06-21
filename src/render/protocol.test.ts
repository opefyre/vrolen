import { describe, expect, it } from "vitest";

import { isMainToWorker, type MainToWorker } from "./protocol";

describe("render protocol", () => {
  it("isMainToWorker accepts every kind in the union", () => {
    const cases: MainToWorker[] = [
      {
        kind: "init",
        canvas: {} as unknown as OffscreenCanvas,
        width: 100,
        height: 100,
        dpr: 1,
      },
      { kind: "resize", width: 200, height: 200, dpr: 2 },
      { kind: "scene", stations: [], edges: [] },
      { kind: "camera", x: 0, y: 0, zoom: 1 },
      { kind: "dispose" },
    ];
    for (const c of cases) {
      expect(isMainToWorker(c)).toBe(true);
    }
  });

  it("isMainToWorker rejects nonsense", () => {
    expect(isMainToWorker(null)).toBe(false);
    expect(isMainToWorker(undefined)).toBe(false);
    expect(isMainToWorker({})).toBe(false);
    expect(isMainToWorker({ kind: "unknown" })).toBe(false);
    expect(isMainToWorker("init")).toBe(false);
    expect(isMainToWorker(42)).toBe(false);
  });

  it("scene message preserves station + edge identity", () => {
    const stations = [
      {
        id: "s1",
        x: 0,
        y: 0,
        z: 0,
        label: "Filler",
        state: "running" as const,
        isBottleneck: false,
      },
    ];
    const edges = [{ id: "e1", sourceId: "s1", targetId: "s2", flowRate: 100 }];
    const msg: MainToWorker = { kind: "scene", stations, edges };
    expect(msg.kind).toBe("scene");
    if (msg.kind !== "scene") return;
    expect(msg.stations[0]?.id).toBe("s1");
    expect(msg.edges[0]?.flowRate).toBe(100);
  });
});
