/**
 * VROL-804 — TemplatesPage filter EmptyState.
 *
 * Confirms the EmptyState renders when the filter eliminates every preset,
 * exposes a single "Clear filter" CTA (per the canonical CTA tree), and
 * clicking the CTA restores the list.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TemplatesPage from "./TemplatesPage";

describe("TemplatesPage filter empty state (VROL-804)", () => {
  it("renders the EmptyState + Clear filter CTA when no presets match", () => {
    render(<TemplatesPage />);
    const filter = screen.getByTestId("templates-filter");
    act(() => {
      fireEvent.change(filter, { target: { value: "xyzzy-no-preset-matches-this" } });
    });
    expect(screen.getByText(/No templates match/i)).toBeInTheDocument();
    expect(screen.getByTestId("templates-clear-filter")).toBeInTheDocument();
  });

  it("clicking Clear filter restores the preset list", () => {
    render(<TemplatesPage />);
    const filter = screen.getByTestId("templates-filter");
    act(() => {
      fireEvent.change(filter, { target: { value: "xyzzy-no-preset-matches-this" } });
    });
    const clearBtn = screen.getByTestId("templates-clear-filter");
    act(() => {
      clearBtn.click();
    });
    expect(screen.queryByText(/No templates match/i)).not.toBeInTheDocument();
  });
});
