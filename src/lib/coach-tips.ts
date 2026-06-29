/**
 * Coach-tip definitions (VROL-819).
 *
 * Tips are pure data — each returns a boolean `whenVisible()` over a small
 * snapshot of editor state. Adding a tip is a 4-line change here; trigger
 * logic stays out of the component file so the renderer remains dumb.
 *
 * Tip selection: the Coach component renders the FIRST visible
 * (non-dismissed) tip. Ordering below is the priority order — the empty
 * canvas hint outranks "run it" outranks "tune the bottleneck", so a
 * fresh canvas never accidentally shows a downstream tip.
 */

import type { CoachTip } from "@/components/editor/coach";

export interface CoachTipDeps {
  readonly stationCount: number;
  readonly edgeCount: number;
  readonly hasRun: boolean;
  readonly isBottleneckHigh: boolean;
  readonly lockedNodeCount: number;
  /** VROL-963 — Sprint 90/91 constraint signals from the last finished run. */
  readonly totalBomStarved?: number;
  readonly toolBlockedFraction?: number;
  readonly totalSkuRouted?: number;
  /**
   * VROL-1030 — name of the active scenario, or null when the user is
   * working on an unsaved draft. Used to suggest saving so the
   * run-history strip becomes useful.
   */
  readonly activeScenarioName?: string | null;
  /**
   * VROL-1050 — top constraint row from the most recent sensitivity
   * sweep, when one ran. Lets the coach surface "capacity is the
   * lever" when stationCapacity dominates the constraint axis.
   */
  readonly topConstraintKind?: string;
  readonly topConstraintSwingPct?: number;
  readonly topConstraintLabel?: string;
}

export interface CoachTipCallbacks {
  /** Invoked by the "Run now" CTA on the `run-it` tip. */
  readonly runNow: () => void;
  /** VROL-1030 — Optional save-scenario opener. */
  readonly saveScenario?: () => void;
}

export function buildCoachTips(deps: CoachTipDeps, callbacks: CoachTipCallbacks): CoachTip[] {
  const { stationCount, edgeCount, hasRun, isBottleneckHigh } = deps;

  return [
    {
      id: "try-the-wizard",
      title: "Start with a guided setup",
      body: "The canvas is empty. Try the scenario wizard or drag a station from the palette to begin.",
      whenVisible: () => stationCount === 0 && !hasRun,
    },
    {
      id: "connect-the-graph",
      title: "Connect your stations",
      body: "Drag from one station's right port to the next station's left port so parts can flow downstream.",
      whenVisible: () => stationCount >= 2 && edgeCount === 0,
    },
    {
      id: "run-it",
      title: "Run the simulation",
      body: "Your line is wired up. Press Run to see throughput, WIP, and bottlenecks for this scenario.",
      whenVisible: () => stationCount >= 2 && edgeCount >= 1 && !hasRun,
      action: {
        label: "Run now",
        onClick: callbacks.runNow,
      },
    },
    {
      id: "tune-the-bottleneck",
      title: "Tune the bottleneck",
      body: "The bottleneck station is starving or blocking more than 20% of the run. Open Inspector on it to adjust capacity or cycle time.",
      whenVisible: () => hasRun && isBottleneckHigh,
    },
    // VROL-963 — Sprint 90/91 constraint anomalies. Each triggers only
    // after a run AND when the matching counter exceeds a sane threshold.
    {
      id: "bom-imbalance",
      title: "BOM lanes are choking the line",
      body: "More than 50 BOM-starved events this run. Open the inspector → Constraints on the assembly station and either lower qtyPerCycle or grow the feeder lane upstream.",
      whenVisible: () => hasRun && (deps.totalBomStarved ?? 0) > 50,
    },
    {
      id: "tool-pool-contention",
      title: "Tool pool is serialising the line",
      body: "Shared tool-pool wait dominated this run. Raise the pool capacity in Run Settings → Tool pools, or split the stations that compete for it.",
      whenVisible: () => hasRun && (deps.toolBlockedFraction ?? 0) > 0.3,
    },
    {
      id: "sku-routed-info",
      title: "Per-SKU routing fired",
      body: "Some parts followed the perSkuRouting overrides you configured. Check the SKU-routed counter in OEE breakdown or the drilldown Constraints tab to confirm the split looks right.",
      whenVisible: () => hasRun && (deps.totalSkuRouted ?? 0) > 0,
    },
    // VROL-1050 — sensitivity revealed capacity as the dominant
    // constraint lever. Fires only after a run when the most recent
    // sensitivity sweep's top constraint row is stationCapacity with
    // > 20 % swing.
    {
      id: "capacity-high-leverage",
      title: "Capacity is the lever",
      body: `Sensitivity sweep shows ${deps.topConstraintLabel ?? "station capacity"} swings throughput by ${(deps.topConstraintSwingPct ?? 0).toFixed(0)} %. Adding a parallel server on that station is your highest-leverage move — try the capacity:set apply on the action card or bump it directly in the inspector.`,
      whenVisible: () =>
        hasRun &&
        deps.topConstraintKind === "stationCapacity" &&
        (deps.topConstraintSwingPct ?? 0) > 20,
    },
    // VROL-1030 — fires after a run when nothing's been saved yet.
    // Save unlocks the run-history strip + the run-history → compare
    // shortcut, so it's the lever for "what changed between runs".
    {
      id: "save-as-scenario",
      title: "Save this as a scenario",
      body: "You've run the simulation but haven't saved the draft. Save it as a scenario so the last-5-runs strip starts tracking changes — useful for spotting deltas as you iterate.",
      whenVisible: () =>
        hasRun &&
        stationCount >= 2 &&
        (deps.activeScenarioName === null || deps.activeScenarioName === undefined),
      ...(callbacks.saveScenario
        ? { action: { label: "Save", onClick: callbacks.saveScenario } }
        : {}),
    },
  ];
}
