import { fireEvent, render, screen } from "@testing-library/react";
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
    // Rework tile in the bottom KPI row (always visible).
    expect(screen.getByText(/^Rework$/i)).toBeInTheDocument();
    // Per-station completed card is collapsed by default (VROL-636);
    // expand it to verify the annotation lives inside.
    fireEvent.click(screen.getByRole("button", { name: /Per-station completed/i }));
    expect(screen.getByText(/· 7 rework/)).toBeInTheDocument();
  });

  it("renders the auto-narrated insights banner above the KPI tiles (VROL-640)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    const banner = screen.getByLabelText("Run insights");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Capper is the bottleneck");
  });

  it("Per-station completed + state breakdown are collapsed by default (VROL-636)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Header buttons render even when collapsed; bodies should not.
    expect(screen.getByRole("button", { name: /Per-station completed/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Per-station state breakdown/i }),
    ).toBeInTheDocument();
    // Filler bar (rendered inside the per-station card body) is hidden.
    expect(screen.queryByText("Filler")).toBeNull();
  });
});
