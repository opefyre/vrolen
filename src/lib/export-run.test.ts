import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { chainResultToCsv, chainResultToJsonString, suggestedFilenameStem } from "./export-run";

function fakeResult(): ChainResult {
  return {
    completed: 100,
    elapsedMs: 60_000,
    averageWipL: 5,
    throughputLambda: 100 / 60_000,
    avgTimeInSystemW: 500,
    perStationCompleted: [120, 100],
    perStationScrapped: [0, 0],
    lineScrapRate: 0,
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
      {
        stationId: "s0" as unknown as ChainResult["bottlenecks"][number]["stationId"],
        label: "Filler",
        runningPct: 0.5,
        primaryReason: "blocking",
        primaryReasonPct: 0.45,
        breakdown: [],
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
    aggregateBufferWipL: 2,
    perEdgeFlowed: [120, 100],
  };
}

describe("export-run", () => {
  it("chainResultToJsonString round-trips via JSON.parse", () => {
    const result = fakeResult();
    const json = chainResultToJsonString(result);
    const parsed = JSON.parse(json) as ChainResult;
    expect(parsed.completed).toBe(100);
    expect(parsed.perStationCompleted).toEqual([120, 100]);
  });

  it("chainResultToJsonString turns Maps into plain objects", () => {
    const result = {
      ...fakeResult(),
      perProductCompleted: new Map<string, number>([
        ["A", 60],
        ["B", 40],
      ]),
    };
    const json = chainResultToJsonString(result as ChainResult);
    expect(json).toContain('"A": 60');
    expect(json).toContain('"B": 40');
    expect(json).not.toContain("Map(");
  });

  it("chainResultToCsv produces a header + one row per station", () => {
    const result = fakeResult();
    const csv = chainResultToCsv(result, { stationLabels: ["Filler", "Capper"] });
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("label,completed,scrapped");
    expect(lines[1]).toMatch(/^Filler,/);
    expect(lines[2]).toMatch(/^Capper,/);
    // Capper OEE = 0.98 should appear
    expect(lines[2]).toContain("0.98");
  });

  it("chainResultToCsv quotes labels that contain commas / quotes", () => {
    const base = fakeResult();
    const bnRest = base.bottlenecks.slice(1);
    const result: ChainResult = {
      ...base,
      bottlenecks: [{ ...base.bottlenecks[0]!, label: "Capper, v2" }, ...bnRest],
    };
    const csv = chainResultToCsv(result, { stationLabels: ["Filler", "Capper, v2"] });
    expect(csv).toContain('"Capper, v2"');
  });

  it("suggestedFilenameStem slugifies + appends a timestamp", () => {
    const stem = suggestedFilenameStem("Diamond Demo");
    expect(stem).toMatch(/^diamond-demo-/);
  });

  it("suggestedFilenameStem falls back to vrolen-run for empty label", () => {
    expect(suggestedFilenameStem(undefined)).toMatch(/^vrolen-run-/);
  });
});
