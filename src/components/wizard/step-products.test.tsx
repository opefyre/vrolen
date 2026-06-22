/**
 * VROL-871 — products step is gated by the "Run with multiple products"
 * checkbox; toggling it on reveals the product list + per-station recipe.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepProducts } from "./step-products";
import { defaultDraft } from "./wizard-types";

describe("StepProducts (VROL-871)", () => {
  it("collapses the editor when productsEnabled is false", () => {
    render(<StepProducts draft={defaultDraft()} update={() => {}} />);
    expect(screen.queryByText(/Per-station recipe/i)).not.toBeInTheDocument();
  });

  it("renders the recipe editor when productsEnabled flips on", () => {
    const draft = { ...defaultDraft(), productsEnabled: true };
    render(<StepProducts draft={draft} update={() => {}} />);
    expect(screen.getByText(/Per-station recipe/i)).toBeInTheDocument();
  });

  it("Add product appends a new product", () => {
    const draft = { ...defaultDraft(), productsEnabled: true };
    const update = vi.fn();
    render(<StepProducts draft={draft} update={update} />);
    fireEvent.click(screen.getByRole("button", { name: /Add product/i }));
    expect(update).toHaveBeenCalled();
    const patch = update.mock.calls[0]?.[0] as { products?: unknown[] };
    expect(patch.products).toBeDefined();
    expect((patch.products ?? []).length).toBe(draft.products.length + 1);
  });
});
