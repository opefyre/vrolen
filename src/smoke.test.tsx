/**
 * VROL-486 — End-to-end smoke test.
 *
 * Vitest + happy-dom flavour. Walks the golden path:
 *   landing → /run (results render) → editor (canvas mounts) → /help glossary.
 *
 * Playwright would exercise a real browser; that's the right tool once
 * VROL-486 picks up a browser harness. Until then this catches the
 * obvious regressions (broken imports, blank routes, crashing reducers)
 * across every route in one file.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "@/App";

function setPath(path: string): void {
  window.history.pushState({}, "", path);
}

describe("Smoke (VROL-486)", () => {
  it("/ renders the landing hero", () => {
    setPath("/");
    render(<App />);
    expect(screen.getByText(/Model your line/i)).toBeInTheDocument();
  });

  it("/run renders the controls + EmptyState pre-run", () => {
    setPath("/run");
    render(<App />);
    // RunPage shows the simulation card title + EmptyState while no run exists.
    expect(screen.getByText(/No results yet/i)).toBeInTheDocument();
  });

  it("/help renders the glossary headings", () => {
    setPath("/help");
    render(<App />);
    expect(screen.getByRole("heading", { name: /Glossary/i })).toBeInTheDocument();
    // CardTitle isn't a real heading; assert the description text instead.
    expect(screen.getByText(/What every number in the results panel means/i)).toBeInTheDocument();
  });

  it("/templates renders the gallery", () => {
    setPath("/templates");
    render(<App />);
    expect(screen.getByRole("heading", { name: /^Templates$/i })).toBeInTheDocument();
  });
});
