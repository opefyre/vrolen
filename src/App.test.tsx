import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the Hello Vrolen heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /hello vrolen/i })).toBeInTheDocument();
  });

  it("renders the Phase 0 subtitle", () => {
    render(<App />);
    expect(screen.getByText(/phase 0 foundation/i)).toBeInTheDocument();
  });

  it("mounts the shadcn Button (dialog trigger)", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /open dialog/i })).toBeInTheDocument();
  });

  it("mounts the shadcn Input with placeholder", () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/tailwind \+ shadcn smoke test/i)).toBeInTheDocument();
  });
});
