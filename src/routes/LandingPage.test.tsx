import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "./LandingPage";

describe("LandingPage (VROL-629)", () => {
  it("renders the headline + CTA + footer links", () => {
    render(<LandingPage />);
    expect(screen.getByText(/Model your line, find the bottleneck/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open the editor/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Editor$/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Run logs$/ })).toBeInTheDocument();
  });

  it("renders one preset chip per PRESETS entry", async () => {
    const { PRESETS } = await import("@/lib/presets");
    render(<LandingPage />);
    for (const p of PRESETS) {
      expect(screen.getByRole("button", { name: `Load preset ${p.title}` })).toBeInTheDocument();
    }
  });
});
