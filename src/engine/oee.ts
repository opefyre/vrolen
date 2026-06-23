/**
 * Overall Equipment Effectiveness (OEE) + the canonical sub-metrics.
 *
 * OEE = Availability × Performance × Quality.
 *
 * Definitions used here match the project spec (see VROL-138, VROL-897):
 *   Availability = runTime / (runTime + downTime)
 *     where downTime counts ONLY unplanned downtime (breakdowns), NOT
 *     planned maintenance, not setup, not idle. Starvation and blocking
 *     are also excluded — they're external constraints, not a station's
 *     own unavailability. A station with zero breakdowns is 100% available
 *     even if it spent the whole window starved or blocked (Performance
 *     is the lever that drops in that case — see below).
 *   Performance = (idealCycleTime × goodPartCount) / runTime
 *     Caps at 1.0 — a faster-than-ideal run would imply the "ideal" was
 *     wrong; we clamp rather than report >100% Performance.
 *   Quality = goodPartCount / totalPartCount
 *     totalPartCount = good + defective.
 *
 * Phase 0 scope: per-station OEE only. Line / site rollups land alongside
 * a real line/site model in a later sprint (subtasks VROL-140/142 remain
 * open as follow-ups; this story closes the per-station calculator +
 * canonical textbook validation).
 */

import type { StateTimeTracker } from "./state-time-tracker";

export interface OeeMetrics {
  /** runTime / (runTime + downTime). 0–1. */
  readonly availability: number;
  /** (idealCycleTime × goodParts) / runTime, clamped to [0, 1]. */
  readonly performance: number;
  /** goodParts / totalParts. 0–1. NaN-safe: returns 1 when totalParts = 0. */
  readonly quality: number;
  /** A × P × Q. 0–1. */
  readonly oee: number;
  /** Run time used in the calc — ms in the "Running" state. */
  readonly runTimeMs: number;
  /** Down time used in the calc — ms in the "Down" state. */
  readonly downTimeMs: number;
  /** Good part count fed into Performance + Quality. */
  readonly goodParts: number;
  /** Total part count (good + defective). */
  readonly totalParts: number;
  /** Ideal cycle time (ms) — analytical mean of the station's cycle distribution. */
  readonly idealCycleTimeMs: number;
}

export interface OeeInputs {
  /** Time-in-state accumulator. Caller is responsible for finalize() before this is read. */
  readonly stateTimeTracker: StateTimeTracker;
  /** Mean cycle time, ms. Use distribution.meanOf() to derive. */
  readonly idealCycleTimeMs: number;
  /** Parts the station produced AND pushed downstream (i.e., not scrapped). */
  readonly goodParts: number;
  /** Total parts the station finished a cycle on — good + defective. */
  readonly totalParts: number;
}

/**
 * Compute OEE for a single station from its time-in-state breakdown and part
 * counts. The state-time tracker MUST already be finalized to the end of the
 * measurement window; this function does not advance simulated time.
 */
export function computeOee(inputs: OeeInputs): OeeMetrics {
  const runTimeMs = inputs.stateTimeTracker.timeInState("Running");
  const downTimeMs = inputs.stateTimeTracker.timeInState("Down");
  const loadingTimeMs = runTimeMs + downTimeMs;

  // VROL-897 — when loadingTime = 0 (zero Running AND zero Down), the station
  // experienced no unplanned downtime, so Availability is 1.0 by textbook
  // semantics. The previous "return 0" pinned a starvation-only / blocking-only
  // station to Availability 0%, which conflated "didn't run" with "broke down."
  // The Performance lever still drops to 0 (no goodParts), so OEE = 0 either
  // way — but the breakdown panel now correctly attributes that 0% to
  // Performance (i.e., external starvation/blocking) instead of Availability.
  const availability = loadingTimeMs > 0 ? runTimeMs / loadingTimeMs : 1;
  const rawPerformance =
    runTimeMs > 0 ? (inputs.idealCycleTimeMs * inputs.goodParts) / runTimeMs : 0;
  const performance = Math.min(1, Math.max(0, rawPerformance));
  const quality = inputs.totalParts > 0 ? inputs.goodParts / inputs.totalParts : 1;
  const oee = availability * performance * quality;

  return {
    availability,
    performance,
    quality,
    oee,
    runTimeMs,
    downTimeMs,
    goodParts: inputs.goodParts,
    totalParts: inputs.totalParts,
    idealCycleTimeMs: inputs.idealCycleTimeMs,
  };
}
