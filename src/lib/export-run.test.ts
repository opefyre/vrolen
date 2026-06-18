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
    bottleneckStationIdx: 1,
    aggregateBufferWipL: 2,
    perEdgeFlowed: [120, 100],
    samples: [],
  };
}

function fakeSamples(): import("@/engine").TimeseriesSample[] {
  return [
    {
      tMs: 1_000,
      lineCompleted: 5,
      perStationCompleted: [10, 5],
      perEdgeBufferFill: [3, 0],
      perStationStateMs: [
        { Running: 800, Idle: 200 },
        { Running: 700, Starved: 300 },
      ],
    },
    {
      tMs: 2_000,
      lineCompleted: 12,
      perStationCompleted: [20, 12],
      perEdgeBufferFill: [4, 1],
      perStationStateMs: [
        { Running: 1_700, Idle: 300 },
        { Running: 1_500, Starved: 500 },
      ],
    },
  ];
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

  it("samples-mode emits header + one row per (sample, station) (VROL-623)", () => {
    const result: ChainResult = { ...fakeResult(), samples: fakeSamples() };
    const csv = chainResultToCsv(result, {
      stationLabels: ["Filler", "Capper"],
      mode: "samples",
    });
    const lines = csv.split("\n");
    // 1 header + 2 samples * 2 stations = 5 lines
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^tMs,station,completed,/);
    // First data row corresponds to the first sample's Filler station.
    expect(lines[1]).toMatch(/^1000,Filler,10,/);
    expect(lines[2]).toMatch(/^1000,Capper,5,/);
    expect(lines[3]).toMatch(/^2000,Filler,20,/);
    expect(lines[4]).toMatch(/^2000,Capper,12,/);
  });

  it("samples-mode header includes [state]Ms columns for every observed state (VROL-623)", () => {
    const result: ChainResult = { ...fakeResult(), samples: fakeSamples() };
    const csv = chainResultToCsv(result, {
      stationLabels: ["Filler", "Capper"],
      mode: "samples",
    });
    const header = csv.split("\n")[0] ?? "";
    // Across both stations, the observed states are Idle, Running, Starved.
    expect(header).toContain("IdleMs");
    expect(header).toContain("RunningMs");
    expect(header).toContain("StarvedMs");
    // Plus edge fill columns (2 edges in fakeSamples).
    expect(header).toContain("edge0Fill");
    expect(header).toContain("edge1Fill");
  });

  it("stations-mode output is unchanged byte-for-byte after VROL-623 (regression)", () => {
    const result = fakeResult();
    const before = [
      "label,completed,scrapped,runningPct,primaryReason,primaryReasonPct,oee,availability,performance,quality",
      "Filler,120,0,0.5,blocking,0.45,0.5,1,0.5,1",
      "Capper,100,0,0.98,running,0.98,0.98,1,0.98,1",
    ].join("\n");
    expect(chainResultToCsv(result, { stationLabels: ["Filler", "Capper"] })).toBe(before);
  });
});
