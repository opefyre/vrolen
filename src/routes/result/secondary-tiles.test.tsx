import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { ResultSecondaryTiles } from "./secondary-tiles";

function makeResult(overrides: Partial<ChainResult>): ChainResult {
  return {
    theoreticalYield: 1,
    totalEnergyJ: 0,
    totalWaterL: 0,
    totalCO2eG: 0,
    ...overrides,
  } as unknown as ChainResult;
}

describe("ResultSecondaryTiles (VROL-1187)", () => {
  it("renders nothing when neither yield<1 nor any sustainability total is present", () => {
    const { container } = render(<ResultSecondaryTiles result={makeResult({})} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the disclosure open with theoretical yield when yield < 1", () => {
    render(<ResultSecondaryTiles result={makeResult({ theoreticalYield: 0.85 })} />);
    const details = screen.getByTestId("result-secondary-tiles");
    expect(details).toHaveAttribute("open");
    expect(screen.getByText(/Theoretical yield/i)).toBeInTheDocument();
    expect(screen.getByText("85.0%")).toBeInTheDocument();
  });

  it("renders energy / water / CO₂e tiles when sustainability totals are present", () => {
    render(
      <ResultSecondaryTiles
        result={makeResult({ totalEnergyJ: 7_200_000, totalWaterL: 4.5, totalCO2eG: 1500 })}
      />,
    );
    expect(screen.getByText(/Energy/i)).toBeInTheDocument();
    expect(screen.getByText(/Water/i)).toBeInTheDocument();
    expect(screen.getByText(/CO₂e/)).toBeInTheDocument();
    // 7_200_000 J = 2 kWh exactly
    expect(screen.getByText("2.0")).toBeInTheDocument();
    // CO2e g → kg
    expect(screen.getByText("1.5")).toBeInTheDocument();
  });

  it("hides theoretical yield tile when yield === 1 even if sustainability shown", () => {
    render(<ResultSecondaryTiles result={makeResult({ totalEnergyJ: 1_000_000 })} />);
    expect(screen.queryByText(/Theoretical yield/i)).toBeNull();
    expect(screen.getByText(/Energy/i)).toBeInTheDocument();
  });
});
