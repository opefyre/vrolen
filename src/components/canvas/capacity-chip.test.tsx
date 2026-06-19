import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapacityChip } from "./capacity-chip";

describe("CapacityChip (VROL-650)", () => {
  it("renders the ×N label for the given capacity", () => {
    render(<CapacityChip capacity={3} />);
    const chip = screen.getByTestId("capacity-chip");
    expect(chip.textContent).toBe("×3");
  });

  it("exposes capacity in the title for hover-discovery", () => {
    render(<CapacityChip capacity={5} />);
    const chip = screen.getByTestId("capacity-chip");
    expect(chip.getAttribute("title")).toBe("5 parallel cycles");
  });
});
