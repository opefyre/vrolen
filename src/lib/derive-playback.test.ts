import { describe, expect, it } from "vitest";

import type { ChainResult, TimeseriesSample } from "@/engine";

import { derivePlayback } from "./derive-playback";

const mkSample = (
  tMs: number,
  lineCompleted: number,
  perStationCompleted: number[],
  perEdgeBufferFill: number[],
  perStationStateMs: Record<string, number>[],
): TimeseriesSample => ({
  tMs,
  lineCompleted,
  perStationCompleted,
  perEdgeBufferFill,
  perStationStateMs,
  perStationRework: perStationCompleted.map(() => 0),
});

function mkResult(samples: TimeseriesSample[]): ChainResult {
  return {
    samples,
    completed: samples.at(-1)?.lineCompleted ?? 0,
    perStationCompleted: samples.at(-1)?.perStationCompleted ?? [],
  } as unknown as ChainResult;
}

describe("derivePlayback", () => {
  it("returns identity when no samples", () => {
    const r = derivePlayback(mkResult([]), 0);
    expect(r.perStationState).toEqual([]);
    expect(r.perEdgeFill).toEqual([]);
  });

  it("interpolates line completed between samples", () => {
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0 }]),
      mkSample(1000, 100, [100], [10], [{ Running: 1000 }]),
    ]);
    const mid = derivePlayback(result, 500);
    expect(mid.lineCompleted).toBeCloseTo(50);
    expect(mid.perEdgeFill[0]).toBeCloseTo(5);
  });

  it("picks dominant state from delta between surrounding samples", () => {
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0, Starved: 0 }]),
      mkSample(1000, 50, [50], [0], [{ Running: 500, Starved: 500 }]),
      mkSample(2000, 60, [60], [0], [{ Running: 600, Starved: 1400 }]),
    ]);
    const snap = derivePlayback(result, 1500);
    expect(snap.perStationState[0]).toBe("Starved");
  });

  it("clamps t below first sample to the first sample", () => {
    const result = mkResult([
      mkSample(100, 5, [5], [1], [{ Running: 50 }]),
      mkSample(200, 10, [10], [2], [{ Running: 100 }]),
    ]);
    const snap = derivePlayback(result, 50);
    expect(snap.tMs).toBe(100);
    expect(snap.lineCompleted).toBe(5);
  });

  it("clamps t above last sample to the last sample", () => {
    const result = mkResult([
      mkSample(100, 5, [5], [1], [{ Running: 50 }]),
      mkSample(200, 10, [10], [2], [{ Running: 100 }]),
    ]);
    const snap = derivePlayback(result, 9999);
    expect(snap.tMs).toBe(200);
    expect(snap.lineCompleted).toBe(10);
  });
});
