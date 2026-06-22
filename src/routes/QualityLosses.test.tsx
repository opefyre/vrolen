import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { QualityLosses } from "./QualityLosses";

function makeResult(scrapped: number[], reworked: number[], completed?: number[]): ChainResult {
  return {
    perStationCompleted: completed ?? scrapped.map(() => 0),
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

  it("renders stacked good / rework / scrap segments sized by count (VROL-794)", () => {
    const { container } = render(
      <QualityLosses
        result={makeResult([10, 0], [10, 0], [80, 0])}
        stationLabels={["Filler", "Capper"]}
      />,
    );
    // Good 80, rework 10, scrap 10 → total 100 → 80%, 10%, 10%.
    const good = container.querySelector('[data-segment="good"]');
    const rework = container.querySelector('[data-segment="rework"]');
    const scrap = container.querySelector('[data-segment="scrap"]');
    expect(good).not.toBeNull();
    expect(rework).not.toBeNull();
    expect(scrap).not.toBeNull();
    expect((good as HTMLElement).style.width).toBe("80%");
    expect((rework as HTMLElement).style.width).toBe("10%");
    expect((scrap as HTMLElement).style.width).toBe("10%");
    // Tooltip exposes the exact counts + percentages.
    const bar = container.querySelector('[data-testid="quality-losses-bar-0"]');
    expect(bar?.getAttribute("title")).toContain("Good 80");
    expect(bar?.getAttribute("title")).toContain("Rework 10");
    expect(bar?.getAttribute("title")).toContain("Scrap 10");
  });
});
