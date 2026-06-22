/**
 * VROL-849 — analytics card shell tests.
 *
 * Asserts the four lifecycle states render the right pill, the Run/Retry
 * buttons appear in the right places, and clicking them fires onRun.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsCardShell } from "./AnalyticsCardShell";

describe("AnalyticsCardShell (VROL-849)", () => {
  it("renders idle state with Off pill, the call-to-action body, and the Run button", () => {
    const onRun = vi.fn();
    render(
      <AnalyticsCardShell
        title="Sensitivity"
        description="±20% sweep"
        status="idle"
        onRun={onRun}
        runLabel="Run sweep"
      >
        <p>Click run to start.</p>
      </AnalyticsCardShell>,
    );
    expect(screen.getByText("Click run to start.")).toBeTruthy();
    const pill = screen.getByText("Off");
    expect(
      pill.getAttribute("data-status") ??
        pill.closest("[data-status]")?.getAttribute("data-status"),
    ).toBe("idle");
    const button = screen.getByRole("button", { name: /run sweep/i });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("renders running state with a Running… pill and an overlay over the body, and hides the Run button", () => {
    const { container } = render(
      <AnalyticsCardShell title="Sensitivity" status="running" onRun={vi.fn()} runLabel="Run sweep">
        <p>Body content while running.</p>
      </AnalyticsCardShell>,
    );
    // Pill text fallback for running is "Running…" (appears in pill + overlay).
    expect(screen.getAllByText(/Running…/i).length).toBeGreaterThanOrEqual(1);
    // Body is still in the DOM (overlay sits on top).
    expect(screen.getByText("Body content while running.")).toBeTruthy();
    // No Run button (we use the overlay instead).
    expect(screen.queryByRole("button", { name: /run sweep/i })).toBeNull();
    // Overlay element present.
    expect(container.querySelector("[data-slot='analytics-running-overlay']")).toBeTruthy();
  });

  it("renders done state with a Done pill, the results body, and a 'Re-run' button", () => {
    const onRun = vi.fn();
    render(
      <AnalyticsCardShell title="Sensitivity" status="done" onRun={onRun} runLabel="Run sweep">
        <p>Sweep complete — results below.</p>
      </AnalyticsCardShell>,
    );
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("Sweep complete — results below.")).toBeTruthy();
    const button = screen.getByRole("button", { name: /re-run sweep/i });
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("renders error state with the message and a Retry button that calls onRun", () => {
    const onRun = vi.fn();
    render(
      <AnalyticsCardShell
        title="Sensitivity"
        status="error"
        onRun={onRun}
        errorMessage="Engine crashed at step 3."
      >
        <p>Hidden during error.</p>
      </AnalyticsCardShell>,
    );
    expect(screen.getByText("Engine crashed at step 3.")).toBeTruthy();
    // The children should NOT be rendered in error mode.
    expect(screen.queryByText("Hidden during error.")).toBeNull();
    // Pill reads Error.
    expect(screen.getByText("Error")).toBeTruthy();
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("suppresses the Run button when no onRun handler is supplied (status-only shell)", () => {
    render(
      <AnalyticsCardShell title="Replications" status="done" statusLabel="CV 2.1% · tight">
        <p>Mean ± CI table goes here.</p>
      </AnalyticsCardShell>,
    );
    expect(screen.getByText("CV 2.1% · tight")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
