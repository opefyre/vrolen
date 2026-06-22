/**
 * VROL-842 — Pareto frontier for optimization candidates.
 *
 * A candidate A "dominates" B when A is at least as good as B on BOTH axes
 * and strictly better on at least one. The frontier is the set of candidates
 * that no other candidate dominates — the "you can't improve one objective
 * without sacrificing the other" points.
 *
 * For this card the axes are:
 *   • throughput per hour — maximize
 *   • mean time-in-system  — minimize
 *
 * Complexity is O(n²) which is fine: even a 10×10 sweep over 5 reps is
 * 100 candidates → 10k comparisons, all primitive number ops.
 */

import type { OptimizationCandidate } from "@/lib/optimization-search";

/**
 * Filter a candidate list down to its Pareto frontier with throughput as the
 * "more is better" axis and time-in-system as the "less is better" axis.
 *
 * Returns a new array — input order is preserved for the surviving entries
 * so the caller can iterate without an additional sort.
 */
export function paretoFrontier(
  candidates: readonly OptimizationCandidate[],
): readonly OptimizationCandidate[] {
  if (candidates.length === 0) return [];
  const dominators: OptimizationCandidate[] = [];
  for (const a of candidates) {
    let dominated = false;
    for (const b of candidates) {
      if (a === b) continue;
      // b dominates a iff b is >= a on throughput AND b is <= a on TIS,
      // with at least one inequality strict.
      const bAtLeastAsGoodTput = b.meanThroughputPerHour >= a.meanThroughputPerHour;
      const bAtLeastAsGoodTis = b.meanTimeInSystemMs <= a.meanTimeInSystemMs;
      if (!bAtLeastAsGoodTput || !bAtLeastAsGoodTis) continue;
      const strictlyBetter =
        b.meanThroughputPerHour > a.meanThroughputPerHour ||
        b.meanTimeInSystemMs < a.meanTimeInSystemMs;
      if (strictlyBetter) {
        dominated = true;
        break;
      }
    }
    if (!dominated) dominators.push(a);
  }
  return dominators;
}

/**
 * Set membership helper — given a candidate and a precomputed frontier,
 * decide whether the candidate is on the frontier. Uses reference equality
 * since the frontier elements come straight out of {@link paretoFrontier}.
 */
export function isOnFrontier(
  candidate: OptimizationCandidate,
  frontier: readonly OptimizationCandidate[],
): boolean {
  for (const f of frontier) {
    if (f === candidate) return true;
  }
  return false;
}
