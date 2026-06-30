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

  it("VROL-1050 — capacity-high-leverage fires when stationCapacity row has > 20% swing", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      topConstraintKind: "stationCapacity",
      topConstraintSwingPct: 95,
      topConstraintLabel: "Mid capacity (1 ↔ 2)",
    });
    expect(ids).toContain("capacity-high-leverage");
  });

  it("VROL-1050 — capacity-high-leverage hidden when swing is below threshold", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      topConstraintKind: "stationCapacity",
      topConstraintSwingPct: 15,
    });
    expect(ids).not.toContain("capacity-high-leverage");
  });

  it("VROL-1050 — capacity-high-leverage hidden when top constraint is a different kind", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      topConstraintKind: "bomQty",
      topConstraintSwingPct: 50,
    });
    expect(ids).not.toContain("capacity-high-leverage");
  });

  it("VROL-1057 — budget-infeasible fires when the flag is true after a run", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      goalMultiBudgetInfeasible: true,
    });
    expect(ids).toContain("budget-infeasible");
  });

  it("VROL-1057 — budget-infeasible hidden when the flag is false (budget met or unset)", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      goalMultiBudgetInfeasible: false,
    });
    expect(ids).not.toContain("budget-infeasible");
  });

  it("VROL-1057 — budget-infeasible hidden before any run, even with the flag set", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: false,
      goalMultiBudgetInfeasible: true,
    });
    expect(ids).not.toContain("budget-infeasible");
  });

  // ────────────────────────────────────────────────────────────────────────
  // VROL-1063 → VROL-1069 — new tips landed in Sprint 180.
  // Each tip has a positive (predicate fires) + a negative
  // (predicate doesn't fire) case.
  // ────────────────────────────────────────────────────────────────────────

  it("VROL-1063 — high-wip-warning fires when WIP > 3 × stations", () => {
    const ids = visibleIds({
      stationCount: 4,
      edgeCount: 3,
      hasRun: true,
      lineAverageWipL: 20, // 5 × stations
    });
    expect(ids).toContain("high-wip-warning");
  });

  it("VROL-1063 — high-wip-warning hidden when WIP is below the threshold", () => {
    const ids = visibleIds({
      stationCount: 4,
      edgeCount: 3,
      hasRun: true,
      lineAverageWipL: 8, // 2 × stations
    });
    expect(ids).not.toContain("high-wip-warning");
  });

  it("VROL-1064 — low-line-oee-warning fires when lineOee < 0.5", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineOee: 0.35,
    });
    expect(ids).toContain("low-line-oee-warning");
  });

  it("VROL-1064 — low-line-oee-warning hidden when lineOee >= 0.5", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineOee: 0.65,
    });
    expect(ids).not.toContain("low-line-oee-warning");
  });

  it("VROL-1065 — high-scrap-warning fires when scrap > 5 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineScrapRate: 0.08,
    });
    expect(ids).toContain("high-scrap-warning");
  });

  it("VROL-1065 — high-scrap-warning hidden when scrap is at or below 5 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineScrapRate: 0.04,
    });
    expect(ids).not.toContain("high-scrap-warning");
  });

  it("VROL-1066 — warmup-too-short fires when warmup is < 10 % of horizon", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      warmupFractionOfHorizon: 0.05,
    });
    expect(ids).toContain("warmup-too-short");
  });

  it("VROL-1066 — warmup-too-short hidden when warmup is at or above 10 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      warmupFractionOfHorizon: 0.2,
    });
    expect(ids).not.toContain("warmup-too-short");
  });

  it("VROL-1067 — stochastic-needs-replications fires when single-rep + stochastic", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      stochasticSingleRep: true,
    });
    expect(ids).toContain("stochastic-needs-replications");
  });

  it("VROL-1067 — stochastic-needs-replications hidden when the flag is false", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      stochasticSingleRep: false,
    });
    expect(ids).not.toContain("stochastic-needs-replications");
  });

  it("VROL-1068 — per-edge-buffer-saturated fires when peak fill > 95 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      maxBufferFillFraction: 0.98,
    });
    expect(ids).toContain("per-edge-buffer-saturated");
  });

  it("VROL-1068 — per-edge-buffer-saturated hidden when peak fill is below 95 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      maxBufferFillFraction: 0.6,
    });
    expect(ids).not.toContain("per-edge-buffer-saturated");
  });

  it("VROL-1069 — idle-source fires when source is idle > 50 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      sourceIdleFraction: 0.65,
    });
    expect(ids).toContain("idle-source");
  });

  it("VROL-1069 — idle-source hidden when source idle is at or below 50 %", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      sourceIdleFraction: 0.3,
    });
    expect(ids).not.toContain("idle-source");
  });

  // ────────────────────────────────────────────────────────────────────────
  // VROL-1158 (UX audit H4) — coach suppresses tips when action card
  // is already speaking on the same root signal.
  // ────────────────────────────────────────────────────────────────────────

  it("H4 — high-wip-warning suppressed when action card title mentions 'WIP'", () => {
    const ids = visibleIds({
      stationCount: 4,
      edgeCount: 3,
      hasRun: true,
      lineAverageWipL: 20,
      topActionCardTitle: "WIP averaging 20.0 parts",
    });
    expect(ids).not.toContain("high-wip-warning");
  });

  it("H4 — high-wip-warning still fires when action card is silent or unrelated", () => {
    const ids = visibleIds({
      stationCount: 4,
      edgeCount: 3,
      hasRun: true,
      lineAverageWipL: 20,
      topActionCardTitle: "Reliability is the biggest lever at Capper",
    });
    expect(ids).toContain("high-wip-warning");
  });

  it("H4 — low-line-oee-warning suppressed when action card mentions 'Line OEE'", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineOee: 0.3,
      topActionCardTitle: "Line OEE is 30 %",
    });
    expect(ids).not.toContain("low-line-oee-warning");
  });

  it("H4 — high-scrap-warning suppressed when action card mentions 'scrap'", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      lineScrapRate: 0.1,
      topActionCardTitle: "Scrap rate 10.0 %",
    });
    expect(ids).not.toContain("high-scrap-warning");
  });

  it("H4 — idle-source suppressed when action card says 'upstream-limited'", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      sourceIdleFraction: 0.7,
      topActionCardTitle: "Line is upstream-limited",
    });
    expect(ids).not.toContain("idle-source");
  });

  it("H4 — per-edge-buffer-saturated suppressed when action card mentions 'buffer'", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      maxBufferFillFraction: 0.99,
      topActionCardTitle: "Buffer 2 is sustained near full",
    });
    expect(ids).not.toContain("per-edge-buffer-saturated");
  });

  it("H4 — tune-the-bottleneck suppressed when action card mentions reliability/capacity/blocked", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: true,
      isBottleneckHigh: true,
      topActionCardTitle: "Reliability is the biggest lever at Capper",
    });
    expect(ids).not.toContain("tune-the-bottleneck");
  });

  it("H4 — pre-run tips (try-the-wizard, run-it) unaffected by action card title", () => {
    // Pre-run state with an action card title set anyway — pre-run
    // tips don't read it because they're gated on !hasRun.
    const ids = visibleIds({
      stationCount: 0,
      edgeCount: 0,
      hasRun: false,
      topActionCardTitle: "anything",
    });
    expect(ids).toContain("try-the-wizard");
  });

  it("VROL-1063→1069 — none of the new tips fire before a run", () => {
    const ids = visibleIds({
      stationCount: 3,
      edgeCount: 2,
      hasRun: false, // pre-run guard on every new tip
      lineAverageWipL: 100,
      lineOee: 0.1,
      lineScrapRate: 0.9,
      warmupFractionOfHorizon: 0.01,
      stochasticSingleRep: true,
      maxBufferFillFraction: 0.99,
      sourceIdleFraction: 0.99,
    });
    for (const id of [
      "high-wip-warning",
      "low-line-oee-warning",
      "high-scrap-warning",
      "warmup-too-short",
      "stochastic-needs-replications",
      "per-edge-buffer-saturated",
      "idle-source",
    ]) {
      expect(ids).not.toContain(id);
    }
  });
});
