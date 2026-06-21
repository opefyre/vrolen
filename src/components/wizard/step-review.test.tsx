/**
 * VROL-820 — review-step preview card + Tweak section jumps.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepReview } from "./step-review";
import { defaultDraft } from "./wizard-types";

describe("StepReview (VROL-820)", () => {
  it("renders a summary row for each preview line", () => {
    render(<StepReview draft={defaultDraft()} onJump={() => {}} />);
    expect(screen.getByTestId("review-stations")).toBeInTheDocument();
    expect(screen.getByTestId("review-arrivals")).toBeInTheDocument();
    expect(screen.getByTestId("review-realism")).toBeInTheDocument();
  });

  it("renders a mini-DAG svg sized to ~200×80", () => {
    render(<StepReview draft={defaultDraft()} onJump={() => {}} />);
    const svg = screen.getByRole("img", { name: /Mini topology/i });
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 80");
  });

  it("Tweak section jumps back to the right step", () => {
    const onJump = vi.fn();
    render(<StepReview draft={defaultDraft()} onJump={onJump} />);
    const stationsRow = screen.getByTestId("review-stations");
    const tweak = stationsRow.querySelector("button");
    expect(tweak).not.toBeNull();
    if (tweak) fireEvent.click(tweak);
    expect(onJump).toHaveBeenCalledWith(1);
  });
});
