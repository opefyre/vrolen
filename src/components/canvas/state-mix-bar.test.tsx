import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StateMixBar } from "./state-mix-bar";

afterEach(() => {
  cleanup();
});

describe("StateMixBar (VROL-893)", () => {
  it("renders one colored segment per non-zero state", () => {
    const { container } = render(
      <StateMixBar
        breakdown={[
          { state: "Running", pct: 0.6 },
          { state: "Starved", pct: 0.3 },
          { state: "BlockedOut", pct: 0.1 },
        ]}
      />,
    );
    const segments = container.querySelectorAll("div.h-full");
    expect(segments.length).toBe(3);
    // Sanity: every visible segment carries one of the sim-* state colour classes.
    segments.forEach((seg) => {
      expect(seg.className).toMatch(/bg-sim-/);
    });
  });

  it("drops segments below 0.1%", () => {
    const { container } = render(
      <StateMixBar
        breakdown={[
          { state: "Running", pct: 1.0 },
          { state: "Down", pct: 0.0005 },
        ]}
      />,
    );
    const segments = container.querySelectorAll("div.h-full");
    expect(segments.length).toBe(1);
  });

  it("aria-label summarises the mix and names the dominant state with the friendlier 'Blocked' label", () => {
    render(
      <StateMixBar
        breakdown={[
          { state: "BlockedOut", pct: 0.7 },
          { state: "Running", pct: 0.3 },
        ]}
      />,
    );
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toContain("Blocked 70%");
    expect(bar.getAttribute("aria-label")).toContain("Running 30%");
    expect(bar.getAttribute("aria-label")).toContain("Dominant: Blocked");
    expect(bar.getAttribute("aria-label")).not.toContain("BlockedOut");
  });

  it("renders nothing when the breakdown is empty", () => {
    const { container } = render(<StateMixBar breakdown={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
