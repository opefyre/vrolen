/**
 * VROL-1030 — verify the buildCoachTips visibility logic. Until now
 * the tips list was data-only with no direct tests; the new
 * save-as-scenario tip is a good moment to land a coverage file.
 */
import { describe, expect, it, vi } from "vitest";

import { buildCoachTips, type CoachTipDeps } from "./coach-tips";

const baseDeps: CoachTipDeps = {
  stationCount: 0,
  edgeCount: 0,
  hasRun: false,
  isBottleneckHigh: false,
  lockedNodeCount: 0,
};

function visibleIds(deps: Partial<CoachTipDeps> = {}, saveScenario?: () => void): string[] {
  const tips = buildCoachTips(
    { ...baseDeps, ...deps },
    { runNow: vi.fn(), ...(saveScenario ? { saveScenario } : {}) },
  );
  return tips.filter((t) => t.whenVisible()).map((t) => t.id);
}

describe("buildCoachTips visibility", () => {
  it("empty canvas → only the try-the-wizard tip is visible", () => {
    expect(visibleIds()).toEqual(["try-the-wizard"]);
  });

  it("stations but no edges → connect-the-graph fires", () => {
    expect(visibleIds({ stationCount: 3, edgeCount: 0 })).toContain("connect-the-graph");
  });

  it("VROL-1030 — save-as-scenario fires after a run with no active scenario", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      activeScenarioName: null,
    });
    expect(ids).toContain("save-as-scenario");
  });

  it("VROL-1030 — save-as-scenario hidden once a scenario name is set", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      activeScenarioName: "My line",
    });
    expect(ids).not.toContain("save-as-scenario");
  });

  it("VROL-1030 — save tip carries the action when saveScenario callback is provided", () => {
    const cb = vi.fn();
    const tips = buildCoachTips(
      { ...baseDeps, stationCount: 3, edgeCount: 2, hasRun: true, activeScenarioName: null },
      { runNow: vi.fn(), saveScenario: cb },
    );
    const tip = tips.find((t) => t.id === "save-as-scenario");
    expect(tip?.action?.label).toBe("Save");
    tip?.action?.onClick();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
