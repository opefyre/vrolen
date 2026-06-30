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
  /**
   * VROL-1057 — multi-lever goal mode found NO candidate that meets
   * both the throughput target AND the energy budget; the picker
   * fell back to throughput-only. Caller derives from
   * multiResult.best.meetsEnergyBudget && a budget was set.
   */
  readonly goalMultiBudgetInfeasible?: boolean;
  /**
   * VROL-1063 — last-run line-wide average WIP (parts in inter-station
   * buffers). When much larger than the station count it signals
   * pile-up (buffers swelling, downstream not pulling fast enough).
   */
  readonly lineAverageWipL?: number;
  /**
   * VROL-1064 — last-run line OEE (Availability × Performance × Quality),
   * clamped 0..1. Below 0.5 suggests a structural issue worth a
   * breakdown investigation rather than just bottleneck tuning.
   */
  readonly lineOee?: number;
  /**
   * VROL-1065 — last-run line scrap rate, clamped 0..1. Above 5 %
   * suggests defect-root-cause investigation; below that it's noise.
   */
  readonly lineScrapRate?: number;
  /**
   * VROL-1066 — warmup-as-fraction-of-horizon on the last run. Below
   * 10 % means the engine had barely any time to reach steady state
   * before measurements started.
   */
  readonly warmupFractionOfHorizon?: number;
  /**
   * VROL-1067 — true when at least one station's cycle distribution
   * is non-deterministic (not "constant") AND the last run used
   * replications=1. Replications would let the user see the
   * variance, not just the single-rep mean.
   */
  readonly stochasticSingleRep?: boolean;
  /**
   * VROL-1068 — peak per-edge buffer fill fraction across the last
   * run, 0..1. When > 0.95 (buffer regularly hits its cap), a
   * per-edge bufferCapacity override (S178) is the precise lever
   * rather than raising the global buffer.
   */
  readonly maxBufferFillFraction?: number;
  /**
   * VROL-1069 — source station's idle-state fraction over the last
   * run, 0..1. Above 0.5 means the line was upstream-limited (the
   * source isn't producing fast enough) — different fix than a
   * downstream bottleneck.
   */
  readonly sourceIdleFraction?: number;
  /**
   * VROL-1158 (UX audit H4) — title of the top-priority action card,
   * when one fired. Coach uses this to suppress its own tip whose
   * root signal already drove the action card, so the user doesn't
   * see two surfaces giving the same diagnosis. Pre-run + scenario-
   * management tips are unaffected.
   */
  readonly topActionCardTitle?: string;
}

export interface CoachTipCallbacks {
  /** Invoked by the "Run now" CTA on the `run-it` tip. */
  readonly runNow: () => void;
  /** VROL-1030 — Optional save-scenario opener. */
  readonly saveScenario?: () => void;
}

/**
 * VROL-1158 (UX audit H4) — does the active action card's title
 * already describe the same root signal? Keywords are lowercase
 * substrings; any match suppresses the coach's redundant tip.
 */
function actionCardCoversSignal(title: string | undefined, keywords: readonly string[]): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return keywords.some((k) => lower.includes(k));
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
      whenVisible: () =>
        hasRun &&
        isBottleneckHigh &&
        // VROL-1158 — suppress when the action card already speaks for
        // the bottleneck (reliability / capacity / cycle / blocked).
        !actionCardCoversSignal(deps.topActionCardTitle, [
          "reliability",
          "speed up",
          "blocked",
          "capacity",
          "second",
          "third",
        ]),
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
    // VROL-1057 — multi-lever goal mode couldn't find a combo that
    // honoured the energy budget. The picker fell back to the
    // throughput-only winner; the user needs to know the ceiling was
    // violated so they can relax it or accept the trade-off.
    {
      id: "budget-infeasible",
      title: "No combo fits within that energy budget",
      body: "The multi-lever picker tried every (cycle × buffer × tool × capacity) combo and none hit your throughput target while staying inside the energy / part ceiling. The 'best' chip is the cheapest throughput-only winner — its energy intensity is above your budget. Two options: relax the budget, or accept this energy hit as the cost of hitting the throughput target.",
      whenVisible: () => hasRun && deps.goalMultiBudgetInfeasible === true,
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
    // VROL-1063 — WIP pile-up. Threshold 3 × stationCount captures
    // "more parts queued than the line could turn over even once" —
    // a rough but reliable signal that buffers are swelling.
    {
      id: "high-wip-warning",
      title: "WIP is piling up",
      body: `Average WIP is ${(deps.lineAverageWipL ?? 0).toFixed(1)} parts across ${String(stationCount)} stations — buffers are swelling because downstream isn't pulling fast enough. Tighten a downstream buffer cap or open the bottleneck before adding more cycle.`,
      whenVisible: () =>
        hasRun &&
        stationCount > 0 &&
        (deps.lineAverageWipL ?? 0) > 3 * stationCount &&
        // VROL-1158 — action card "WIP averaging X parts" rule
        // already speaks for this signal.
        !actionCardCoversSignal(deps.topActionCardTitle, ["wip"]),
    },
    // VROL-1064 — line OEE below 0.5 is "something is structurally
    // wrong" not "tune a station." Direct the user at the OEE
    // breakdown so they isolate Availability vs Performance vs
    // Quality before chasing cycle time.
    {
      id: "low-line-oee-warning",
      title: "Line OEE is below 50 %",
      body: `Line OEE is ${((deps.lineOee ?? 0) * 100).toFixed(0)} %. Open the OEE breakdown card to see which factor — Availability (breakdowns / maintenance), Performance (slow cycles, micro-stops), or Quality (scrap) — is the slim one before chasing cycle time changes.`,
      whenVisible: () =>
        hasRun &&
        (deps.lineOee ?? 1) < 0.5 &&
        // VROL-1158 — action card "Line OEE is X %" rule already
        // speaks for this signal.
        !actionCardCoversSignal(deps.topActionCardTitle, ["line oee", "slim factor"]),
    },
    // VROL-1065 — scrap above 5 % means the line is producing waste
    // at a rate that almost always swamps cycle-time gains. Surface
    // the defect-root-cause path before optimization.
    {
      id: "high-scrap-warning",
      title: "Scrap rate is above 5 %",
      body: `Line scrap rate is ${((deps.lineScrapRate ?? 0) * 100).toFixed(1)} %. At this level, defect root-cause work outpaces cycle tuning — open per-station Inspector → Defects to see which station drives the loss.`,
      whenVisible: () =>
        hasRun &&
        (deps.lineScrapRate ?? 0) > 0.05 &&
        // VROL-1158 — action card "Scrap rate X %" rule already
        // speaks for this signal.
        !actionCardCoversSignal(deps.topActionCardTitle, ["scrap"]),
    },
    // VROL-1066 — warmup < 10 % of horizon. The engine's
    // measurement window starts AFTER warmupMs; setting it too short
    // means the steady-state hasn't formed and the throughput /
    // WIP figures still carry the startup transient.
    {
      id: "warmup-too-short",
      title: "Warmup may be too short",
      body: `Warmup is ${((deps.warmupFractionOfHorizon ?? 0) * 100).toFixed(0)} % of the horizon — the run is measuring startup transients alongside steady state. Raise warmupMs to ~20 % of horizon (or extend the horizon) so the early WIP build-up doesn't bias the numbers.`,
      whenVisible: () => hasRun && (deps.warmupFractionOfHorizon ?? 1) < 0.1,
    },
    // VROL-1067 — single-rep on stochastic input hides the variance.
    // Each rep would sample a different cycle-time draw; without
    // replications the user is reading one realisation as if it's
    // the truth.
    {
      id: "stochastic-needs-replications",
      title: "Enable replications for stochastic inputs",
      body: "At least one station has a non-deterministic cycle distribution, but this run used a single replication. The throughput figure above is one realisation; with replications=3+ you'll see the 95 % CI on the mean. Open Run Settings → Replications.",
      whenVisible: () => hasRun && deps.stochasticSingleRep === true,
    },
    // VROL-1068 — per-edge buffer is hitting its cap > 95 % of the
    // time. Suggest the per-edge bufferCapacity field (S178) as the
    // precise lever, not raising the global buffer cap line-wide.
    {
      id: "per-edge-buffer-saturated",
      title: "A buffer is hitting its cap",
      body: `Peak buffer fill on at least one edge sat at ${((deps.maxBufferFillFraction ?? 0) * 100).toFixed(0)} % of capacity. Raising the global buffer affects every edge; the per-edge bufferCapacity field (set on the edge directly in JSON) is the precise lever.`,
      whenVisible: () =>
        hasRun &&
        (deps.maxBufferFillFraction ?? 0) > 0.95 &&
        // VROL-1158 — action card "Buffer X is sustained near full"
        // OR "Buffer on edge X is saturating" both speak for this.
        !actionCardCoversSignal(deps.topActionCardTitle, ["buffer"]),
    },
    // VROL-1069 — source idle > 50 % means the line is UPSTREAM-
    // limited (the source can't keep up with the downstream's
    // appetite), not bottleneck-limited. Different fix: speed up
    // the source, not the slowest mid-chain station.
    {
      id: "idle-source",
      title: "Line is upstream-limited",
      body: `The source station is idle ${((deps.sourceIdleFraction ?? 0) * 100).toFixed(0)} % of the time — the downstream is starving on supply, not blocked by a slow mid-chain station. Speed up the source's cycle or raise its capacity before chasing bottlenecks downstream.`,
      whenVisible: () =>
        hasRun &&
        (deps.sourceIdleFraction ?? 0) > 0.5 &&
        // VROL-1158 — action card "Line is upstream-limited" already
        // speaks for this signal.
        !actionCardCoversSignal(deps.topActionCardTitle, ["upstream-limited"]),
    },
  ];
}
