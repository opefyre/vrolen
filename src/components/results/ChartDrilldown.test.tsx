/**
 * VROL-896 — chart drilldown sheet tests.
 *
 * Validates the three things the chart-card callers depend on:
 *   1. Sheet renders title + description when `open` is true.
 *   2. Closing the sheet (via the X close affordance) fires `onClose`.
 *   3. The Copy-as-markdown affordance shows only when there is markdown.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartDrilldown } from "./ChartDrilldown";

describe("ChartDrilldown (VROL-896)", () => {
  it("renders the title and description when open is true", () => {
    render(
      <ChartDrilldown
        chartId="throughput"
        title="Throughput over time"
        description="Per-sample throughput across the run."
        open
        onClose={vi.fn()}
      >
        <div data-testid="chart-body">chart</div>
      </ChartDrilldown>,
    );
    expect(screen.getByText("Throughput over time")).toBeTruthy();
    expect(screen.getByText("Per-sample throughput across the run.")).toBeTruthy();
    expect(screen.getByTestId("chart-body")).toBeTruthy();
  });

  it("calls onClose when the close affordance fires", () => {
    const onClose = vi.fn();
    render(
      <ChartDrilldown chartId="oee" title="OEE over time" open onClose={onClose}>
        <div>chart body</div>
      </ChartDrilldown>,
    );
    // shadcn Sheet renders an "Close" sr-only button as the X affordance.
    const closeButton = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the Copy markdown button only when markdownData is non-empty", () => {
    const { rerender } = render(
      <ChartDrilldown chartId="rework" title="Rework over time" open onClose={vi.fn()}>
        <div>chart body</div>
      </ChartDrilldown>,
    );
    // No markdownData → no Copy button.
    expect(screen.queryByRole("button", { name: /copy data as markdown/i })).toBeNull();

    // Empty string still suppresses the button (treated as "no data").
    rerender(
      <ChartDrilldown
        chartId="rework"
        title="Rework over time"
        open
        markdownData=""
        onClose={vi.fn()}
      >
        <div>chart body</div>
      </ChartDrilldown>,
    );
    expect(screen.queryByRole("button", { name: /copy data as markdown/i })).toBeNull();

    // Non-empty markdownData → button appears.
    rerender(
      <ChartDrilldown
        chartId="rework"
        title="Rework over time"
        open
        markdownData="| t | rework |\n| --- | --- |\n| 0 | 0 |"
        onClose={vi.fn()}
      >
        <div>chart body</div>
      </ChartDrilldown>,
    );
    expect(screen.getByRole("button", { name: /copy data as markdown/i })).toBeTruthy();
  });
});
