import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { SingleStationSixLoss } from "./single-station-six-loss";

function makeResult(opts: {
  readonly states: Readonly<Record<string, number>>[];
  readonly oees: {
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    runTimeMs: number;
  }[];
  readonly scrap?: number[];
  readonly labels?: string[];
}): ChainResult {
  return {
    samples: [{ perStationStateMs: opts.states }],
    perStationOee: opts.oees,
    perStationLabels: opts.labels ?? opts.states.map((_, i) => `S${String(i)}`),
    perStationScrapped: opts.scrap ?? opts.states.map(() => 0),
    perStationCompleted: opts.states.map(() => 1),
    perStationReworked: opts.states.map(() => 0),
    perStationTempScrap: opts.states.map(() => 0),
    perStationToolBlockedMs: opts.states.map(() => 0),
    perStationRunningPct: opts.states.map(() => 0),
    bottlenecks: opts.states.map((_, i) => ({ label: `B${String(i)}`, runningPct: 0 })),
  } as unknown as ChainResult;
}

describe("SingleStationSixLoss (VROL-973)", () => {
  it("renders nothing when the station has zero total loss", () => {
    const result = makeResult({
      states: [{ Running: 60_000 }],
      oees: [{ availability: 1, performance: 1, quality: 1, oee: 1, runTimeMs: 60_000 }],
    });
    const { container } = render(<SingleStationSixLoss result={result} stationIdx={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the breakdown when the station has Down + Setup time", () => {
    const result = makeResult({
      states: [{ Running: 50_000, Down: 5_000, Setup: 2_000 }],
      oees: [{ availability: 0.88, performance: 1, quality: 1, oee: 0.88, runTimeMs: 50_000 }],
    });
    render(<SingleStationSixLoss result={result} stationIdx={0} />);
    expect(screen.getByTestId("single-station-six-loss")).toBeInTheDocument();
    expect(screen.getByText(/Breakdown/)).toBeInTheDocument();
    expect(screen.getByText(/Setup/)).toBeInTheDocument();
    expect(screen.queryByText(/Minor stop/)).toBeNull();
  });

  it("returns null when stationIdx is out of bounds", () => {
    const result = makeResult({
      states: [{ Down: 1000 }],
      oees: [{ availability: 0, performance: 1, quality: 1, oee: 0, runTimeMs: 0 }],
    });
    const { container } = render(<SingleStationSixLoss result={result} stationIdx={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it("includes speed-loss segment when performance < 1", () => {
    const result = makeResult({
      states: [{ Running: 60_000 }],
      oees: [{ availability: 1, performance: 0.7, quality: 1, oee: 0.7, runTimeMs: 60_000 }],
    });
    render(<SingleStationSixLoss result={result} stationIdx={0} />);
    expect(screen.getByText(/Speed loss/)).toBeInTheDocument();
  });
});
