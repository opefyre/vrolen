import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetCoachTipsForTests } from "@/lib/coach-state";

import { Coach, type CoachTip } from "./coach";

/**
 * VROL-819 — coach overlay rendering + dismissal.
 *
 * Covers: first-visible-tip selection (priority order), auto-dismiss when
 * `whenVisible()` flips false, "Don't show again" persistence, and the
 * optional CTA action callback.
 */
describe("Coach (VROL-819)", () => {
  beforeEach(() => {
    resetCoachTipsForTests();
    try {
      window.localStorage?.clear?.();
    } catch {
      // ignore
    }
  });

  function makeTips(overrides: Partial<Record<string, Partial<CoachTip>>> = {}): CoachTip[] {
    const base: CoachTip[] = [
      {
        id: "tip-a",
        title: "Tip A",
        body: "Body A",
        whenVisible: () => false,
      },
      {
        id: "tip-b",
        title: "Tip B",
        body: "Body B",
        whenVisible: () => false,
      },
    ];
    return base.map((t) => ({ ...t, ...overrides[t.id] }));
  }

  it("renders nothing when no tip is visible", () => {
    const { container } = render(<Coach tips={makeTips()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the first visible tip", () => {
    const tips = makeTips({
      "tip-a": { whenVisible: () => true },
      "tip-b": { whenVisible: () => true },
    });
    render(<Coach tips={tips} />);
    expect(screen.getByText("Tip A")).toBeInTheDocument();
    expect(screen.queryByText("Tip B")).not.toBeInTheDocument();
  });

  it("skips tips whose whenVisible returns false and picks the next match", () => {
    const tips = makeTips({
      "tip-a": { whenVisible: () => false },
      "tip-b": { whenVisible: () => true },
    });
    render(<Coach tips={tips} />);
    expect(screen.getByText("Tip B")).toBeInTheDocument();
  });

  it("renders an action button that calls the onClick callback", () => {
    const runNow = vi.fn();
    const tips: CoachTip[] = [
      {
        id: "run-it",
        title: "Run it",
        body: "Press run.",
        whenVisible: () => true,
        action: { label: "Run now", onClick: runNow },
      },
    ];
    render(<Coach tips={tips} />);
    fireEvent.click(screen.getByTestId("coach-action"));
    expect(runNow).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Don't show again' hides the tip and persists the dismissal", () => {
    const tips = makeTips({
      "tip-a": { whenVisible: () => true },
      "tip-b": { whenVisible: () => true },
    });
    const { rerender } = render(<Coach tips={tips} />);
    expect(screen.getByText("Tip A")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("coach-dismiss"));

    // After dismissing A, the next visible tip (B) surfaces.
    expect(screen.queryByText("Tip A")).not.toBeInTheDocument();
    expect(screen.getByText("Tip B")).toBeInTheDocument();

    // Persistence — a fresh mount still hides A.
    rerender(<Coach tips={tips} />);
    expect(screen.queryByText("Tip A")).not.toBeInTheDocument();
    expect(screen.getByText("Tip B")).toBeInTheDocument();
  });

  it("renders nothing when all visible tips are dismissed", () => {
    const tips = makeTips({
      "tip-a": { whenVisible: () => true },
    });
    const { container } = render(<Coach tips={tips} />);
    fireEvent.click(screen.getByTestId("coach-dismiss"));
    expect(container.firstChild).toBeNull();
  });
});
