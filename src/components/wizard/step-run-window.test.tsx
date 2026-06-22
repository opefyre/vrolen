/**
 * VROL-871 — run window step authors horizon, warm-up, seed, buffer,
 * replications, sampler.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepRunWindow } from "./step-run-window";
import { defaultDraft } from "./wizard-types";

describe("StepRunWindow (VROL-871)", () => {
  it("renders the horizon and replications fields", () => {
    render(<StepRunWindow draft={defaultDraft()} update={() => {}} />);
    // DurationInput's label matches both the number input and the unit
    // select trigger, so we narrow to "Replications" (single-input) and
    // assert on text content for the horizon block instead.
    expect(screen.getByText(/Run length/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Replications/i)).toBeInTheDocument();
  });

  it("toggling the sampler checkbox flips samplerIntervalMs > 0 ↔ 0", () => {
    const draft = defaultDraft();
    const update = vi.fn();
    render(<StepRunWindow draft={draft} update={update} />);
    const checkbox = screen.getByRole("checkbox", { name: /Sample throughput/i });
    fireEvent.click(checkbox);
    expect(update).toHaveBeenCalled();
    const patch = update.mock.calls[0]?.[0] as { runWindow?: { samplerIntervalMs?: number } };
    expect(patch.runWindow?.samplerIntervalMs).toBeGreaterThan(0);
  });

  it("surfaces inline errors when warm-up >= horizon", () => {
    render(
      <StepRunWindow
        draft={defaultDraft()}
        update={() => {}}
        errors={{ warmupMs: "Warm-up must be shorter than the run length." }}
      />,
    );
    expect(screen.getByText(/Warm-up must be shorter/i)).toBeInTheDocument();
  });
});
