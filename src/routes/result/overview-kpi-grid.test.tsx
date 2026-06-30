import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { OverviewKpiGrid } from "./overview-kpi-grid";

const fmt = (n: number, digits = 1) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const renderTile = (label: string, value: string) => (
  <div key={label} data-testid={`tile-${label}`}>
    {label}: {value}
  </div>
);

function makeResult(overrides: Partial<ChainResult>): ChainResult {
  return {
    completed: 0,
    lineOee: 0,
    avgTimeInSystemW: 0,
    elapsedMs: 0,
    perStationMaintenanceMs: [],
    perStationOee: [],
    ...overrides,
  } as unknown as ChainResult;
}

describe("OverviewKpiGrid (VROL-1188)", () => {
  it("renders Completed / Line efficiency / Time-in-system tiles", () => {
    render(
      <OverviewKpiGrid
        result={makeResult({ completed: 1234, lineOee: 0.85, avgTimeInSystemW: 4500 })}
        tile={renderTile}
        fmt={fmt}
      />,
    );
    expect(screen.getByTestId("tile-Completed")).toHaveTextContent("Completed: 1,234");
    expect(screen.getByTestId("tile-Line efficiency")).toHaveTextContent("85.0%");
    expect(screen.getByTestId("tile-Time-in-system")).toHaveTextContent("4,500 ms");
  });

  it("hides the TEEP tile when no maintenance windows were configured", () => {
    render(
      <OverviewKpiGrid
        result={makeResult({ elapsedMs: 3_600_000, perStationMaintenanceMs: [0, 0] })}
        tile={renderTile}
        fmt={fmt}
      />,
    );
    expect(screen.queryByTestId("tile-TEEP")).toBeNull();
  });

  it("renders the TEEP tile when maintenance + elapsedMs are positive", () => {
    render(
      <OverviewKpiGrid
        result={makeResult({
          lineOee: 0.8,
          elapsedMs: 3_600_000,
          perStationMaintenanceMs: [600_000, 600_000],
          perStationOee: [{}, {}] as unknown as ChainResult["perStationOee"],
        })}
        tile={renderTile}
        fmt={fmt}
      />,
    );
    const teep = screen.getByTestId("tile-TEEP");
    // avgMaint=600000/2 wait — stationCount = 2, sum=1.2M / 2 = 600000.
    // loading = 1 - 600000/3600000 = 5/6. teep = 0.8 * 5/6 ≈ 0.6666 → 66.7%
    expect(teep).toHaveTextContent("66.7%");
  });

  it("sets the grid container test id", () => {
    render(<OverviewKpiGrid result={makeResult({})} tile={renderTile} fmt={fmt} />);
    expect(screen.getByTestId("result-overview-kpi-grid")).toBeInTheDocument();
  });
});
