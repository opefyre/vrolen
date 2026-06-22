/**
 * VROL-820 + VROL-871 — review step preview card + Tweak section jumps.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StepReview } from "./step-review";
import { defaultDraft, type WizardDraft } from "./wizard-types";

/**
 * VROL-821 — the default draft now seeds `shapeKind: null`. For review-step
 * happy-path specs we need a draft that has actually picked a shape, since
 * the review rollup includes validateShape. Helper keeps each test compact.
 */
function pickedDraft(): WizardDraft {
  return { ...defaultDraft(), shapeKind: "single-line" };
}

describe("StepReview (VROL-871)", () => {
  it("renders a summary row for each preview line", () => {
    render(<StepReview draft={pickedDraft()} onJump={() => {}} />);
    expect(screen.getByTestId("review-stations")).toBeInTheDocument();
    expect(screen.getByTestId("review-connections")).toBeInTheDocument();
    expect(screen.getByTestId("review-arrivals")).toBeInTheDocument();
    expect(screen.getByTestId("review-realism")).toBeInTheDocument();
    expect(screen.getByTestId("review-replications")).toBeInTheDocument();
  });

  it("renders a mini-DAG svg with the per-station count baked into the aria label", () => {
    render(<StepReview draft={pickedDraft()} onJump={() => {}} />);
    const svg = screen.getByRole("img", { name: /Mini topology/i });
    expect(svg).toBeInTheDocument();
    // viewBox is 220x96 in the rebuilt mini-DAG.
    expect(svg.getAttribute("viewBox")).toBe("0 0 220 96");
  });

  it("Tweak section jumps back to the right step", () => {
    const onJump = vi.fn();
    render(<StepReview draft={pickedDraft()} onJump={onJump} />);
    const stationsRow = screen.getByTestId("review-stations");
    const tweak = stationsRow.querySelector("button");
    expect(tweak).not.toBeNull();
    if (tweak) fireEvent.click(tweak);
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it("happy path shows a green Looks good banner", () => {
    render(<StepReview draft={pickedDraft()} onJump={() => {}} />);
    expect(screen.getByText(/Looks good/i)).toBeInTheDocument();
  });

  it("surfaces upstream issues in the validation summary", () => {
    const draft = pickedDraft();
    const broken = {
      ...draft,
      stations: [{ ...draft.stations[0]!, label: "" }],
      connections: [],
    };
    render(<StepReview draft={broken} onJump={() => {}} />);
    expect(screen.getByText(/need attention/i)).toBeInTheDocument();
  });
});
