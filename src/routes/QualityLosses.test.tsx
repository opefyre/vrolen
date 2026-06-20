import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { QualityLosses } from "./QualityLosses";

function makeResult(scrapped: number[], reworked: number[]): ChainResult {
  return {
    perStationScrapped: scrapped,
    perStationReworked: reworked,
    bottlenecks: scrapped.map((_, i) => ({ label: `S${String(i)}` })),
  } as unknown as ChainResult;
}

describe("QualityLosses (VROL-723)", () => {
  it("renders nothing when totals are zero", () => {
    const { container } = render(<QualityLosses result={makeResult([0, 0], [0, 0])} />);
    expect(container.firstChild).toBeNull();
  });

  it("skips rows where station has no losses", () => {
    render(<QualityLosses result={makeResult([0, 5], [0, 2])} />);
    expect(screen.queryByText("S0")).toBeNull();
    expect(screen.getByText("S1")).toBeInTheDocument();
  });

  it("renders multiple stations when both have losses", () => {
    render(<QualityLosses result={makeResult([3, 4], [1, 2])} />);
    expect(screen.getByText("S0")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();
  });

  it("prefers stationLabels prop over bottleneck labels", () => {
    render(
      <QualityLosses result={makeResult([0, 1], [0, 0])} stationLabels={["First", "Second"]} />,
    );
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
