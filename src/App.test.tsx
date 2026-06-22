import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the LandingPage hero at root", () => {
    render(<App />);
    expect(screen.getByText(/Model your line, find the bottleneck/i)).toBeInTheDocument();
  });

  it("surfaces the Run the demo CTA (VROL-815)", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Run the demo/i })).toBeInTheDocument();
  });

  it("renders the bottom-of-page footer links", () => {
    render(<App />);
    // Run logs link only appears in the page footer (sidebar uses different label).
    expect(screen.getByRole("link", { name: /^Run logs$/ })).toBeInTheDocument();
    // Footer also surfaces a Learn link.
    expect(screen.getByRole("link", { name: /^Learn$/ })).toBeInTheDocument();
  });
});
