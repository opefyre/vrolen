import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { ResultPanel } from "./ResultPanel";

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

describe("ResultPanel — rework KPI surface (VROL-628)", () => {
  it("hides the Rework tile when no station rerouted parts", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    expect(screen.queryByText(/^Rework$/i)).toBeNull();
  });

  it("renders the Rework tile + per-station annotation when reworked > 0", () => {
    render(
      <ResultPanel
        result={fakeResult({
          perStationReworked: [0, 7],
          lineReworkRate: 0.034,
        })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Rework tile in the bottom KPI row
    expect(screen.getByText(/^Rework$/i)).toBeInTheDocument();
    // Per-station completed card shows the · 7 rework annotation
    expect(screen.getByText(/· 7 rework/)).toBeInTheDocument();
  });
});
