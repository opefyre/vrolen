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
      />,
    );
    expect(screen.queryByTestId("playback-hud-bottleneck-arrow")).toBeNull();
  });
});
