/**
 * VROL-793 — tornado bar tone classification.
 *
 * The Sensitivity card paints each tornado bar with a divergent colour
 * scale so the reader can tell at a glance whether speeding the station
 * UP helps throughput (green) or hurts it (red). Bars whose swing is
 * below the noise floor render in muted grey so the reader can ignore
 * them — they're not statistically meaningful for this run.
 *
 *   - "positive": speeding the station up (low multiplier) increases
 *     throughput. Bar uses the sim-running family.
 *   - "negative": slowing the station down (high multiplier) increases
 *     throughput (rare — typically a synchronisation / starvation flip).
 *     Bar uses sim-down.
 *   - "noise": swing is below the noise floor. Bar uses muted grey.
 *
 * Lives in its own module so the React component can import it without
 * tripping the react-refresh "only-export-components" rule.
 */

import type { SensitivityRow } from "./sensitivity-sweep";

export type TornadoBarTone = "positive" | "negative" | "noise";

/** Below this fraction of the widest bar, treat as noise. */
export const NOISE_FLOOR_PCT_OF_MAX = 0.01; // 1% of the widest bar
/** Below this absolute parts/h, treat as noise even if it's the widest. */
export const NOISE_FLOOR_ABS_PER_HOUR = 5; // 5 parts/h absolute floor

export function classifyTornadoRow(row: SensitivityRow, maxSwingPerHour: number): TornadoBarTone {
  // VROL-1062 — when the sweep ran ≥ 2 reps we have a real 95 % CI on
  // the swing. Use the statistical significance flag as the noise
  // gate — far more rigorous than the swing-vs-floor heuristic
  // below. The flag is true when the CI excludes zero (the swing is
  // statistically distinguishable from no effect).
  if (row.swingStats.halfWidth95 > 0) {
    if (!row.isSignificant) return "noise";
    return row.lowPerHour >= row.highPerHour ? "positive" : "negative";
  }
  // K=1 (no CI to test against) — fall back to the swing-vs-floor
  // heuristics. Captures the "single rep, swing barely moved"
  // scenario when the user hasn't opted into replications.
  const belowRelFloor =
    maxSwingPerHour > 0 && row.swingPerHour < maxSwingPerHour * NOISE_FLOOR_PCT_OF_MAX;
  const belowAbsFloor = row.swingPerHour < NOISE_FLOOR_ABS_PER_HOUR;
  if (belowRelFloor || belowAbsFloor) return "noise";
  // Speeding up (low multiplier → low cycle → lowPerHour higher) helps throughput.
  return row.lowPerHour >= row.highPerHour ? "positive" : "negative";
}
