import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TimeseriesSample } from "@/engine";

import { OeeOverTimeChart } from "./OeeOverTimeChart";

function sample(
  tMs: number,
  perStationStateMs: Readonly<Record<string, number>>[],
): TimeseriesSample {
  return {
    tMs,
    lineCompleted: 0,
    perStationCompleted: [],
    perEdgeBufferFill: [],
    perStationStateMs,
  };
}

describe("OeeOverTimeChart (VROL-620)", () => {
  it("renders the empty-state hint when fewer than 2 samples", () => {
    render(
      <OeeOverTimeChart
        samples={[sample(0, [{ Running: 0 }])]}
        stationIdx={0}
        stationLabel="Capper"
        horizonMs={5_000}
        warmupMs={0}
      />,
    );
    expect(screen.getByText(/state-mix chart/i)).toBeInTheDocument();
  });

  it("emits one stacked path per state when N>=2 samples are given", () => {
    const samples = [
      sample(1_000, [{ Running: 800, Idle: 200 }]),
      sample(2_000, [{ Running: 1_700, Idle: 300 }]),
      sample(3_000, [{ Running: 2_400, Idle: 600 }]),
    ];
    const { container } = render(
      <OeeOverTimeChart
        samples={samples}
        stationIdx={0}
        stationLabel="Capper"
        horizonMs={5_000}
        warmupMs={0}
      />,
    );
    // Seven states in STATE_ORDER → seven paths, one per state.
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBe(7);
    // The bottleneck station label surfaces in the header.
    expect(screen.getByText(/Capper/)).toBeInTheDocument();
  });

  it("normalizes each interval so stacked fractions sum to 1.0 (visual sanity)", () => {
    // Two samples, one interval. Station spent 600ms Running + 400ms Idle of
    // a 1000ms tick. Stacked top of the highest path should reach the top of
    // the inner plot (y = PAD_Y = 4).
    const samples = [
      sample(0, [{ Running: 0, Idle: 0 }]),
      sample(1_000, [{ Running: 600, Idle: 400 }]),
    ];
    const { container } = render(
      <OeeOverTimeChart
        samples={samples}
        stationIdx={0}
        stationLabel="Capper"
        horizonMs={1_000}
        warmupMs={0}
      />,
    );
    // The "Down" path (last in STATE_ORDER) carries the highest cum top in
    // this layout: top-line should reach y=4 (the top padding) when stacks
    // sum to 1. We check the Down path's d for at least one "L … 4.00" point.
    const paths = container.querySelectorAll("svg path");
    let found = false;
    for (const p of Array.from(paths)) {
      const d = p.getAttribute("d") ?? "";
      if (/ 4\.00/.test(d)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
