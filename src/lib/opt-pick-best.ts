/**
 * VROL-1060 — CI-aware optimization picker. Extracted from
 * OptimizationCard.tsx so the logic can be unit-tested without driving
 * the card's Radix Select.
 *
 * When the leader and a runner-up have overlapping 95 % CIs on the
 * active objective's stat, prefer the candidate whose CI gives the
 * stronger guarantee in the objective's direction:
 *   max-direction → higher LOWER bound (robust floor)
 *   min-direction → lower UPPER bound (robust ceiling)
 *
 * Walking stops the first time a candidate's CI no longer overlaps
 * the leader's — anything past that is statistically clear of the
 * leader and the runner-up's mean wouldn't beat it on robustness.
 *
 * Stats with halfWidth=0 (reps=1 or a metric that didn't vary
 * across reps) fall back to plain mean ordering.
 */
import type { OptimizationCandidate, Stats } from "./optimization-search";

export type ObjectiveDirection = "max" | "min";

export interface PickerObjective {
  readonly direction: ObjectiveDirection;
  readonly extract: (c: OptimizationCandidate) => number;
  readonly stats: (c: OptimizationCandidate) => Stats;
}

export interface PickerResult {
  readonly winner: OptimizationCandidate;
  readonly fromFeasible: boolean;
}

export function pickBest(
  candidates: readonly OptimizationCandidate[],
  objective: PickerObjective,
  feasibleSet: ReadonlySet<OptimizationCandidate>,
): PickerResult {
  const pool = candidates.filter((c) => feasibleSet.has(c));
  const fromFeasible = pool.length > 0;
  const sortPool = fromFeasible ? pool : [...candidates];
  const sorted = [...sortPool].sort((a, b) => {
    const av = objective.extract(a);
    const bv = objective.extract(b);
    return objective.direction === "max" ? bv - av : av - bv;
  });
  let winner = sorted[0] ?? candidates[0]!;
  if (sorted.length > 1) {
    const winnerStats = objective.stats(winner);
    if (winnerStats.halfWidth95 > 0) {
      for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i]!;
        const nextStats = objective.stats(next);
        if (nextStats.halfWidth95 <= 0) break;
        const lead = objective.stats(winner);
        if (objective.direction === "max") {
          if (nextStats.high95 < lead.low95) break;
          if (nextStats.low95 > lead.low95) winner = next;
        } else {
          if (nextStats.low95 > lead.high95) break;
          if (nextStats.high95 < lead.high95) winner = next;
        }
      }
    }
  }
  return { winner, fromFeasible };
}
