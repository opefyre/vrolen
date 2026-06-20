import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { ComparisonTable, ResultPanel } from "./ResultPanel";

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
    perStationCapacity: [1, 1],
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
    // Rework tile in the bottom KPI row (lives on Overview).
    expect(screen.getByText(/^Rework$/i)).toBeInTheDocument();
    // Per-station completed lives on the Stations tab — switch + expand.
    fireEvent.click(screen.getByRole("tab", { name: /Stations/i }));
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

  it("renders the rework-over-time accordion when a station has rework + samples (VROL-641)", () => {
    render(
      <ResultPanel
        result={fakeResult({
          perStationReworked: [0, 7],
          lineReworkRate: 0.034,
          samples: [
            {
              tMs: 10_000,
              lineCompleted: 50,
              perStationCompleted: [60, 50],
              perEdgeBufferFill: [0],
              perStationStateMs: [],
              perStationRework: [0, 3],
            },
            {
              tMs: 60_000,
              lineCompleted: 100,
              perStationCompleted: [120, 100],
              perEdgeBufferFill: [0],
              perStationStateMs: [],
              perStationRework: [0, 7],
            },
          ],
        })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Rework-over-time lives on the Quality tab.
    fireEvent.click(screen.getByRole("tab", { name: /Quality/i }));
    expect(screen.getByRole("button", { name: /Rework over time/i })).toBeInTheDocument();
  });

  it("hides the rework-over-time accordion when no station has rework", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Quality/i }));
    expect(screen.queryByRole("button", { name: /Rework over time/i })).toBeNull();
  });

  it("ComparisonTable: KPI delta tiles always visible + scalar table behind accordion (VROL-653)", () => {
    const a = fakeResult({ completed: 80, throughputLambda: 80 / 60_000 });
    const b = fakeResult({ completed: 120, throughputLambda: 120 / 60_000 });
    render(
      <ComparisonTable
        aName="base"
        aResult={a}
        aStationLabels={["Filler", "Capper"]}
        bName="tuned"
        bResult={b}
        bStationLabels={["Filler", "Capper"]}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // KPI tiles visible: Completed (80 → 120, delta +40).
    expect(screen.getByText(/^Completed$/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 40/)).toBeInTheDocument();
    // Scalar table is collapsed by default — header visible, body rows not.
    expect(screen.getByRole("button", { name: /All scalar deltas/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Avg time-in-system \(ms\)$/)).toBeNull();
    // Expand → body appears.
    fireEvent.click(screen.getByRole("button", { name: /All scalar deltas/i }));
    expect(screen.getByText(/^Avg time-in-system \(ms\)$/)).toBeInTheDocument();
  });

  it("Per-station completed lives in Stations tab and is collapsed by default (VROL-636)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Stations tab holds the per-station completed accordion.
    fireEvent.click(screen.getByRole("tab", { name: /Stations/i }));
    expect(screen.getByRole("button", { name: /Per-station completed/i })).toBeInTheDocument();
    // States tab holds the per-station state breakdown accordion.
    fireEvent.click(screen.getByRole("tab", { name: /States/i }));
    expect(
      screen.getByRole("button", { name: /Per-station state breakdown/i }),
    ).toBeInTheDocument();
  });
});
