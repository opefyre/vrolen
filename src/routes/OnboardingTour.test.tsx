import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetOnboardingCacheForTests,
  hasSeenOnboarding,
  markOnboardingSeen,
} from "./onboarding-state";
import { OnboardingTour } from "./OnboardingTour";

describe("OnboardingTour (VROL-632)", () => {
  beforeEach(() => {
    _resetOnboardingCacheForTests();
    try {
      window.localStorage?.clear?.();
    } catch {
      // ignore
    }
  });

  it("renders the first step + Skip + Next when open", () => {
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Build your line/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip tour/i })).toBeInTheDocument();
  });

  it("Skip tour marks the localStorage flag + calls onClose", () => {
    const onClose = vi.fn();
    render(<OnboardingTour open={true} onClose={onClose} />);
    expect(hasSeenOnboarding()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Skip tour/i }));
    expect(onClose).toHaveBeenCalled();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("Next advances to step 2", () => {
    render(<OnboardingTour open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Tune the run/i)).toBeInTheDocument();
  });

  it("markOnboardingSeen + hasSeenOnboarding round-trip via localStorage", () => {
    expect(hasSeenOnboarding()).toBe(false);
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it("renders nothing when open=false", () => {
    const { container } = render(<OnboardingTour open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
