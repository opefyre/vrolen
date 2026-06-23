import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StationDrilldown } from "./station-drilldown";
import type { ChainResult } from "@/engine/chain-harness";

afterEach(() => {
  cleanup();
});

// Minimal ChainResult fixture: only the fields StationDrilldown actually reads.
// Cast through `unknown` since the engine result has dozens of fields we don't
// need to mock just to exercise the per-station view.
function makeResult(): ChainResult {
  return {
    perStationOee: [
      {
        availability: 0.95,
        performance: 0.5,
        quality: 1.0,
        oee: 0.475,
        runTimeMs: 1000,
        downTimeMs: 50,
        goodParts: 100,
        totalParts: 100,
        idealCycleTimeMs: 100,
      },
    ],
    perStationRunningPct: [0.5],
    perStationCompleted: [100],
    perStationScrapped: [0],
    perStationReworked: [0],
    bottlenecks: [
      {
        stationId: "node-1",
        label: "Filler",
        runningPct: 0.5,
        primaryReason: "starvation",
        primaryReasonPct: 0.5,
        breakdown: [
          { state: "Starved", pct: 0.5 },
          { state: "Running", pct: 0.5 },
        ],
      },
    ],
  } as unknown as ChainResult;
}

describe("StationDrilldown (VROL-894)", () => {
  it("renders headline util + OEE numbers when open with valid result data", () => {
    render(
      <StationDrilldown
        open
        onOpenChange={() => {}}
        nodeId="node-1"
        nodeLabel="Filler"
        nodeTypeLabel="machine"
        result={makeResult()}
        chainNodeIds={["node-1"]}
        edges={[]}
      />,
    );
    expect(screen.getByText("Filler")).toBeTruthy();
    // Util is 0.5 → 50%; OEE is 0.475 → 48%.
    const monoNumbers = screen.getAllByText(/^\d+%$/);
    const txt = monoNumbers.map((el) => el.textContent).join("|");
    expect(txt).toContain("50%");
    expect(txt).toContain("48%");
  });

  it("calls onOpenChange(false) when the close affordance fires", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <StationDrilldown
        open
        onOpenChange={onOpenChange}
        nodeId="node-1"
        nodeLabel="Filler"
        nodeTypeLabel="machine"
        result={makeResult()}
        chainNodeIds={["node-1"]}
        edges={[]}
      />,
    );
    await user.click(screen.getByLabelText("Close station report"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("surfaces a state-specific recommendation derived from the dominant state", () => {
    render(
      <StationDrilldown
        open
        onOpenChange={() => {}}
        nodeId="node-1"
        nodeLabel="Filler"
        nodeTypeLabel="machine"
        result={makeResult()}
        chainNodeIds={["node-1"]}
        edges={[]}
      />,
    );
    // Dominant is a tie between Starved + Running at 50% each — the reducer
    // keeps the FIRST entry in the breakdown array when ties occur, so the
    // recommendation should mention starvation.
    const reco = screen.getByText(/upstream can't keep this station fed/i);
    expect(reco).toBeTruthy();
  });

  it("falls back to a friendly empty state when result is null", () => {
    render(
      <StationDrilldown
        open
        onOpenChange={() => {}}
        nodeId="node-1"
        nodeLabel="Filler"
        nodeTypeLabel="machine"
        result={null}
        chainNodeIds={null}
        edges={[]}
      />,
    );
    expect(screen.getByText(/No run results for this station yet/i)).toBeTruthy();
  });
});
