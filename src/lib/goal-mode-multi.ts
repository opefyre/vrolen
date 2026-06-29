/**
 * VROL-993 — multi-lever goal-seek. Sprint 97 (goal-mode.ts) searches
 * over uniform cycle-time multipliers only. The audit's ROI #10 critique
 * applies: one-lever search misses the cheaper combo. This adds buffer
 * and tool-pool capacity as additional levers.
 *
 * Search shape: nested mini-grid over (cycle × buffer × tool-pool).
 *   cycle ∈ {0.5, 0.75, 1.0}    — uniform multiplier on every station
 *   buffer ∈ {+0, +5, +10}      — additive on interStationBufferCapacity
 *   tool ∈ {+0, +1}             — additive on every named pool's capacity
 *
 * Total = 3 × 3 × 2 = 18 candidates. Each runs one seed; results cached.
 * Returns the lowest-cost candidate that meets the target.
 *
 * Cost shape (knobs deliberately not user-tunable in v1):
 *   cost = α·|1 − cycleM| + β·bufferDelta + γ·toolPoolDelta
 *   α = 10  (cycle changes are expensive — buy faster equipment)
 *   β = 1   (buffer space is cheap)
 *   γ = 3   (tool/fixture inventory is moderate)
 *
 * Returns also a per-candidate breakdown so the UI can show 'consider
 * +5 buffer instead of 0.75x cycle'.
 */

import { runChain, SeededPrng, type ChainOptions, type Distribution } from "@/engine";
import { scaleDistribution } from "./scale-distribution";

interface MultiOpts {
  readonly targetPerHour: number;
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly stationCycleDistributions: readonly Distribution[];
}

export interface MultiCandidate {
  readonly cycleMultiplier: number;
  readonly bufferDelta: number;
  readonly toolPoolDelta: number;
  /**
   * VROL-1044 — uniform integer bump applied to every topology node's
   * capacity. 0 = no change. Engine clamps capacity ∈ [1, 10] so a
   * delta of 1 on a station already at 10 is a no-op rather than a
   * crash.
   */
  readonly capacityDelta: number;
  readonly perHour: number;
  readonly cost: number;
  readonly meetsTarget: boolean;
}

export interface MultiResult {
  readonly baselinePerHour: number;
  readonly best: MultiCandidate | null;
  readonly candidates: readonly MultiCandidate[];
  readonly searchSize: number;
  readonly elapsedMs: number;
}

const CYCLES: readonly number[] = [0.5, 0.75, 1.0];
const BUFFER_DELTAS: readonly number[] = [0, 5, 10];
const TOOL_DELTAS: readonly number[] = [0, 1];
// VROL-1044 — capacity dim. Search 0 (no bump) vs +1 (every station
// with declared capacity gets +1, clamped at 10). Keeps the search
// 2× rather than blowing up.
const CAPACITY_DELTAS: readonly number[] = [0, 1];

const ALPHA = 10;
const BETA = 1;
const GAMMA = 3;
// Adding a parallel server is the most expensive lever in the
// abstraction — heavier weight than tool-pool bumps (γ = 3).
const DELTA = 15;

function cost(c: {
  cycleMultiplier: number;
  bufferDelta: number;
  toolPoolDelta: number;
  capacityDelta: number;
}): number {
  return (
    ALPHA * Math.abs(1 - c.cycleMultiplier) +
    BETA * c.bufferDelta +
    GAMMA * c.toolPoolDelta +
    DELTA * c.capacityDelta
  );
}

export function runMultiLeverGoal(opts: MultiOpts): MultiResult {
  const t0 = performance.now();
  const base = opts.buildBaseOptions();
  const baselineRun = runChain({
    ...base,
    horizonMs: opts.horizonMs,
    warmupMs: opts.warmupMs,
    prng: new SeededPrng(opts.seed),
  });
  const baselinePerHour = baselineRun.throughputLambda * 3_600_000;

  const candidates: MultiCandidate[] = [];
  for (const cycle of CYCLES) {
    const scaled = opts.stationCycleDistributions.map((d) => scaleDistribution(d, cycle));
    for (const bufferDelta of BUFFER_DELTAS) {
      for (const toolDelta of TOOL_DELTAS) {
        for (const capacityDelta of CAPACITY_DELTAS) {
          const optsForRun = opts.buildBaseOptions();
          const adjustedToolPools = optsForRun.toolPools
            ? optsForRun.toolPools.map((p) => ({
                ...p,
                capacity: Math.max(1, p.capacity + toolDelta),
              }))
            : optsForRun.toolPools;
          // VROL-1044 — bump capacity ONLY on nodes that already
          // declared one. Source/sink stations frequently leave
          // capacity unset, and bumping them past their default 1
          // can drive the state machine into an invalid Starved →
          // BlockedOut transition. Skip undefined-capacity stations
          // so the bump targets the real lanes only.
          const bumpedTopology = optsForRun.topology
            ? {
                ...optsForRun.topology,
                nodes: optsForRun.topology.nodes.map((n, i) => ({
                  ...n,
                  cycleTime: scaled[i] ?? n.cycleTime,
                  ...(capacityDelta > 0 && n.capacity !== undefined
                    ? {
                        capacity: Math.min(10, Math.max(1, n.capacity + capacityDelta)),
                      }
                    : {}),
                })),
              }
            : null;
          const r = runChain({
            ...optsForRun,
            ...(adjustedToolPools ? { toolPools: adjustedToolPools } : {}),
            ...(bumpedTopology ? { topology: bumpedTopology } : { stationCycleTimes: scaled }),
            interStationBufferCapacity: (optsForRun.interStationBufferCapacity ?? 0) + bufferDelta,
            horizonMs: opts.horizonMs,
            warmupMs: opts.warmupMs,
            prng: new SeededPrng(opts.seed),
          });
          const perHour = r.throughputLambda * 3_600_000;
          candidates.push({
            cycleMultiplier: cycle,
            bufferDelta,
            toolPoolDelta: toolDelta,
            capacityDelta,
            perHour,
            cost: cost({
              cycleMultiplier: cycle,
              bufferDelta,
              toolPoolDelta: toolDelta,
              capacityDelta,
            }),
            meetsTarget: perHour >= opts.targetPerHour,
          });
        }
      }
    }
  }

  // Choose the lowest-cost candidate that meets the target. Fall back to
  // the highest-throughput candidate when none do.
  const meeting = candidates.filter((c) => c.meetsTarget);
  let best: MultiCandidate | null = null;
  if (meeting.length > 0) {
    best = meeting.reduce((acc, c) => (c.cost < acc.cost ? c : acc), meeting[0]!);
  } else if (candidates.length > 0) {
    best = candidates.reduce((acc, c) => (c.perHour > acc.perHour ? c : acc), candidates[0]!);
  }
  return {
    baselinePerHour,
    best,
    candidates,
    searchSize: CYCLES.length * BUFFER_DELTAS.length * TOOL_DELTAS.length * CAPACITY_DELTAS.length,
    elapsedMs: performance.now() - t0,
  };
}
