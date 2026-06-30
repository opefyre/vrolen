import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import { ComparisonTable, ResultPanel } from "./ResultPanel";

function fakeResult(overrides: Partial<ChainResult> = {}): ChainResult {
  return {
    completed: 100,
    elapsedMs: 60_000,
    averageWipL: 5,
    throughputLambda: 100 / 60_000,
    avgTimeInSystemW: 500,
    perStationCompleted: [120, 100],
    perStationScrapped: [0, 0],
    perStationReworked: [0, 0],
    lineScrapRate: 0,
    lineReworkRate: 0,
    bottlenecks: [
      {
        stationId: "s1" as unknown as ChainResult["bottlenecks"][number]["stationId"],
        label: "Capper",
        runningPct: 0.98,
        primaryReason: "running",
        primaryReasonPct: 0.98,
        breakdown: [
          { state: "Running", pct: 0.98 },
          { state: "Starved", pct: 0.02 },
        ],
      },
    ],
    perStationOee: [
      {
        availability: 1,
        performance: 0.5,
        quality: 1,
        oee: 0.5,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 120,
        totalParts: 120,
        idealCycleTimeMs: 100,
      },
      {
        availability: 1,
        performance: 0.98,
        quality: 1,
        oee: 0.98,
        runTimeMs: 60_000,
        downTimeMs: 0,
        goodParts: 100,
        totalParts: 100,
        idealCycleTimeMs: 200,
      },
    ],
    lineOee: 0.7,
    bottleneckStationIdx: 1,
    aggregateBufferWipL: 2,
    perEdgeFlowed: [120, 100],
    samples: [],
    perStationCapacity: [1, 1],
    ...overrides,
  };
}

describe("ResultPanel — rework KPI surface (VROL-628)", () => {
  it("hides the Rework tile when no station rerouted parts", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    expect(screen.queryByText(/^Rework$/i)).toBeNull();
  });

  it("renders the Rework tile + per-station annotation when reworked > 0", () => {
    render(
      <ResultPanel
        result={fakeResult({
          perStationReworked: [0, 7],
          lineReworkRate: 0.034,
        })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Rework tile in the bottom KPI row (lives on Overview).
    expect(screen.getByText(/^Rework$/i)).toBeInTheDocument();
    // Per-station completed lives on the Stations tab — switch and the
    // per-station rows render directly (no accordion toggle).
    fireEvent.click(screen.getByRole("tab", { name: /Stations/i }));
    expect(screen.getByText(/· 7 rework/)).toBeInTheDocument();
  });

  it("renders the auto-narrated insights banner above the KPI tiles (VROL-640)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    const banner = screen.getByLabelText("Run insights");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Capper is the bottleneck");
  });

  it("renders the rework-over-time accordion when a station has rework + samples (VROL-641)", () => {
    render(
      <ResultPanel
        result={fakeResult({
          perStationReworked: [0, 7],
          lineReworkRate: 0.034,
          samples: [
            {
              tMs: 10_000,
              lineCompleted: 50,
              perStationCompleted: [60, 50],
              perEdgeBufferFill: [0],
              perStationStateMs: [],
              perStationRework: [0, 3],
            },
            {
              tMs: 60_000,
              lineCompleted: 100,
              perStationCompleted: [120, 100],
              perEdgeBufferFill: [0],
              perStationStateMs: [],
              perStationRework: [0, 7],
            },
          ],
        })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Rework-over-time lives on the Quality tab as a plain card.
    fireEvent.click(screen.getByRole("tab", { name: /Quality/i }));
    expect(screen.getByText(/Rework over time/i)).toBeInTheDocument();
  });

  it("hides the rework-over-time card when no station has rework", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Quality/i }));
    expect(screen.queryByText(/Rework over time/i)).toBeNull();
  });

  it("ComparisonTable: KPI delta tiles always visible + scalar table behind accordion (VROL-653)", () => {
    const a = fakeResult({ completed: 80, throughputLambda: 80 / 60_000 });
    const b = fakeResult({ completed: 120, throughputLambda: 120 / 60_000 });
    render(
      <ComparisonTable
        aName="base"
        aResult={a}
        aStationLabels={["Filler", "Capper"]}
        bName="tuned"
        bResult={b}
        bStationLabels={["Filler", "Capper"]}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // KPI tiles visible: Completed (80 → 120, delta +40).
    expect(screen.getByText(/^Completed$/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 40/)).toBeInTheDocument();
    // Scalar table is collapsed by default — header visible, body rows not.
    expect(screen.getByRole("button", { name: /All scalar deltas/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Avg time-in-system \(ms\)$/)).toBeNull();
    // Expand → body appears.
    fireEvent.click(screen.getByRole("button", { name: /All scalar deltas/i }));
    expect(screen.getByText(/^Avg time-in-system \(ms\)$/)).toBeInTheDocument();
  });

  it("Per-station detail renders directly inside its tab (no useless toggle)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Stations tab → per-station completed card visible without expanding.
    fireEvent.click(screen.getByRole("tab", { name: /Stations/i }));
    expect(screen.getByText(/Per-station completed/i)).toBeInTheDocument();
    // States tab → per-station state breakdown card visible without expanding.
    fireEvent.click(screen.getByRole("tab", { name: /States/i }));
    expect(screen.getByText(/Per-station state breakdown/i)).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// UX audit batch 3 — H3 / H8 / H9 (Sprint 194).
// ────────────────────────────────────────────────────────────────────────

describe("UX audit H3 — ActionCard slot promotion", () => {
  it("VROL-1174 — renders an ActionCard above the KPI grid (data-testid='action-card')", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // ActionCard exposes data-testid="action-card" (used by OnboardingTour).
    expect(screen.getByTestId("action-card")).toBeInTheDocument();
  });

  it("VROL-1175 — secondary tiles render inside the disclosure when sustainability data exists", () => {
    render(
      <ResultPanel
        result={fakeResult({ totalEnergyJ: 5_000, totalWaterL: 0, totalCO2eG: 0 })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    const disclosure = screen.getByTestId("result-secondary-tiles");
    expect(disclosure.tagName.toLowerCase()).toBe("details");
    // <details open> by default — so the energy tile inside should render.
    expect(disclosure.hasAttribute("open")).toBe(true);
  });

  it("VROL-1175 — disclosure not rendered when no yield + no sustainability data", () => {
    render(
      <ResultPanel
        result={fakeResult({ totalEnergyJ: 0, totalWaterL: 0, totalCO2eG: 0 })}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    expect(screen.queryByTestId("result-secondary-tiles")).toBeNull();
  });
});

describe("UX audit H9 — tab strip mobile select", () => {
  it("VROL-1178 — mobile select rendered (hidden via md:hidden at desktop sizes)", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    // Always present in the DOM; CSS controls visibility.
    const wrapper = screen.getByTestId("result-tabs-select");
    expect(wrapper.className).toContain("md:hidden");
    const select = wrapper.querySelector("select");
    expect(select).toBeTruthy();
    // Tab list options match the tab buttons.
    const options = Array.from(select?.querySelectorAll("option") ?? []);
    expect(options.length).toBeGreaterThanOrEqual(5);
  });

  it("VROL-1178 — selecting a tab via mobile select switches the active tab", () => {
    render(
      <ResultPanel
        result={fakeResult()}
        runMeta={{ stationLabels: ["Filler", "Capper"] }}
        horizonMs={60_000}
        warmupMs={0}
      />,
    );
    const select = screen
      .getByTestId("result-tabs-select")
      .querySelector("select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "stations" } });
    expect(screen.getByText(/Per-station completed/i)).toBeInTheDocument();
  });
});
