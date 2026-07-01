import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { PlaybackHud } from "./PlaybackHud";

function makeResult(overrides: Partial<ChainResult>): ChainResult {
  return {
    throughputLambda: 0.001,
    lineOee: 0.75,
    lineAverageWipL: 4.2,
    ...overrides,
  } as unknown as ChainResult;
}

describe("PlaybackHud (VROL-232)", () => {
  it("renders throughput / OEE / WIP KPIs from the result", () => {
    render(
      <PlaybackHud
        result={makeResult({})}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.getByTestId("playback-hud")).toBeInTheDocument();
    expect(screen.getByText(/Throughput/i)).toBeInTheDocument();
    expect(screen.getByText(/OEE/i)).toBeInTheDocument();
    expect(screen.getByText(/WIP/i)).toBeInTheDocument();
    expect(screen.getByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("4.2")).toBeInTheDocument();
  });

  it("shows the sim clock when simTimeMs is provided", () => {
    render(
      <PlaybackHud
        result={null}
        simTimeMs={125_000}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.getByText(/Clock/i)).toBeInTheDocument();
    expect(screen.getByText("00:02:05")).toBeInTheDocument();
  });

  it("switches clock to Day format past 24h", () => {
    render(
      <PlaybackHud
        result={null}
        simTimeMs={90_061_000}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.getByText(/Day 2/i)).toBeInTheDocument();
  });

  it("hides clock when simTimeMs is not provided", () => {
    render(
      <PlaybackHud
        result={makeResult({})}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.queryByText(/Clock/i)).toBeNull();
  });

  it("draws the bottleneck callout arrow when a bottleneck is in-frame", () => {
    render(
      <PlaybackHud
        result={makeResult({})}
        bottleneckAt={{ x: 200, y: 150 }}
        bottleneckLabel="Capper"
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.getByTestId("playback-hud-bottleneck-arrow")).toBeInTheDocument();
    expect(screen.getByText(/Bottleneck: Capper/)).toBeInTheDocument();
  });

  it("hides the arrow when the bottleneck is off-screen", () => {
    render(
      <PlaybackHud
        result={makeResult({})}
        bottleneckAt={{ x: -50, y: 150 }}
        bottleneckLabel="Capper"
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.queryByTestId("playback-hud-bottleneck-arrow")).toBeNull();
  });

  // VROL-1214 — when a runResult is passed the HUD's primary throughput
  // number should match the run average (never the interpolated 0), and
  // the instantaneous 5s value should show as a secondary chip only when
  // it materially differs from the average.
  it("prefers run-average throughput and labels it Avg/h when runResult is provided", () => {
    render(
      <PlaybackHud
        // Simulate the case that triggered the audit finding: at the
        // current sim time the 5s-rolling instantaneous is 0 while the
        // completed run averaged 13.9k / h.
        result={makeResult({ throughputLambda: 0 })}
        runResult={makeResult({ throughputLambda: 13_876 / 3_600_000 })}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.getByText(/Avg \/ h/i)).toBeInTheDocument();
    // Primary number should be the run average (13.9k / h), NOT 0.0 / h.
    expect(screen.getByText(/13\.9k \/ h/)).toBeInTheDocument();
    // Secondary "inst" chip should carry the 0 rolling value so the
    // reader can still see both — never a naked 0 as the only signal.
    const inst = screen.getByTestId("playback-hud-inst-throughput");
    expect(inst).toHaveTextContent(/inst\s*0\.0\s*\/\s*h/);
  });

  it("hides the inst chip when instantaneous throughput matches run-average", () => {
    // Steady-state / warm run — no need for a second number.
    render(
      <PlaybackHud
        result={makeResult({ throughputLambda: 0.001 })}
        runResult={makeResult({ throughputLambda: 0.001 })}
        bottleneckAt={null}
        wrapperWidth={400}
        wrapperHeight={300}
        heatmapOn={false}
        onToggleHeatmap={() => undefined}
      />,
    );
    expect(screen.queryByTestId("playback-hud-inst-throughput")).toBeNull();
  });
});
