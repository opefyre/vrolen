/**
 * VROL-812 — Cmd+S inline scenario-name dialog.
 *
 * Smoke-tests the dialog body: when open, the input + Save button render
 * and submit a trimmed name; the Save button is disabled on empty input.
 *
 * We don't try to exercise focus-trap + auto-focus here — those are owned
 * by Base UI's Dialog primitive and tested by the primitive's own suite.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SaveNameDialog } from "./save-name-dialog";

describe("SaveNameDialog (VROL-812)", () => {
  it("renders the input + Save / Cancel pair when open", () => {
    render(<SaveNameDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByTestId("save-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("save-name-submit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("disables Save when the name is whitespace-only", () => {
    render(<SaveNameDialog open onOpenChange={() => {}} onSubmit={() => {}} />);
    const submit = screen.getByTestId("save-name-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("save-name-input"), {
      target: { value: "   " },
    });
    expect(submit.disabled).toBe(true);
  });

  it("submits a trimmed name and closes the dialog", () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(<SaveNameDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("save-name-input"), {
      target: { value: "  My scenario  " },
    });
    fireEvent.click(screen.getByTestId("save-name-submit"));
    expect(onSubmit).toHaveBeenCalledWith("My scenario");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not render the body when closed (state resets on next open)", () => {
    const { rerender } = render(
      <SaveNameDialog open={false} onOpenChange={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.queryByTestId("save-name-input")).not.toBeInTheDocument();

    rerender(
      <SaveNameDialog open onOpenChange={() => {}} onSubmit={() => {}} initialName="seed" />,
    );
    const input = screen.getByTestId("save-name-input") as HTMLInputElement;
    expect(input.value).toBe("seed");
  });
});
