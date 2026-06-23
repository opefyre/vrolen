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
 *   Performance = (referenceCycleTime × goodPartCount) / runTime
 *     Caps at 1.0 — a faster-than-reference run would imply the reference
 *     was wrong; we clamp rather than report >100% Performance.
 *     VROL-899 — referenceCycleTime defaults to idealCycleTime (the
 *     analytical mean of the station's cycle distribution). When the
 *     caller passes a nominalCycleTimeMs (the OEM's design max), Performance
 *     is computed against THAT instead, so a deliberately throttled station
 *     reports Performance < 1.0 (subordination is visible).
 *   Quality = goodPartCount / totalPartCount
 *     totalPartCount = good + defective.
 */

import type { StateTimeTracker } from "./state-time-tracker";

export interface OeeMetrics {
  /** runTime / (runTime + downTime). 0–1. */
  readonly availability: number;
  /** (referenceCycleTime × goodParts) / runTime, clamped to [0, 1]. */
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
  /**
   * VROL-899 — nominal-to-operating speed ratio. 1.0 means the station is
   * operating at its OEM-rated max (or no nominal was provided, falling back
   * to operating mean). < 1.0 means the operating distribution is slower than
   * nominal — the station is deliberately throttled (subordinated to the
   * bottleneck or run below max to extend MTBF). Drives the canvas
   * subordination chip and the composite bottleneck-ranking score
   * (VROL-900, VROL-901).
   */
  readonly nominalSpeedRatio: number;
}

export interface OeeInputs {
  /** Time-in-state accumulator. Caller is responsible for finalize() before this is read. */
  readonly stateTimeTracker: StateTimeTracker;
  /** Mean cycle time, ms. Use distribution.meanOf() to derive. */
  readonly idealCycleTimeMs: number;
  /**
   * VROL-899 — OEM-rated design max cycle time, ms (the machine's nominal
   * speed). When provided, Performance is computed against THIS instead of
   * the operating distribution mean — so a deliberately throttled station
   * reports Performance < 1.0 (subordination visible). When undefined,
   * idealCycleTimeMs is used (legacy behaviour, Performance ≈ 1.0 for a
   * deterministic station).
   */
  readonly nominalCycleTimeMs?: number;
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
  // VROL-899 — Performance is the (good × reference) / runTime ratio. The
  // reference is nominalCycleTimeMs when provided (OEM design max) so
  // throttled stations surface as Performance < 1.0; otherwise the operating
  // ideal cycle (legacy behaviour, Performance ≈ 1.0 for deterministic runs).
  const referenceCycleMs = inputs.nominalCycleTimeMs ?? inputs.idealCycleTimeMs;
  const rawPerformance = runTimeMs > 0 ? (referenceCycleMs * inputs.goodParts) / runTimeMs : 0;
  const performance = Math.min(1, Math.max(0, rawPerformance));
  const quality = inputs.totalParts > 0 ? inputs.goodParts / inputs.totalParts : 1;
  const oee = availability * performance * quality;
  // VROL-899 — nominal/operating ratio is a static property of the station's
  // distribution + nominal pair, NOT of the run. A 100ms-nominal station with
  // a 150ms operating mean has ratio 0.667 regardless of how often it ran.
  // 1.0 when no nominal is set (engine assumes operating == nominal).
  const nominalSpeedRatio =
    inputs.nominalCycleTimeMs && inputs.idealCycleTimeMs > 0
      ? Math.min(1, Math.max(0, inputs.nominalCycleTimeMs / inputs.idealCycleTimeMs))
      : 1;

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
    nominalSpeedRatio,
  };
}
