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

  // ────────────────────────────────────────────────────────────────────
  // VROL-905 — Widened snapshot (kpi + perStation + sampleIdxAtT).
  // ────────────────────────────────────────────────────────────────────
  it("VROL-905 — sampleIdxAtT points at the sample at or just below the playhead", () => {
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0 }]),
      mkSample(1000, 100, [100], [10], [{ Running: 1000 }]),
      mkSample(2000, 200, [200], [10], [{ Running: 2000 }]),
    ]);
    expect(derivePlayback(result, 500).sampleIdxAtT).toBe(0);
    expect(derivePlayback(result, 1000).sampleIdxAtT).toBe(1);
    expect(derivePlayback(result, 1500).sampleIdxAtT).toBe(1);
    expect(derivePlayback(result, 9999).sampleIdxAtT).toBe(2);
  });

  it("VROL-905 — kpi.completed equals lerped lineCompleted at the playhead", () => {
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0 }]),
      mkSample(1000, 100, [100], [10], [{ Running: 1000 }]),
    ]);
    const snap = derivePlayback(result, 500);
    expect(snap.kpi.completed).toBeCloseTo(snap.lineCompleted, 6);
    expect(snap.kpi.completed).toBeCloseTo(50, 6);
  });

  it("VROL-905 — kpi.throughputPerHr ≈ lineCompleted / hours at the playhead", () => {
    // 50 parts in 500 ms ⇒ 100 parts / sec ⇒ 360,000 / h.
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0 }]),
      mkSample(1000, 100, [100], [10], [{ Running: 1000 }]),
    ]);
    const snap = derivePlayback(result, 500);
    expect(snap.kpi.throughputPerHr).toBeCloseTo(360_000, 0);
  });

  it("VROL-905 — perStation[].stateMix sums to 1.0 across non-zero states", () => {
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0, Starved: 0 }]),
      mkSample(1000, 50, [50], [0], [{ Running: 700, Starved: 300 }]),
    ]);
    const snap = derivePlayback(result, 1000);
    const total = snap.perStation[0]?.stateMix.reduce((s, x) => s + x.pct, 0) ?? 0;
    expect(total).toBeCloseTo(1.0, 6);
    expect(snap.perStation[0]?.runningPct).toBeCloseTo(0.7, 6);
  });

  it("VROL-905 — bottleneckLabel picks the station with highest running %", () => {
    const result = mkResult([
      mkSample(
        0,
        0,
        [0, 0],
        [0],
        [
          { Running: 0, Starved: 0 },
          { Running: 0, Starved: 0 },
        ],
      ),
      mkSample(
        1000,
        50,
        [50, 50],
        [0],
        [
          { Running: 200, Starved: 800 },
          { Running: 900, Starved: 100 },
        ],
      ),
    ]);
    // Inject labels via result.perStationLabels (the field the kpi reads).
    const withLabels = { ...result, perStationLabels: ["Mixer", "Filler"] } as ChainResult;
    const snap = derivePlayback(withLabels, 1000);
    expect(snap.kpi.bottleneckLabel).toBe("Filler");
    expect(snap.kpi.bottleneckRunPct).toBeCloseTo(0.9, 6);
  });

  it("VROL-905 — playhead at horizon-end matches end-of-run aggregates", () => {
    // The invariant promised in the agent's research report: at t = horizon,
    // snapshot KPIs must agree with result.* so the user doesn't see a jump
    // when playback finishes.
    const result = mkResult([
      mkSample(0, 0, [0], [0], [{ Running: 0 }]),
      mkSample(1000, 200, [200], [0], [{ Running: 1000 }]),
    ]);
    const withTotals = {
      ...result,
      throughputLambda: 200 / 1000, // 0.2 parts/ms
      lineOee: 1.0,
      avgTimeInSystemW: 0,
    } as ChainResult;
    const snap = derivePlayback(withTotals, 1000);
    expect(snap.kpi.throughputPerHr).toBeCloseTo(0.2 * 3_600_000, 0);
    expect(snap.kpi.completed).toBeCloseTo(200, 6);
    expect(snap.kpi.lineEfficiencyPct).toBeCloseTo(1.0, 6);
  });
});
