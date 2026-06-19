import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TimeseriesSample } from "@/engine";

import { ReworkOverTimeChart } from "./ReworkOverTimeChart";

function sample(
  tMs: number,
  perStationCompleted: number[],
  perStationRework: number[],
): TimeseriesSample {
  return {
    tMs,
    lineCompleted: perStationCompleted[perStationCompleted.length - 1] ?? 0,
    perStationCompleted,
    perEdgeBufferFill: [],
    perStationStateMs: [],
    perStationRework,
  };
}

describe("ReworkOverTimeChart (VROL-641)", () => {
  it("renders an empty-state hint when fewer than 2 samples exist", () => {
    render(
      <ReworkOverTimeChart
        samples={[sample(1_000, [10, 5], [0, 0])]}
        stationLabels={["Filler", "Capper"]}
        horizonMs={10_000}
        warmupMs={0}
      />,
    );
    expect(screen.getByText(/Sample throughput over time/i)).toBeInTheDocument();
  });

  it("renders the no-rework hint when all stations have zero rework", () => {
    render(
      <ReworkOverTimeChart
        samples={[sample(1_000, [10, 5], [0, 0]), sample(2_000, [20, 10], [0, 0])]}
        stationLabels={["Filler", "Capper"]}
        horizonMs={2_000}
        warmupMs={0}
      />,
    );
    expect(screen.getByText(/No rework recorded/i)).toBeInTheDocument();
  });

  it("plots one line per station that has rework > 0 + legend chips", () => {
    const { container } = render(
      <ReworkOverTimeChart
        samples={[
          sample(1_000, [10, 5, 5], [0, 1, 0]),
          sample(2_000, [20, 10, 10], [0, 3, 2]),
          sample(3_000, [30, 15, 15], [0, 5, 4]),
        ]}
        stationLabels={["Filler", "Capper", "QC"]}
        horizonMs={3_000}
        warmupMs={0}
      />,
    );
    // Filler has zero rework — skipped. Capper + QC active → 2 line paths
    // in the SVG (in addition to gridlines which are <line> not <path>).
    const paths = container.querySelectorAll("svg path");
    expect(paths).toHaveLength(2);
    // Legend chips reflect ONLY active stations.
    expect(container.textContent).toContain("Capper");
    expect(container.textContent).toContain("QC");
    // Filler had zero rework so it shouldn't appear in the legend.
    expect(container.textContent).not.toContain("Filler");
  });

  it("Y axis scales to the largest cumulative rework across active stations", () => {
    const { container } = render(
      <ReworkOverTimeChart
        samples={[
          sample(1_000, [10, 5], [0, 2]),
          sample(2_000, [20, 10], [0, 7]),
          sample(3_000, [30, 15], [0, 15]),
        ]}
        stationLabels={["Filler", "Capper"]}
        horizonMs={3_000}
        warmupMs={0}
      />,
    );
    // Bottom-row right label is the peak count.
    expect(container.textContent).toContain("15");
    // The line path ends at y ≈ PAD_Y (top) because the last value equals peak.
    const path = container.querySelector("svg path");
    const d = path?.getAttribute("d") ?? "";
    const last = d.split(" ").slice(-2);
    expect(Number(last[1])).toBeCloseTo(4, 0);
  });

  it("emits cumulative rework lines that are monotone non-decreasing", () => {
    const { container } = render(
      <ReworkOverTimeChart
        samples={[
          sample(1_000, [10, 5], [0, 1]),
          sample(2_000, [20, 10], [0, 3]),
          sample(3_000, [30, 15], [0, 5]),
        ]}
        stationLabels={["Filler", "Capper"]}
        horizonMs={3_000}
        warmupMs={0}
      />,
    );
    const d = container.querySelector("svg path")?.getAttribute("d") ?? "";
    // Each successive y coordinate should be <= the previous (smaller Y = higher
    // value in SVG coordinates) since the values are monotone increasing.
    const coords = [...d.matchAll(/[ML]\s+([\d.]+)\s+([\d.]+)/g)].map((m) => Number(m[2]));
    for (let i = 1; i < coords.length; i++) {
      expect(coords[i]!).toBeLessThanOrEqual(coords[i - 1]!);
    }
  });
});
