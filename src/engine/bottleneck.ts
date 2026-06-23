/**
 * Bottleneck identification with reason classification.
 *
 * Given each station's StateTimeTracker, returns a ranked list of bottleneck
 * candidates. The station with the HIGHEST time-in-Running is the constraint
 * — it's running the most because everyone else is waiting on it. For each
 * non-bottleneck station, the dominant non-Running state explains WHY it
 * isn't running more (the "reason").
 *
 * Reasons map to canonical labels:
 *   - Starved      → "starvation"
 *   - BlockedOut   → "blocking"
 *   - Down         → "breakdown"
 *   - Setup        → "setup"
 *   - Maintenance  → "maintenance"
 *   - Idle         → "idle"
 *   - Running      → "running" (never the primary reason — by definition,
 *                    the station is running. Surfaced for completeness.)
 *
 * AI auto-narration consumes these reasons to produce sentences like "Filler
 * is starving the Capper (33% of time-in-Starved upstream of Capper)."
 */

import type { StationId } from "./ids";
import type { StateTimeTracker } from "./state-time-tracker";

export type BottleneckReason =
  | "running"
  | "starvation"
  | "blocking"
  | "breakdown"
  | "setup"
  | "maintenance"
  | "idle";

export interface BottleneckCandidate {
  readonly stationId: StationId;
  /** Optional human label (e.g., "Filler", "Capper"). */
  readonly label?: string;
  /** Fraction of time the station was in Running state (0–1). */
  readonly runningPct: number;
  /** The dominant non-Running state, mapped to a reason label. */
  readonly primaryReason: BottleneckReason;
  /** Percentage of the run time spent in that primary-reason state (0–1). */
  readonly primaryReasonPct: number;
  /** Full state breakdown, sorted by percentage descending. */
  readonly breakdown: ReadonlyArray<{ state: string; pct: number }>;
  /**
   * VROL-900 — composite "binding score" = runningPct × nominalSpeedRatio.
   * Captures BOTH dimensions of bottleneck identification:
   *  - Utilization: how much of the window the station is busy
   *  - Performance: how close to OEM-rated max it's operating
   * For an unbalanced line (one station busy, others starved), this degenerates
   * to runningPct — same answer as the legacy ranking. For a balanced line
   * (everyone at 100% running), the at-nominal-max station wins on the
   * nominalSpeedRatio tiebreaker. Legacy callers without nominal data still
   * see ratio = 1.0 across the board, so behaviour is unchanged.
   */
  readonly bindingScore: number;
  /**
   * VROL-900 — nominal-to-operating ratio (1.0 when no nominal was provided).
   * Mirrors OeeMetrics.nominalSpeedRatio so the canvas can render the
   * subordination chip without a separate result lookup.
   */
  readonly nominalSpeedRatio: number;
}

function stateToReason(state: string): BottleneckReason {
  switch (state) {
    case "Running":
      return "running";
    case "Starved":
      return "starvation";
    case "BlockedOut":
      return "blocking";
    case "Down":
      return "breakdown";
    case "Setup":
      return "setup";
    case "Maintenance":
      return "maintenance";
    case "Idle":
      return "idle";
    default:
      return "idle";
  }
}

export function detectBottlenecks(
  stations: ReadonlyArray<{
    stationId: StationId;
    label?: string;
    tracker: StateTimeTracker;
    /**
     * VROL-900 — optional nominal/operating ratio (1.0 by default). When
     * the station's nominalCycleTimeMs was set, this is operatingMean /
     * nominalMean ... wait, ratio in OeeMetrics is nominal/operating, so
     * 1.0 = at max speed; < 1 = throttled.
     */
    nominalSpeedRatio?: number;
  }>,
): BottleneckCandidate[] {
  const candidates: BottleneckCandidate[] = stations.map(
    ({ stationId, label, tracker, nominalSpeedRatio }) => {
      const pcts = tracker.percentages();
      const runningPct = pcts.get("Running") ?? 0;
      const speedRatio = nominalSpeedRatio ?? 1;

      // Find dominant non-Running state.
      let primaryState = "Idle";
      let primaryPct = 0;
      for (const [state, pct] of pcts) {
        if (state === "Running") continue;
        if (pct > primaryPct) {
          primaryPct = pct;
          primaryState = state;
        }
      }

      const breakdown = [...pcts.entries()]
        .map(([state, pct]) => ({ state, pct }))
        .sort((a, b) => b.pct - a.pct);

      return {
        stationId,
        ...(label !== undefined ? { label } : {}),
        runningPct,
        primaryReason: stateToReason(primaryState),
        primaryReasonPct: primaryPct,
        breakdown,
        bindingScore: runningPct * speedRatio,
        nominalSpeedRatio: speedRatio,
      };
    },
  );

  // VROL-900 — sort by bindingScore DESC. Identical to legacy "sort by
  // runningPct DESC" when every station has nominalSpeedRatio = 1.0 (the
  // default for lines without nominal data). On a perfectly-balanced line
  // where all stations are at 100% running, the at-nominal-max station
  // surfaces as the primary bottleneck (Unilever shampoo-line case).
  candidates.sort((a, b) => b.bindingScore - a.bindingScore);
  return candidates;
}

/** Convenience: top N candidates ranked by bindingScore. */
export function topBottlenecks(
  stations: ReadonlyArray<{
    stationId: StationId;
    label?: string;
    tracker: StateTimeTracker;
    nominalSpeedRatio?: number;
  }>,
  n: number = 3,
): BottleneckCandidate[] {
  return detectBottlenecks(stations).slice(0, n);
}
