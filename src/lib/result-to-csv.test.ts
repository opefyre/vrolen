import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { resultToCsv } from "./result-to-csv";

const result = {
  completed: 100,
  throughputLambda: 0.001,
  averageWipL: 3,
  avgTimeInSystemW: 1000,
  lineOee: 0.5,
  perStationCompleted: [100],
  perStationScrapped: [2],
  perStationReworked: [3],
  perStationOee: [
    {
      availability: 0.9,
      performance: 0.95,
      quality: 0.98,
      oee: 0.84,
      runTimeMs: 0,
      downTimeMs: 0,
      goodParts: 100,
      totalParts: 100,
      idealCycleTimeMs: 500,
    },
  ],
  bottlenecks: [{ label: "Pack" }],
} as unknown as ChainResult;

describe("resultToCsv", () => {
  it("emits line section + per-station section", () => {
    const csv = resultToCsv(result);
    expect(csv).toMatch(/section,metric,value/);
    expect(csv).toMatch(/line,completed,100/);
    expect(csv).toMatch(/station_idx,label/);
    expect(csv).toMatch(/0,Pack,100,2,3/);
  });

  it("uses provided stationLabels when given", () => {
    const csv = resultToCsv(result, ["Press"]);
    expect(csv).toMatch(/0,Press/);
  });

  it("quotes labels with commas", () => {
    const csv = resultToCsv(result, ["Pack, ship"]);
    expect(csv).toMatch(/0,"Pack, ship"/);
  });
});
