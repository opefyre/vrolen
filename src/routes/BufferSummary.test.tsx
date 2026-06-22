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

describe("BufferSummary (VROL-792) — source → target labels", () => {
  it("renders 'Material input → Filler' when chain meta is provided", () => {
    render(
      <BufferSummary
        result={makeResult(
          [1, 1],
          [
            [3, 1],
            [5, 2],
          ],
        )}
        stationLabels={["Material input", "Filler", "Capper"]}
        chainNodeIds={["src", "fill", "cap"]}
        edgeKeys={["src→fill", "fill→cap"]}
      />,
    );
    expect(screen.getByText("Material input → Filler")).toBeInTheDocument();
    expect(screen.getByText("Filler → Capper")).toBeInTheDocument();
  });

  it("falls back to linear i→i+1 mapping when edgeKeys are missing", () => {
    render(
      <BufferSummary
        result={makeResult(
          [1, 1],
          [
            [5, 1],
            [5, 1],
          ],
        )}
        stationLabels={["Material input", "Filler", "Capper"]}
      />,
    );
    expect(screen.getByText("Material input → Filler")).toBeInTheDocument();
  });

  it("falls back to 'edge N' when an edge key references unknown stations", () => {
    render(
      <BufferSummary
        result={makeResult([1], [[2], [4]])}
        stationLabels={["A", "B"]}
        chainNodeIds={["a", "b"]}
        edgeKeys={["ghost→a"]}
      />,
    );
    expect(screen.getByText("edge 0")).toBeInTheDocument();
  });
});

describe("BufferSummary sort logic (VROL-792)", () => {
  it("ranks the busiest edge first regardless of edge order", () => {
    const { container } = render(
      <BufferSummary
        result={makeResult(
          [1, 1, 1],
          [
            [2, 10, 5],
            [4, 12, 5],
          ],
        )}
        stationLabels={["A", "B", "C", "D"]}
        chainNodeIds={["a", "b", "c", "d"]}
        edgeKeys={["a→b", "b→c", "c→d"]}
      />,
    );
    const rows = container.querySelectorAll("li");
    // edge avgs: 3, 11, 5 → order should be edge1 (B→C), edge2 (C→D), edge0 (A→B).
    expect(rows[0]?.textContent).toContain("B → C");
    expect(rows[1]?.textContent).toContain("C → D");
    expect(rows[2]?.textContent).toContain("A → B");
  });

  it("renders the empty-state hint when there are no edges", () => {
    render(<BufferSummary result={makeResult([], [])} />);
    expect(screen.getByText(/No buffer samples/i)).toBeInTheDocument();
  });

  it("treats samples without buffer fills as missing data and still renders", () => {
    const result = {
      perEdgeFlowed: [1],
      samples: [{ perEdgeBufferFill: [] }, { perEdgeBufferFill: [7] }],
    } as unknown as ChainResult;
    const { container } = render(<BufferSummary result={result} />);
    // Only the second sample contributes; avg + peak both 7.
    expect(container.textContent).toContain("avg 7.0");
    expect(container.textContent).toContain("peak 7");
  });
});
