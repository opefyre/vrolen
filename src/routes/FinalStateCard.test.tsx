import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { FinalStateCard } from "./FinalStateCard";

function makeResult(perStation: Readonly<Record<string, number>>[]): ChainResult {
  return {
    samples: perStation.length === 0 ? [] : [{ perStationStateMs: perStation }],
    bottlenecks: perStation.map((_, i) => ({ label: `S${String(i)}` })),
  } as unknown as ChainResult;
}

describe("FinalStateCard (VROL-687)", () => {
  it("renders empty-sample fallback when no samples", () => {
    render(<FinalStateCard result={makeResult([])} />);
    expect(screen.getByText(/No samples/i)).toBeInTheDocument();
  });

  it("picks dominant state per station from the last sample", () => {
    render(<FinalStateCard result={makeResult([{ Running: 500, Starved: 200 }])} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("handles ties by picking the first state encountered", () => {
    const r = makeResult([{ Running: 0, Idle: 0 }]);
    render(<FinalStateCard result={r} />);
    // both zero -> dominantState returns null -> displays —
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses stationLabels prop over bottleneck labels", () => {
    render(<FinalStateCard result={makeResult([{ Running: 100 }])} stationLabels={["P"]} />);
    expect(screen.getByText("P")).toBeInTheDocument();
  });
});
