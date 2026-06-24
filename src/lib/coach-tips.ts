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
}

export interface CoachTipCallbacks {
  /** Invoked by the "Run now" CTA on the `run-it` tip. */
  readonly runNow: () => void;
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
  ];
}
