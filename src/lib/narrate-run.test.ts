import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { narrateRun } from "./narrate-run";

function fakeResult(overrides: Partial<ChainResult> = {}): ChainResult {
  return {
    completed: 100,
    elapsedMs: 60_000,
    averageWipL: 5,
    throughputLambda: 100 / 60_000,
    avgTimeInSystemW: 500,
    perStationCompleted: [120, 100],
    perStationScrapped: [0, 0],
    perStationReworked: [0, 0],
    lineScrapRate: 0,
    lineReworkRate: 0,
    bottlenecks: [
      {
        stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
        label: "Capper",
        runningPct: 0.98,
        primaryReason: "running",
        primaryReasonPct: 0.98,
        breakdown: [
          { state: "Running", pct: 0.98 },
          { state: "Starved", pct: 0.02 },
        ],
      },
    ],
    perStationOee: [
      {
        availability: 1,
        performance: 0.5,
        quality: 1,
        oee: 0.5,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 120,
        totalParts: 120,
        idealCycleTimeMs: 100,
      },
      {
        availability: 1,
        performance: 0.98,
        quality: 1,
        oee: 0.98,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 100,
        totalParts: 100,
        idealCycleTimeMs: 200,
      },
    ],
    lineOee: 0.7,
    bottleneckStationIdx: 1,
    aggregateBufferWipL: 2,
    perEdgeFlowed: [120, 100],
    samples: [],
    ...overrides,
  };
}

describe("narrateRun (VROL-640)", () => {
  it("emits only the bottleneck sentence when rework/scrap below threshold + OEE mid-band", () => {
    const sentences = narrateRun(fakeResult());
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toBe("Capper is the bottleneck (running 98% of the time).");
  });

  it("emits the rework sentence when lineReworkRate is at or above 2%", () => {
    const sentences = narrateRun(
      fakeResult({
        lineReworkRate: 0.07,
        perStationReworked: [0, 7],
      }),
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("7%");
    expect(sentences[1]).toContain("reworked");
  });

  it("emits both rework and scrap sentences when both fire and skips the OEE-band line", () => {
    const sentences = narrateRun(
      fakeResult({
        lineReworkRate: 0.1,
        lineScrapRate: 0.05,
        perStationReworked: [0, 10],
        perStationScrapped: [0, 5],
      }),
    );
    expect(sentences).toHaveLength(3);
    expect(sentences[1]).toContain("reworked");
    expect(sentences[2]).toContain("scrapped");
    expect(sentences.some((s) => /OEE/i.test(s))).toBe(false);
  });

  it("falls back to a low-OEE band sentence when no rework or scrap fires", () => {
    const sentences = narrateRun(fakeResult({ lineOee: 0.25 }));
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("Low utilization");
    expect(sentences[1]).toContain("25%");
  });

  it("falls back to an excellent-OEE sentence when no rework or scrap fires", () => {
    const sentences = narrateRun(fakeResult({ lineOee: 0.9 }));
    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toContain("Excellent OEE");
  });

  it("uses starvation phrasing when the bottleneck's primary reason is starvation", () => {
    const sentences = narrateRun(
      fakeResult({
        bottlenecks: [
          {
            stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
            label: "Capper",
            runningPct: 0.4,
            primaryReason: "starvation",
            primaryReasonPct: 0.55,
            breakdown: [
              { state: "Starved", pct: 0.55 },
              { state: "Running", pct: 0.4 },
            ],
          },
        ],
      }),
    );
    expect(sentences[0]).toContain("starved 55%");
    expect(sentences[0]).toContain("upstream too slow");
  });

  it("returns an empty list when there are no bottleneck candidates", () => {
    const sentences = narrateRun(fakeResult({ bottlenecks: [] }));
    expect(sentences).toEqual([]);
  });
});
