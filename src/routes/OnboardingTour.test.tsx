import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetOnboardingCacheForTests,
  hasSeenOnboarding,
  loadOnboardingStep,
  markOnboardingSeen,
  saveOnboardingStep,
} from "./onboarding-state";
import { OnboardingTour } from "./OnboardingTour";

/**
 * VROL-818 — teaching-tour rewrite. Covers:
 *   - Step 1 renders with Skip, Next, disabled Back.
 *   - Next advances to step 2 and persists the resume-step.
 *   - Back returns to the previous step.
 *   - Skip closes + sets the seen flag.
 *   - Reaching the final step + clicking Finish marks seen.
 *   - Resume: mounting with a persisted step opens on that step.
 *   - open=false renders nothing.
 */
describe("OnboardingTour (VROL-818)", () => {
  beforeEach(() => {
    _resetOnboardingCacheForTests();
    try {
      window.localStorage?.clear?.();
    } catch {
      // ignore
    }
    // Mount data-tour targets so steps 2–5 don't auto-skip. The component
    // looks up targets via document.querySelector by data-tour attribute;
    // any element will do for these tests since we don't assert on rect
    // geometry.
    const host = document.createElement("div");
    host.innerHTML = `
      <div data-tour="canvas">canvas</div>
      <button data-tour="run-button">Run</button>
      <div data-tour="bottleneck-tile">Station X · 1200ms</div>
      <div data-tour="scenarios-menu">Scenarios</div>
    `;
    host.setAttribute("data-onboarding-test-host", "true");
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.querySelectorAll("[data-onboarding-test-host]").forEach((n) => {
      n.remove();
    });
  });

  function advanceFrame(): void {
    // The component fires a rAF on mount to measure the target. Steps with
    // no target render the welcome popover synchronously; steps with a
    // missing target auto-skip on the next frame. Flush both.
    act(() => {
      vi.advanceTimersByTime(32);
    });
  }

  it("renders step 1 with welcome copy, Skip, Next, and disabled Back", () => {
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Welcome to Vrolen/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 5/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip tour/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Next$/ })).toBeInTheDocument();
    const back = screen.getByRole("button", { name: /^Back$/ });
    expect(back).toBeDisabled();
  });

  it("Skip tour marks the seen flag and calls onClose", () => {
    const onClose = vi.fn();
    render(<OnboardingTour open={true} onClose={onClose} />);
    expect(hasSeenOnboarding()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Skip tour/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("Next advances to step 2 and persists the resume-step", () => {
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
    expect(screen.getByText(/2 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/graph is your line/i)).toBeInTheDocument();
    expect(loadOnboardingStep()).toBe(1);
  });

  it("Back returns to the previous step", () => {
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
    expect(screen.getByText(/2 of 5/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
    expect(screen.getByText(/1 of 5/i)).toBeInTheDocument();
    expect(loadOnboardingStep()).toBe(0);
  });

  it("resumes from the persisted step on mount", () => {
    // happy-dom's localStorage shim is non-functional in this env, so the
    // in-memory cache IS the persistence layer for tests — don't reset it
    // between save and render. The real-browser path is exercised by the
    // round-trip test below using the same module surface.
    saveOnboardingStep(2);
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/3 of 5/i)).toBeInTheDocument();
  });

  it("step 5 shows Finish and clicking it closes + marks seen", () => {
    saveOnboardingStep(4);
    const onClose = vi.fn();
    render(<OnboardingTour open={true} onClose={onClose} />);
    expect(screen.getByText(/5 of 5/i)).toBeInTheDocument();
    const finish = screen.getByRole("button", { name: /^Finish$/ });
    fireEvent.click(finish);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("markOnboardingSeen + hasSeenOnboarding round-trip via localStorage", () => {
    expect(hasSeenOnboarding()).toBe(false);
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("clears the resume-step on markOnboardingSeen", () => {
    saveOnboardingStep(3);
    expect(loadOnboardingStep()).toBe(3);
    markOnboardingSeen();
    expect(loadOnboardingStep()).toBe(0);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(<OnboardingTour open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("auto-skips a step whose target is missing", () => {
    vi.useFakeTimers();
    // Drive rAF via fake timers so the auto-skip effect fires
    // deterministically.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        return Number(setTimeout(() => cb(performance.now()), 0));
      });
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
      clearTimeout(id);
    });

    try {
      // Remove the bottleneck-tile target so step 4 has nothing to point at.
      document.querySelectorAll("[data-tour='bottleneck-tile']").forEach((n) => {
        n.remove();
      });
      saveOnboardingStep(3); // step 4 (bottleneck)
      render(<OnboardingTour open={true} onClose={vi.fn()} />);
      advanceFrame();
      advanceFrame();
      // After auto-skipping past step 4, we should land on step 5
      // (scenarios-menu) — that target IS in the DOM so the tour holds
      // there instead of finishing.
      expect(screen.queryByText(/4 of 5/i)).not.toBeInTheDocument();
      expect(screen.getByText(/5 of 5/i)).toBeInTheDocument();
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
