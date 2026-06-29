import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { resultToCsv, sustainabilityTimeseriesToCsv } from "./result-to-csv";

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

  it("VROL-1019 — per-station section includes energy_j / water_l / co2e_g columns", () => {
    const r = {
      ...result,
      perStationEnergyJ: [123.45],
      perStationWaterL: [0.6789],
      perStationCO2eG: [4.5],
      totalEnergyJ: 123.45,
      totalWaterL: 0.6789,
      totalCO2eG: 4.5,
    } as unknown as ChainResult;
    const csv = resultToCsv(r);
    expect(csv).toMatch(/energy_j,water_l,co2e_g/);
    // Row contains the three sustainability values.
    expect(csv).toMatch(/123\.45/);
    expect(csv).toMatch(/0\.6789/);
  });
});

describe("sustainabilityTimeseriesToCsv (VROL-1019)", () => {
  it("emits header + one row per sample with cumulative line totals", () => {
    const r = {
      totalEnergyJ: 100,
      totalWaterL: 1,
      totalCO2eG: 50,
      samples: [
        {
          tMs: 1000,
          perStationEnergyJ: [10, 20],
          perStationWaterL: [0.1, 0.2],
          perStationCO2eG: [5, 10],
        },
        {
          tMs: 2000,
          perStationEnergyJ: [30, 40],
          perStationWaterL: [0.3, 0.4],
          perStationCO2eG: [15, 20],
        },
      ],
    } as unknown as ChainResult;
    const csv = sustainabilityTimeseriesToCsv(r);
    expect(csv).toMatch(/t_ms,energy_j,water_l,co2e_g/);
    expect(csv).toMatch(/1000,30\.00,0\.3000,15\.00/);
    expect(csv).toMatch(/2000,70\.00,0\.7000,35\.00/);
  });

  it("header-only when no sustainability inputs are present", () => {
    const r = {
      totalEnergyJ: 0,
      totalWaterL: 0,
      totalCO2eG: 0,
      samples: [],
    } as unknown as ChainResult;
    const csv = sustainabilityTimeseriesToCsv(r);
    expect(csv.split("\n").length).toBe(1);
  });
});

describe("sensitivityToCsv (VROL-1045)", () => {
  it("emits cycle + constraint sections", async () => {
    const { sensitivityToCsv } = await import("./result-to-csv");
    const summary = {
      baselinePerHour: 1000,
      rows: [
        {
          stationLabel: "Filler",
          lowPerHour: 900,
          highPerHour: 1100,
          swingPerHour: 200,
          swingPct: 20,
        },
      ],
      constraintRows: [
        {
          kind: "stationCapacity",
          label: "Mid capacity (1 ↔ 2)",
          lowPerHour: 950,
          highPerHour: 1900,
          swingPerHour: 950,
          swingPct: 95,
        },
        {
          kind: "bomQty",
          label: "Filler / glass: qtyPerCycle",
          lowPerHour: 980,
          highPerHour: 1020,
          swingPerHour: 40,
          swingPct: 4,
        },
      ],
    };
    const csv = sensitivityToCsv(summary);
    expect(csv).toMatch(/cycle dimension/);
    expect(csv).toMatch(/constraint dimensions/);
    expect(csv).toMatch(/Filler,1000\.00,900\.00,1100\.00,200\.00,20\.00/);
    expect(csv).toMatch(/stationCapacity,Mid capacity/);
    expect(csv).toMatch(/bomQty,Filler/);
  });
});
