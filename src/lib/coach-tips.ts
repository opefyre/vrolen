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
  ];
}
