import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThroughputChart } from "./ThroughputChart";

describe("ThroughputChart (VROL-613)", () => {
  it("renders empty-state copy when there's only one sample", () => {
    render(
      <ThroughputChart
        samples={[
          {
            tMs: 1000,
            lineCompleted: 0,
            perStationCompleted: [],
            perEdgeBufferFill: [],
            perStationStateMs: [],
          },
        ]}
        horizonMs={10_000}
        warmupMs={0}
      />,
    );
    expect(screen.getByText(/Sample throughput over time/i)).toBeInTheDocument();
  });

  it("emits an SVG path with one move + N-1 lineTos for N samples", () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      tMs: (i + 1) * 1000,
      lineCompleted: (i + 1) * 10,
      perStationCompleted: [(i + 1) * 10],
      perEdgeBufferFill: [] as number[],
      perStationStateMs: [] as Readonly<Record<string, number>>[],
    }));
    const { container } = render(
      <ThroughputChart samples={samples} horizonMs={10_000} warmupMs={0} />,
    );
    const paths = container.querySelectorAll("path");
    // Two paths: filled area + outline. Outline has the M+L sequence we check.
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const linePath = paths[1]?.getAttribute("d") ?? "";
    const moveCount = (linePath.match(/M /g) ?? []).length;
    const lineCount = (linePath.match(/L /g) ?? []).length;
    expect(moveCount).toBe(1);
    expect(lineCount).toBe(samples.length - 1);
  });

  it("scales the chart so the largest lineCompleted reaches the top of the inner plot", () => {
    const samples = [
      {
        tMs: 1000,
        lineCompleted: 5,
        perStationCompleted: [5],
        perEdgeBufferFill: [],
        perStationStateMs: [],
      },
      {
        tMs: 2000,
        lineCompleted: 20,
        perStationCompleted: [20],
        perEdgeBufferFill: [],
        perStationStateMs: [],
      },
      {
        tMs: 3000,
        lineCompleted: 40,
        perStationCompleted: [40],
        perEdgeBufferFill: [],
        perStationStateMs: [],
      },
    ];
    const { container } = render(
      <ThroughputChart samples={samples} horizonMs={3000} warmupMs={0} />,
    );
    const outline = container.querySelectorAll("path")[1]?.getAttribute("d") ?? "";
    // Last L command targets the peak — y should be at the top padding (4).
    const lastL = outline.split(" ").slice(-2);
    expect(Number(lastL[1])).toBeCloseTo(4, 0);
  });
});
