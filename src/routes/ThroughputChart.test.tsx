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

  it("renders a secondary series + legend when secondarySamples is provided (VROL-624)", () => {
    const mk = (n: number, m: number) => ({
      tMs: n,
      lineCompleted: m,
      perStationCompleted: [m],
      perEdgeBufferFill: [] as number[],
      perStationStateMs: [] as Readonly<Record<string, number>>[],
    });
    const a = [mk(1_000, 5), mk(2_000, 15), mk(3_000, 35)];
    const b = [mk(1_000, 7), mk(2_000, 18), mk(3_000, 28)];
    const { container } = render(
      <ThroughputChart
        samples={a}
        secondarySamples={b}
        primaryLabel="A · base"
        secondaryLabel="B · with-extra-worker"
        horizonMs={3_000}
        warmupMs={0}
      />,
    );
    // Two line paths (area + primary line + secondary line + gridlines).
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThanOrEqual(3);
    // Legend chips reflect the labels passed in.
    expect(container.textContent).toContain("A · base");
    expect(container.textContent).toContain("B · with-extra-worker");
    // Y scale uses max of BOTH series — peak of A is 35, peak of B is 28.
    // Maximum lineCompleted reaches the top of inner plot (y≈4).
    const linePath = paths[1]?.getAttribute("d") ?? "";
    expect(linePath).toMatch(/[ML] [\d.]+ 4(?!\d)/);
  });

  it("degrades to single-series when no secondary samples are passed (VROL-624)", () => {
    const mk = (n: number, m: number) => ({
      tMs: n,
      lineCompleted: m,
      perStationCompleted: [m],
      perEdgeBufferFill: [] as number[],
      perStationStateMs: [] as Readonly<Record<string, number>>[],
    });
    const { container } = render(
      <ThroughputChart samples={[mk(1_000, 5), mk(2_000, 10)]} horizonMs={2_000} warmupMs={0} />,
    );
    // No legend row when there's no second series.
    expect(container.textContent).not.toContain("A · ");
    expect(container.textContent).not.toContain("B · ");
  });

  it("renders axis tick lines + bottom-row labels (VROL-622)", () => {
    const samples = [
      {
        tMs: 1_000,
        lineCompleted: 10,
        perStationCompleted: [10],
        perEdgeBufferFill: [],
        perStationStateMs: [],
      },
      {
        tMs: 2_000,
        lineCompleted: 20,
        perStationCompleted: [20],
        perEdgeBufferFill: [],
        perStationStateMs: [],
      },
    ];
    const { container } = render(
      <ThroughputChart samples={samples} horizonMs={2_000} warmupMs={0} />,
    );
    // Three Y-axis lines + three X-axis lines + area + outline + hover bits hidden.
    const lines = container.querySelectorAll("svg line");
    expect(lines.length).toBeGreaterThanOrEqual(6);
    // The mid-time tick label "1.0s" lands in the bottom row.
    expect(container.textContent).toMatch(/1\.0s/);
    // Max-Y label on the right of the second row shows the peak count.
    expect(container.textContent).toContain("20");
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
