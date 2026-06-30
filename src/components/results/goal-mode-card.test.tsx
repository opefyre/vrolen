/**
 * VROL-1058 — verify the multi-lever result block renders the
 * achieved energy intensity + budget badge.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MultiResult } from "@/lib/goal-mode-multi";

import { GoalModeCard } from "./goal-mode-card";

function makeMultiResult(over: Partial<MultiResult["best"] & object> = {}): MultiResult {
  return {
    baselinePerHour: 1_000,
    candidates: [],
    searchSize: 1,
    elapsedMs: 5,
    best: {
      cycleMultiplier: 0.75,
      bufferDelta: 5,
      toolPoolDelta: 0,
      capacityDelta: 0,
      perHour: 1_500,
      cost: 3.5,
      meetsTarget: true,
      meanEnergyIntensityJPerPart: 250,
      meetsEnergyBudget: true,
      ...over,
    },
  } as unknown as MultiResult;
}

describe("GoalModeCard multi-lever block (VROL-1058)", () => {
  it("renders intensity + green ✓ when the best combo meets the budget", () => {
    render(
      <GoalModeCard
        baselinePerHour={1_000}
        running={false}
        onRun={() => undefined}
        onApply={() => undefined}
        result={null}
        multiResult={makeMultiResult()}
      />,
    );
    expect(screen.getByTestId("goal-mode-multi-intensity")).toBeTruthy();
    expect(screen.getByTestId("goal-mode-multi-intensity").textContent).toContain("250 J/part");
    expect(screen.getByTestId("goal-mode-multi-budget-ok")).toBeTruthy();
  });

  it("renders red × badge when the best combo violates the budget", () => {
    const multi = makeMultiResult({ meetsEnergyBudget: false });
    render(
      <GoalModeCard
        baselinePerHour={1_000}
        running={false}
        onRun={() => undefined}
        onApply={() => undefined}
        result={null}
        multiResult={multi}
      />,
    );
    expect(screen.getByTestId("goal-mode-multi-budget-over")).toBeTruthy();
  });

  it("omits the intensity figure when no station declared sustainability", () => {
    const multi = makeMultiResult({ meanEnergyIntensityJPerPart: 0 });
    render(
      <GoalModeCard
        baselinePerHour={1_000}
        running={false}
        onRun={() => undefined}
        onApply={() => undefined}
        result={null}
        multiResult={multi}
      />,
    );
    expect(screen.queryByTestId("goal-mode-multi-intensity")).toBeNull();
  });
});
