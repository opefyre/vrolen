import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

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
