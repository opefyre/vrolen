/**
 * VROL-842 — OptimizationCard rendering tests.
 *
 * Exercises the three new affordances added by VROL-842 — constraints that
 * mark cells infeasible, the heatmap/Pareto view toggle, and the objective
 * Select (verified indirectly via the rendered options list because base-ui
 * Select uses a portal that's brittle to drive in happy-dom).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OptimizationCandidate, OptimizationSummary } from "@/lib/optimization-search";

import { OptimizationCard } from "./OptimizationCard";

function candidate(overrides: Partial<OptimizationCandidate>): OptimizationCandidate {
  return {
    bufferCapacity: 2,
    cycleMultiplier: 1,
    toolPoolDelta: 0,
    targetStationIdx: 0,
    meanThroughputPerHour: 1_000,
    meanCompleted: 1_000,
    meanTimeInSystemMs: 5_000,
    meanScrapRate: 0,
    meanLineOee: 0.5,
    meanAvgWipL: 4,
    meanGoodPartsPerHour: 1_000,
    replications: 1,
    // VROL-1036/1037 — sustainability cost defaults.
    meanTotalEnergyJ: 0,
    meanEnergyIntensityJPerPart: 0,
    // VROL-1059 — CI defaults: single-rep → zero half-width.
    throughputStddev: 0,
    throughputHalfWidth95: 0,
    throughputLow95: 1_000,
    throughputHigh95: 1_000,
    ...overrides,
  } satisfies OptimizationCandidate;
}

function makeSummary(): OptimizationSummary {
  // 2 × 2 grid — small but enough to verify constraint masking and Pareto
  // dominance behaviour.
  const candidates: OptimizationCandidate[] = [
    candidate({
      bufferCapacity: 2,
      cycleMultiplier: 1,
      meanThroughputPerHour: 900,
      meanTimeInSystemMs: 7_000,
      meanAvgWipL: 3,
      meanLineOee: 0.4,
      meanGoodPartsPerHour: 900,
    }),
    candidate({
      bufferCapacity: 4,
      cycleMultiplier: 1,
      meanThroughputPerHour: 1_100,
      meanTimeInSystemMs: 8_000,
      meanAvgWipL: 6,
      meanLineOee: 0.55,
      meanGoodPartsPerHour: 1_080,
    }),
    candidate({
      bufferCapacity: 2,
      cycleMultiplier: 0.8,
      meanThroughputPerHour: 1_200,
      meanTimeInSystemMs: 4_000,
      meanAvgWipL: 5,
      meanLineOee: 0.7,
      meanGoodPartsPerHour: 1_180,
    }),
    candidate({
      bufferCapacity: 4,
      cycleMultiplier: 0.8,
      meanThroughputPerHour: 1_400,
      meanTimeInSystemMs: 5_500,
      meanAvgWipL: 9,
      meanLineOee: 0.82,
      meanGoodPartsPerHour: 1_380,
    }),
  ];
  const sorted = [...candidates].sort((a, b) => b.meanThroughputPerHour - a.meanThroughputPerHour);
  return {
    candidates,
    best: sorted[0]!,
    runnerUp: sorted[1] ?? null,
    currentCapacity: 2,
    targetStationIdx: 0,
    targetStationLabel: "Filler",
    bufferLevels: [2, 4],
    cycleMultipliers: [1, 0.8],
    searchSize: 4,
    elapsedMs: 12,
  };
}

describe("OptimizationCard (VROL-842)", () => {
  it("renders the objective selector with 'Maximize throughput' as the default and the constraint inputs", () => {
    const summary = makeSummary();
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    // Objective trigger is labelled by the visible "Objective" label
    // (htmlFor → id pairing) and shows the default option text.
    const trigger = screen.getByLabelText("Objective");
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain("Maximize throughput");
    // Both constraint inputs render with their accessible labels.
    expect(container.querySelector("#optimization-max-tis")).toBeTruthy();
    expect(container.querySelector("#optimization-max-wip")).toBeTruthy();
    // With no constraints set, every cell is feasible.
    const allCells = container.querySelectorAll('[data-slot="optimization-cell"]');
    expect(allCells.length).toBe(4);
    const infeasible = container.querySelectorAll(
      '[data-slot="optimization-cell"][data-feasible="false"]',
    );
    expect(infeasible.length).toBe(0);
  });

  it("marks cells that violate the max-WIP constraint as infeasible and excludes them from 'best'", () => {
    const summary = makeSummary();
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    // Default — no constraints — winner is the throughput-max candidate
    // (WIP 4 @0.80×, 1400 /h).
    const initialWinner = container.querySelector(
      '[data-slot="optimization-cell"][data-winner="true"]',
    );
    expect(initialWinner?.textContent ?? "").toContain("1,400");
    // Set max WIP = 7 — this rules out the WIP 4 @0.80× cell (avgWip 9)
    // and the WIP 4 @1.00× cell (avgWip 6 — still feasible).
    const maxWipInput = container.querySelector("#optimization-max-wip") as HTMLInputElement | null;
    expect(maxWipInput).toBeTruthy();
    fireEvent.change(maxWipInput!, { target: { value: "7" } });
    fireEvent.blur(maxWipInput!);
    // The infeasible cell is the avgWipL=9 candidate (WIP 4 @0.80×). Its
    // data-feasible attribute should now be "false".
    const infeasible = Array.from(
      container.querySelectorAll('[data-slot="optimization-cell"][data-feasible="false"]'),
    );
    expect(infeasible.length).toBeGreaterThan(0);
    // The new winner should NOT be the dropped cell — verify the rendered
    // winner moved to a feasible candidate. Highest throughput among
    // feasible (WIP≤7) is WIP 2 @0.80× at 1,200 /h.
    const newWinner = container.querySelector(
      '[data-slot="optimization-cell"][data-winner="true"]',
    );
    expect(newWinner?.textContent ?? "").toContain("1,200");
    // And the previously-best cell now reads "infeasible" rather than
    // claiming the crown.
    expect(infeasible.some((el) => (el.textContent ?? "").includes("infeasible"))).toBe(true);
  });

  it("VROL-1055 — renders the max energy / part constraint input", () => {
    const summary = makeSummary();
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    expect(container.querySelector("#optimization-max-energy-intensity")).toBeTruthy();
  });

  it("VROL-1055 — max energy / part constraint marks high-intensity cells infeasible", () => {
    // Build a 2-cell summary where cell A has low intensity and cell B
    // has high — set the constraint and assert B becomes infeasible.
    const candidates: OptimizationCandidate[] = [
      candidate({
        bufferCapacity: 2,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_000,
        meanEnergyIntensityJPerPart: 100,
      }),
      candidate({
        bufferCapacity: 4,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_400,
        meanEnergyIntensityJPerPart: 500, // high
      }),
    ];
    const summary: OptimizationSummary = {
      candidates,
      best: candidates[1]!,
      runnerUp: candidates[0]!,
      currentCapacity: 2,
      targetStationIdx: 0,
      targetStationLabel: "Filler",
      bufferLevels: [2, 4],
      cycleMultipliers: [1],
      searchSize: 2,
      elapsedMs: 12,
    };
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const input = container.querySelector(
      "#optimization-max-energy-intensity",
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: "200" } });
    fireEvent.blur(input!);
    // High-intensity cell B (500 J/part) must be infeasible at the 200
    // J/part constraint; cell A (100 J/part) stays feasible.
    const infeasible = container.querySelectorAll(
      '[data-slot="optimization-cell"][data-feasible="false"]',
    );
    expect(infeasible.length).toBe(1);
    expect(infeasible[0]!.textContent ?? "").toContain("1,400");
  });

  it("VROL-1037 — exposes 'Minimize energy / part' as a selectable objective", () => {
    const summary = makeSummary();
    render(<OptimizationCard summary={summary} running={false} onRun={() => undefined} />);
    // Open the objective dropdown — shadcn/Radix Select renders items
    // into a portal once the trigger fires.
    const trigger = screen.getByLabelText("Objective");
    fireEvent.click(trigger);
    expect(screen.getByText("Minimize energy / part")).toBeTruthy();
  });

  it("VROL-1038 — Pareto plot X axis defaults to time-in-system", () => {
    const summary = makeSummary();
    render(<OptimizationCard summary={summary} running={false} onRun={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Pareto" }));
    // Caption + axis label both reference time-in-system before the
    // objective is changed.
    expect(screen.getAllByText(/time-in-system/i).length).toBeGreaterThan(0);
  });

  it("toggles between heatmap and Pareto views via the segmented control", () => {
    const summary = makeSummary();
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    // Heatmap is the default — heatmap cells exist, no Pareto dots yet.
    expect(container.querySelectorAll('[data-slot="optimization-cell"]').length).toBe(4);
    expect(container.querySelectorAll('[data-slot="pareto-dot"]').length).toBe(0);
    // Click "Pareto" — heatmap cells disappear, Pareto dots appear, and at
    // least one dot is tagged as on-the-frontier.
    fireEvent.click(screen.getByRole("button", { name: "Pareto" }));
    expect(container.querySelectorAll('[data-slot="optimization-cell"]').length).toBe(0);
    const dots = container.querySelectorAll('[data-slot="pareto-dot"]');
    expect(dots.length).toBe(4);
    const frontierDots = container.querySelectorAll(
      '[data-slot="pareto-dot"][data-frontier="true"]',
    );
    expect(frontierDots.length).toBeGreaterThan(0);
    // Toggle back to the heatmap — cells return, dots vanish.
    fireEvent.click(screen.getByRole("button", { name: "Heatmap" }));
    expect(container.querySelectorAll('[data-slot="optimization-cell"]').length).toBe(4);
    expect(container.querySelectorAll('[data-slot="pareto-dot"]').length).toBe(0);
  });

  it("VROL-1059 — picker prefers higher LOWER-95 bound when CIs overlap on throughput", () => {
    // Two candidates with overlapping 95% CIs:
    //   A: mean 1000, halfWidth 200 → CI [800, 1200]
    //   B: mean 1100, halfWidth 400 → CI [700, 1500]
    // A has the higher LOWER bound (800 > 700), so the robust picker
    // prefers A even though B has the higher MEAN.
    const candidates: OptimizationCandidate[] = [
      candidate({
        bufferCapacity: 2,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_000,
        throughputStddev: 100,
        throughputHalfWidth95: 200,
        throughputLow95: 800,
        throughputHigh95: 1_200,
      }),
      candidate({
        bufferCapacity: 4,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_100,
        throughputStddev: 200,
        throughputHalfWidth95: 400,
        throughputLow95: 700,
        throughputHigh95: 1_500,
      }),
    ];
    const summary: OptimizationSummary = {
      candidates,
      best: candidates[1]!,
      runnerUp: candidates[0]!,
      currentCapacity: 2,
      targetStationIdx: 0,
      targetStationLabel: "Filler",
      bufferLevels: [2, 4],
      cycleMultipliers: [1],
      searchSize: 2,
      elapsedMs: 12,
    };
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const winner = container.querySelector('[data-slot="optimization-cell"][data-winner="true"]');
    expect(winner?.textContent ?? "").toContain("1,000");
  });

  it("VROL-1059 — picker falls back to mean ordering when CIs don't overlap", () => {
    // A: mean 1000, halfWidth 50 → CI [950, 1050]
    // B: mean 1200, halfWidth 50 → CI [1150, 1250]
    // CIs don't overlap (1050 < 1150), so the picker prefers B by mean.
    const candidates: OptimizationCandidate[] = [
      candidate({
        bufferCapacity: 2,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_000,
        throughputStddev: 25,
        throughputHalfWidth95: 50,
        throughputLow95: 950,
        throughputHigh95: 1_050,
      }),
      candidate({
        bufferCapacity: 4,
        cycleMultiplier: 1,
        meanThroughputPerHour: 1_200,
        throughputStddev: 25,
        throughputHalfWidth95: 50,
        throughputLow95: 1_150,
        throughputHigh95: 1_250,
      }),
    ];
    const summary: OptimizationSummary = {
      candidates,
      best: candidates[1]!,
      runnerUp: candidates[0]!,
      currentCapacity: 2,
      targetStationIdx: 0,
      targetStationLabel: "Filler",
      bufferLevels: [2, 4],
      cycleMultipliers: [1],
      searchSize: 2,
      elapsedMs: 12,
    };
    const { container } = render(
      <OptimizationCard summary={summary} running={false} onRun={() => undefined} />,
    );
    const winner = container.querySelector('[data-slot="optimization-cell"][data-winner="true"]');
    expect(winner?.textContent ?? "").toContain("1,200");
  });
});
