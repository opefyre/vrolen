import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";
import { constant } from "@/engine/distribution";

import { deriveRecommendations } from "./recommendations";

function makeResult(overrides: Partial<ChainResult>): ChainResult {
  const base: ChainResult = {
    completed: 100,
    throughputLambda: 0.001,
    averageWipL: 5,
    avgTimeInSystemW: 1000,
    lineOee: 0.7,
    elapsedMs: 60_000,
    bottlenecks: [
      {
        stationId: "s0" as never,
        label: "Pack",
        runningPct: 0.85,
        primaryReason: "running",
        primaryReasonPct: 0.85,
        breakdown: [],
      },
    ] as never,
    perStationOee: [
      {
        availability: 0.95,
        performance: 0.9,
        quality: 0.95,
        oee: 0.81,
        runTimeMs: 50_000,
        downTimeMs: 5_000,
        goodParts: 95,
        totalParts: 100,
        idealCycleTimeMs: 500,
      },
    ] as never,
    perStationScrapped: [2],
    perStationReworked: [3],
    perStationCompleted: [100],
    perStationLabels: ["Pack"],
    perStationBreakdowns: [0],
    samples: [],
    bottleneckStateSamples: [],
    perProductCompleted: undefined,
  } as unknown as ChainResult;
  return { ...base, ...overrides } as ChainResult;
}

describe("deriveRecommendations", () => {
  it("returns nothing surprising for a healthy line", () => {
    const recs = deriveRecommendations(makeResult({}));
    // Bottleneck recommendation always lands because the engine always picks one.
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]?.title).toMatch(/Speed up/);
  });

  it("flags high scrap rate", () => {
    const recs = deriveRecommendations(
      makeResult({ perStationScrapped: [25], completed: 75 } as Partial<ChainResult>),
    );
    expect(recs.some((r) => r.id === "cut-scrap")).toBe(true);
  });

  it("flags quality drag when a station has low quality", () => {
    const recs = deriveRecommendations(
      makeResult({
        perStationOee: [
          {
            availability: 0.95,
            performance: 0.9,
            quality: 0.7,
            oee: 0.6,
            runTimeMs: 50_000,
            downTimeMs: 5_000,
            goodParts: 70,
            totalParts: 100,
            idealCycleTimeMs: 500,
          },
        ] as never,
      }),
    );
    expect(recs.some((r) => r.id === "quality-drag")).toBe(true);
  });

  it("VROL-902 — flags a tightly-coupled buffer when MTTR is configured", () => {
    const recs = deriveRecommendations(makeResult({}), {
      mttrDistribution: constant(60_000),
      bufferEdges: [{ edgeId: "e1", label: "A → B", capacity: 5 }],
    });
    const tight = recs.find((r) => r.id === "tightly-coupled");
    expect(tight).toBeDefined();
    expect(tight?.title).toContain("A → B");
  });

  it("VROL-902 — silent for healthy lines with no MTTR configured", () => {
    const recs = deriveRecommendations(makeResult({}), {
      bufferEdges: [{ edgeId: "e1", capacity: 5 }],
    });
    expect(recs.some((r) => r.id === "tightly-coupled")).toBe(false);
  });

  it("VROL-903 — recommends throttling a non-bottleneck station at >95% nominal with breakdowns", () => {
    const recs = deriveRecommendations(
      makeResult({
        bottlenecks: [
          {
            stationId: "s0" as never,
            label: "Pack",
            runningPct: 0.95,
            primaryReason: "running",
            primaryReasonPct: 0.95,
            breakdown: [],
            bindingScore: 0.95,
            nominalSpeedRatio: 1,
          },
          {
            stationId: "s1" as never,
            label: "Filler",
            runningPct: 0.9,
            primaryReason: "running",
            primaryReasonPct: 0.9,
            breakdown: [],
            bindingScore: 0.9,
            nominalSpeedRatio: 0.98,
          },
        ] as never,
        perStationLabels: ["Pack", "Filler"],
        perStationBreakdowns: [0, 3],
        perStationOee: [
          {
            availability: 0.95,
            performance: 1,
            quality: 1,
            oee: 0.95,
            runTimeMs: 50_000,
            downTimeMs: 0,
            goodParts: 100,
            totalParts: 100,
            idealCycleTimeMs: 500,
            nominalSpeedRatio: 1,
          },
          {
            availability: 0.95,
            performance: 0.95,
            quality: 1,
            oee: 0.9,
            runTimeMs: 50_000,
            downTimeMs: 1000,
            goodParts: 100,
            totalParts: 100,
            idealCycleTimeMs: 500,
            nominalSpeedRatio: 0.98,
          },
        ] as never,
      }),
    );
    expect(recs.some((r) => r.id === "sweet-spot-Filler")).toBe(true);
  });

  it("VROL-903 — silent for the bottleneck itself even when at-nominal", () => {
    const recs = deriveRecommendations(
      makeResult({
        bottlenecks: [
          {
            stationId: "s0" as never,
            label: "Pack",
            runningPct: 0.99,
            primaryReason: "running",
            primaryReasonPct: 0.99,
            breakdown: [],
            bindingScore: 0.99,
            nominalSpeedRatio: 1,
          },
        ] as never,
      }),
    );
    expect(recs.some((r) => r.id?.startsWith("sweet-spot-"))).toBe(false);
  });

  it("caps at 4 cards", () => {
    const recs = deriveRecommendations(
      makeResult({
        perStationScrapped: [50],
        completed: 50,
        perStationOee: [
          {
            availability: 0.4,
            performance: 0.6,
            quality: 0.5,
            oee: 0.12,
            runTimeMs: 50_000,
            downTimeMs: 50_000,
            goodParts: 50,
            totalParts: 100,
            idealCycleTimeMs: 500,
          },
        ] as never,
      }),
    );
    expect(recs.length).toBeLessThanOrEqual(4);
  });
});
