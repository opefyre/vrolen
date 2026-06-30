/**
 * VROL-1062 — classifyTornadoRow now reads the swingStats CI when
 * present. Confirm: with stats, significance gates "noise"; without
 * stats (K=1), the existing swing-vs-floor heuristic still applies.
 */
import { describe, expect, it } from "vitest";

import type { SensitivityRow } from "./sensitivity-sweep";
import { classifyTornadoRow } from "./tornado-classify";

function row(over: Partial<SensitivityRow> = {}): SensitivityRow {
  return {
    stationLabel: "Mid",
    stationIdx: 1,
    baselinePerHour: 10_000,
    lowPerHour: 11_000,
    highPerHour: 9_000,
    swingPerHour: 2_000,
    swingPct: 20,
    swingStats: { mean: -2_000, stddev: 0, halfWidth95: 0, low95: -2_000, high95: -2_000 },
    isSignificant: true,
    ...over,
  };
}

describe("classifyTornadoRow (VROL-1062 CI gate)", () => {
  it("K=1 (no CI): falls back to swing-vs-floor heuristic — large swing is positive/negative", () => {
    const r = row({
      swingStats: { mean: -2_000, stddev: 0, halfWidth95: 0, low95: -2_000, high95: -2_000 },
    });
    expect(classifyTornadoRow(r, 2_000)).toBe("positive");
  });

  it("K=1: tiny absolute swing → noise", () => {
    const r = row({
      lowPerHour: 10_001,
      highPerHour: 10_000.5,
      swingPerHour: 0.5,
      swingPct: 0.005,
      swingStats: { mean: -0.5, stddev: 0, halfWidth95: 0, low95: -0.5, high95: -0.5 },
    });
    expect(classifyTornadoRow(r, 10_000)).toBe("noise");
  });

  it("K>=2 with CI excluding zero → keeps the directional tone", () => {
    // CI [-2200, -1800] — entirely negative → significant.
    const r = row({
      swingStats: { mean: -2_000, stddev: 100, halfWidth95: 200, low95: -2_200, high95: -1_800 },
      isSignificant: true,
    });
    expect(classifyTornadoRow(r, 2_000)).toBe("positive");
  });

  it("K>=2 with CI crossing zero → noise even if abs(mean) is large", () => {
    // CI [-2500, +500] — crosses zero → swing isn't statistically
    // distinguishable from no effect. Even though |mean| = 1000 is
    // big, the noise gate fires.
    const r = row({
      lowPerHour: 10_000,
      highPerHour: 9_000,
      swingPerHour: 1_000,
      swingPct: 10,
      swingStats: { mean: -1_000, stddev: 750, halfWidth95: 1_500, low95: -2_500, high95: 500 },
      isSignificant: false,
    });
    expect(classifyTornadoRow(r, 2_000)).toBe("noise");
  });

  it("K>=2 CI-significant beats the K=1 floor heuristic — even a small swing stays directional", () => {
    // CI [10, 20] — entirely positive, half-width 5. Tiny swing
    // (15/h) that would be K=1 noise (below 1 % of max = 20) is
    // significant under CI, so kept as a directional row.
    const r = row({
      lowPerHour: 10_015,
      highPerHour: 10_000,
      swingPerHour: 15,
      swingPct: 0.15,
      swingStats: { mean: -15, stddev: 2.55, halfWidth95: 5, low95: -20, high95: -10 },
      isSignificant: true,
    });
    expect(classifyTornadoRow(r, 2_000)).toBe("positive");
  });
});
