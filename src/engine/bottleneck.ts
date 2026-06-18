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
  }>,
): BottleneckCandidate[] {
  const candidates: BottleneckCandidate[] = stations.map(({ stationId, label, tracker }) => {
    const pcts = tracker.percentages();
    const runningPct = pcts.get("Running") ?? 0;

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
    };
  });

  // Sort by runningPct DESC — the busiest station is the bottleneck.
  candidates.sort((a, b) => b.runningPct - a.runningPct);
  return candidates;
}

/** Convenience: top N candidates ranked by runningPct. */
export function topBottlenecks(
  stations: ReadonlyArray<{
    stationId: StationId;
    label?: string;
    tracker: StateTimeTracker;
  }>,
  n: number = 3,
): BottleneckCandidate[] {
  return detectBottlenecks(stations).slice(0, n);
}
