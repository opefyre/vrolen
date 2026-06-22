import { describe, expect, it } from "vitest";

import type { TimeseriesSample } from "@/engine";

import { computeInstantaneousRate } from "./throughput-rate";

const mk = (tMs: number, lineCompleted: number): TimeseriesSample => ({
  tMs,
  lineCompleted,
  perStationCompleted: [lineCompleted],
  perEdgeBufferFill: [],
  perStationStateMs: [],
  perStationRework: [],
});

describe("computeInstantaneousRate (VROL-845)", () => {
  it("returns [] for empty samples", () => {
    expect(computeInstantaneousRate([], 5_000, 0)).toEqual([]);
  });

  it("returns [] when fewer than 2 post-warmup samples", () => {
    expect(computeInstantaneousRate([mk(1_000, 0)], 5_000, 0)).toEqual([]);
    // Both samples fall inside the warmup band, so nothing usable.
    expect(computeInstantaneousRate([mk(1_000, 0), mk(2_000, 5)], 5_000, 5_000)).toEqual([]);
  });

  it("produces a stable rate for constant-rate samples", () => {
    // 10 parts every second -> 36 000 parts/hour.
    const samples = Array.from({ length: 10 }, (_, i) => mk((i + 1) * 1_000, (i + 1) * 10));
    const out = computeInstantaneousRate(samples, 5_000, 0);
    expect(out.length).toBe(samples.length - 1);
    for (const p of out) {
      expect(p.ratePerHour).toBeCloseTo(36_000, 5);
    }
  });

  it("dips during a maintenance window in the middle", () => {
    // 0..4s: 10 parts/s. 4..9s: flatlined (maintenance). 9..13s: 10 parts/s again.
    const samples: TimeseriesSample[] = [];
    for (let t = 1_000; t <= 4_000; t += 1_000) samples.push(mk(t, t / 100));
    // 5..9s flatlined at 40.
    for (let t = 5_000; t <= 9_000; t += 1_000) samples.push(mk(t, 40));
    // Resume from 10s onwards, +10/s.
    for (let t = 10_000; t <= 13_000; t += 1_000)
      samples.push(mk(t, 40 + ((t - 9_000) / 1_000) * 10));

    const out = computeInstantaneousRate(samples, 5_000, 0);
    // Find the rate at the flatlined sample t=9000 — the 5s lookback window
    // (4000..9000) is entirely inside the maintenance flatline, so the rate
    // must be exactly 0.
    const flat = out.find((p) => p.tMs === 9_000);
    expect(flat).toBeDefined();
    expect(flat?.ratePerHour).toBe(0);
    // And the rates at the steady regions should be ~36 000 parts/hour.
    const early = out.find((p) => p.tMs === 4_000);
    expect(early?.ratePerHour).toBeCloseTo(36_000, 5);
    const late = out.find((p) => p.tMs === 13_000);
    // t=13000 lookback to t=8000 (window=5s) — 8000 is flatline at 40,
    // 13000 is at 80, so 40 parts over 5s = 28_800 parts/hour.
    expect(late?.ratePerHour).toBeCloseTo(28_800, 5);
  });

  it("excludes samples before warmupMs entirely", () => {
    // 5 samples in warmup (tMs < 2_000), 5 after. No rate point should have tMs < 2_000.
    const samples = Array.from({ length: 10 }, (_, i) => mk((i + 1) * 500, (i + 1) * 5));
    const warmupMs = 2_000;
    const out = computeInstantaneousRate(samples, 1_000, warmupMs);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.tMs).toBeGreaterThanOrEqual(warmupMs);
    }
  });
});
