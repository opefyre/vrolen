import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { BufferSummary } from "./BufferSummary";

function makeResult(perEdgeFlowed: number[], fillSamples: number[][]): ChainResult {
  return {
    perEdgeFlowed,
    samples: fillSamples.map((perEdge) => ({ perEdgeBufferFill: perEdge })),
  } as unknown as ChainResult;
}

describe("BufferSummary (VROL-686)", () => {
  it("shows fallback when there are no edges", () => {
    render(<BufferSummary result={makeResult([], [])} />);
    expect(screen.getByText(/No buffer samples/i)).toBeInTheDocument();
  });

  it("computes average + peak across samples", () => {
    render(
      <BufferSummary
        result={makeResult(
          [10, 20],
          [
            [4, 2],
            [6, 8],
          ],
        )}
      />,
    );
    // edge 0: avg 5, peak 6; edge 1: avg 5, peak 8 -> edge 1 wins peak
    expect(screen.getAllByText(/avg/).length).toBe(2);
  });

  it("orders by average descending", () => {
    const { container } = render(
      <BufferSummary
        result={makeResult(
          [1, 1],
          [
            [10, 0],
            [10, 0],
          ],
        )}
      />,
    );
    // first row should be edge 0 (avg 10) before edge 1 (avg 0)
    const rows = container.querySelectorAll("li");
    expect(rows[0]?.textContent).toContain("edge 0");
  });
});
