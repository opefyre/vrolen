import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the LandingPage hero at root", () => {
    render(<App />);
    expect(screen.getByText(/Model your line, find the bottleneck/i)).toBeInTheDocument();
  });

  it("surfaces the Open the editor CTA", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /Open the editor/i })).toBeInTheDocument();
  });

  it("renders the bottom-of-page footer links", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "/editor" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/run" })).toBeInTheDocument();
  });
});
