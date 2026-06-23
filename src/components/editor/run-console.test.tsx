import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RunConsole, logToRunConsole } from "./run-console";

afterEach(() => {
  cleanup();
});

describe("RunConsole (VROL-777)", () => {
  it("renders the header and exposes the Clear control", () => {
    render(<RunConsole />);
    expect(screen.getAllByText(/Run console/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Clear run console").length).toBeGreaterThan(0);
  });

  it("logToRunConsole is callable without throwing for every severity", () => {
    expect(() => {
      logToRunConsole("info", "An info line");
      logToRunConsole("success", "A success line", "with description");
      logToRunConsole("warning", "A warning line");
      logToRunConsole("error", "An error line", "with stack");
    }).not.toThrow();
  });

  it("exposes Expand/Collapse toggle for the entry list", () => {
    render(<RunConsole />);
    const toggle = screen.getAllByLabelText(/expand run console|collapse run console/i);
    expect(toggle.length).toBeGreaterThan(0);
  });

  // VROL-910 — playhead-aware filter.
  it("hides sim-time-tagged entries whose simTimeMs > playheadTimeMs", () => {
    logToRunConsole("info", "past event", undefined, 1000);
    logToRunConsole("info", "future event", undefined, 5000);
    render(<RunConsole playheadTimeMs={2000} />);
    expect(screen.getAllByText(/past event/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/future event/i)).toBeNull();
  });

  it("untagged entries always show regardless of playheadTimeMs", () => {
    logToRunConsole("info", "untagged event");
    render(<RunConsole playheadTimeMs={0} />);
    expect(screen.getAllByText(/untagged event/i).length).toBeGreaterThan(0);
  });

  it("shows '+N after playhead' indicator when entries are hidden by the filter", () => {
    logToRunConsole("info", "later event", undefined, 5000);
    render(<RunConsole playheadTimeMs={1000} />);
    expect(screen.getAllByText(/after playhead/i).length).toBeGreaterThan(0);
  });
});
