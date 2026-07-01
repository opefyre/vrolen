import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingPage from "./LandingPage";

describe("LandingPage (VROL-629)", () => {
  it("renders the headline + CTA + footer links (VROL-815)", () => {
    render(<LandingPage />);
    expect(screen.getByText(/Model your line, find the bottleneck/i)).toBeInTheDocument();
    // VROL-815 — three-tier CTA hierarchy: primary "Create scenario — 30s",
    // outline "Run the demo", link "Browse N presets".
    // VROL-1222 — the count is now derived from PRESETS.length + the
    // word is "preset" (matches the Scenarios drawer badge).
    expect(screen.getByRole("button", { name: /Create scenario — 30s/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run the demo/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Browse \d+ presets?/i })).toBeInTheDocument();
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
