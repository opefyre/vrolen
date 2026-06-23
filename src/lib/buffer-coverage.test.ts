import { describe, expect, it } from "vitest";

import { computeBufferCoverage } from "./buffer-coverage";
import { constant } from "@/engine/distribution";

describe("computeBufferCoverage (VROL-902)", () => {
  it("flags an edge as tightly coupled when buffer < bottleneck × MTTR", () => {
    // Throughput 10 parts/s = 0.01 parts/ms. MTTR mean 60s = 60_000 ms.
    // partsToAbsorbOneMTTR = 0.01 × 60_000 = 600. Buffer 5 ⇒ coverage 5/600 = 0.00833.
    const result = computeBufferCoverage({
      throughputLambda: 0.01,
      mttrDistribution: constant(60_000),
      edges: [{ edgeId: "e1", label: "Mixer → Filler", capacity: 5 }],
    });
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.tightlyCoupled).toBe(true);
    expect(c.coverageRatio).toBeCloseTo(5 / 600, 6);
    expect(c.partsToAbsorbOneMTTR).toBeCloseTo(600, 6);
    expect(c.recommendedCapacity).toBe(Math.ceil(600 * 1.5));
  });

  it("does not flag an edge when buffer comfortably covers MTTR", () => {
    // partsToAbsorbOneMTTR = 60, buffer 200 ⇒ coverage ≈ 3.33.
    const result = computeBufferCoverage({
      throughputLambda: 0.01,
      mttrDistribution: constant(6_000),
      edges: [{ edgeId: "e1", capacity: 200 }],
    });
    expect(result[0]?.tightlyCoupled).toBe(false);
    expect(result[0]?.coverageRatio).toBeGreaterThan(1.5);
  });

  it("returns empty when no MTTR distribution is configured (no breakdowns to absorb)", () => {
    const result = computeBufferCoverage({
      throughputLambda: 0.01,
      mttrDistribution: undefined,
      edges: [{ edgeId: "e1", capacity: 5 }],
    });
    expect(result).toEqual([]);
  });

  it("returns empty when throughput is zero (degenerate)", () => {
    const result = computeBufferCoverage({
      throughputLambda: 0,
      mttrDistribution: constant(60_000),
      edges: [{ edgeId: "e1", capacity: 5 }],
    });
    expect(result).toEqual([]);
  });

  it("preserves edge order and ids in the output", () => {
    const result = computeBufferCoverage({
      throughputLambda: 0.01,
      mttrDistribution: constant(60_000),
      edges: [
        { edgeId: "a", capacity: 100 },
        { edgeId: "b", capacity: 800 },
        { edgeId: "c", capacity: 600 },
      ],
    });
    expect(result.map((c) => c.edgeId)).toEqual(["a", "b", "c"]);
  });
});
