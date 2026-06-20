import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { OeeBreakdown } from "./OeeBreakdown";

const mkOee = (oee: number) => ({
  availability: 0.9,
  performance: 0.9,
  quality: 0.9,
  oee,
  runTimeMs: 0,
  downTimeMs: 0,
  goodParts: 0,
  totalParts: 0,
  idealCycleTimeMs: 100,
});

function makeResult(oees: number[], labels?: string[]): ChainResult {
  return {
    perStationOee: oees.map(mkOee),
    perStationLabels: labels,
    bottlenecks: oees.map((_, i) => ({ label: `B${String(i)}` })),
  } as unknown as ChainResult;
}

describe("OeeBreakdown (VROL-675)", () => {
  it("renders nothing when perStationOee is empty", () => {
    const { container } = render(<OeeBreakdown result={makeResult([])} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses perStationLabels when present", () => {
    render(<OeeBreakdown result={makeResult([0.8], ["Press"])} />);
    expect(screen.getByText("Press")).toBeInTheDocument();
  });

  it("falls back to bottleneck label when perStationLabels missing", () => {
    render(<OeeBreakdown result={makeResult([0.8])} />);
    expect(screen.getByText("B0")).toBeInTheDocument();
  });

  it("renders OEE percentage", () => {
    render(<OeeBreakdown result={makeResult([0.42], ["X"])} />);
    expect(screen.getByText(/OEE 42%/)).toBeInTheDocument();
  });
});
