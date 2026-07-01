import { describe, expect, it } from "vitest";

import type { ChainResult, TimeseriesSample } from "@/engine";

import { interpolateResultAt } from "./interpolate-result";

function stateMs(running: number, other = 0): Record<string, number> {
  return { Running: running, Idle: other };
}

function sample(
  tMs: number,
  lineCompleted: number,
  perStation: readonly { readonly running: number; readonly completed: number }[],
): TimeseriesSample {
  return {
    tMs,
    lineCompleted,
    perStationCompleted: perStation.map((s) => s.completed),
    perEdgeBufferFill: [],
    perStationStateMs: perStation.map((s) => stateMs(s.running)),
    perStationRework: perStation.map(() => 0),
    perStationTempScrap: perStation.map(() => 0),
    perStationToolBlockedMs: perStation.map(() => 0),
    perStationBomStarved: perStation.map(() => 0),
    perStationSkuRouted: perStation.map(() => 0),
    perStationEnergyJ: perStation.map(() => 0),
    perStationWaterL: perStation.map(() => 0),
    perStationCO2eG: perStation.map(() => 0),
  };
}

function makeResult(samples: readonly TimeseriesSample[]): ChainResult {
  return {
    samples,
    perStationRunningPct: samples[0]?.perStationCompleted.map(() => 0) ?? [],
    perStationLabels: samples[0]?.perStationCompleted.map((_, i) => `S${String(i)}`) ?? [],
    bottleneckStationIdx: 0,
    throughputLambda: 0,
    perStationCompleted: samples[0]?.perStationCompleted ?? [],
  } as unknown as ChainResult;
}

describe("interpolateResultAt (VROL-226)", () => {
  it("returns the input unchanged when there are fewer than 2 samples", () => {
    const result = makeResult([sample(0, 0, [{ running: 0, completed: 0 }])]);
    const out = interpolateResultAt(result, 5_000);
    expect(out).toBe(result);
  });

  it("interpolates lineCompleted linearly between samples", () => {
    const samples = [
      sample(0, 0, [{ running: 0, completed: 0 }]),
      sample(10_000, 100, [{ running: 10_000, completed: 100 }]),
    ];
    const result = makeResult(samples);
    const out = interpolateResultAt(result, 5_000);
    expect(out.samples[0]?.lineCompleted).toBe(50);
    expect(out.samples[0]?.perStationCompleted[0]).toBe(50);
    expect(out.perStationCompleted[0]).toBe(50);
  });

  it("rolling running-pct reflects the 5-second window ending at tMs", () => {
    // 10s of full running followed by 10s of no running. At tMs=15_000
    // the window (10_000, 15_000) is half full-running, half idle → 0.5.
    // Actually samples model *cumulative* Running ms, so at t=15 running-ms=10_000,
    // at t=10 running-ms=10_000, at t=20 running-ms=10_000 (station idled 10s..20s).
    // The window (10..15) → delta = 0 → pct = 0.
    const samples = [
      sample(0, 0, [{ running: 0, completed: 0 }]),
      sample(10_000, 100, [{ running: 10_000, completed: 100 }]),
      sample(20_000, 100, [{ running: 10_000, completed: 100 }]),
    ];
    const result = makeResult(samples);
    // At t=5000 the rolling window (0..5000) is fully within running,
    // → cumulative Running rose from 0 to 5000 → 5000/5000 = 1.0
    const early = interpolateResultAt(result, 5_000);
    expect(early.perStationRunningPct[0]).toBeCloseTo(1, 5);
    // At t=15000 running-ms didn't change in the window → pct = 0
    const late = interpolateResultAt(result, 15_000);
    expect(late.perStationRunningPct[0]).toBeCloseTo(0, 5);
  });

  it("picks bottleneck as the highest rolling running-pct", () => {
    const samples = [
      sample(0, 0, [
        { running: 0, completed: 0 },
        { running: 0, completed: 0 },
      ]),
      sample(10_000, 200, [
        { running: 3_000, completed: 50 },
        { running: 8_000, completed: 150 },
      ]),
    ];
    const result = makeResult(samples);
    const out = interpolateResultAt(result, 5_000);
    expect(out.bottleneckStationIdx).toBe(1);
  });

  it("clamps tMs before first sample to first-sample state", () => {
    const samples = [
      sample(1_000, 10, [{ running: 500, completed: 10 }]),
      sample(2_000, 20, [{ running: 1_000, completed: 20 }]),
    ];
    const result = makeResult(samples);
    const out = interpolateResultAt(result, 0);
    expect(out.samples[0]?.lineCompleted).toBe(10);
  });

  it("clamps tMs past last sample to last-sample state", () => {
    const samples = [
      sample(0, 0, [{ running: 0, completed: 0 }]),
      sample(1_000, 10, [{ running: 500, completed: 10 }]),
    ];
    const result = makeResult(samples);
    const out = interpolateResultAt(result, 10_000);
    expect(out.samples[0]?.lineCompleted).toBe(10);
  });

  it("computes throughputLambda from the 5s window's line-completed slope", () => {
    // 100 parts over 10s → 10 parts/sec → 0.01 parts/ms in the rolling
    // window at any interior time.
    const samples = [
      sample(0, 0, [{ running: 0, completed: 0 }]),
      sample(10_000, 100, [{ running: 10_000, completed: 100 }]),
    ];
    const result = makeResult(samples);
    const out = interpolateResultAt(result, 8_000);
    expect(out.throughputLambda).toBeCloseTo(0.01, 5);
  });
});
