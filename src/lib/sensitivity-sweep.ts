/**
 * Sensitivity sweep — AnyLogic-style tornado plot input.
 *
 * For each station in the chain, run the engine at low (-20%) and high
 * (+20%) cycle-time multipliers (relative to a baseline run) and report
 * the throughput swing. Sorted by largest absolute swing first so the
 * tornado bars naturally narrow downward.
 *
 * The sweep deliberately keeps stations constant when not under test, so
 * we attribute the throughput delta cleanly to the swept parameter.
 */

import { runChain, SeededPrng, type ChainOptions, type Distribution } from "@/engine";
import { computeStats, type Stats } from "./optimization-search";

export interface SensitivityRow {
  readonly stationLabel: string;
  readonly stationIdx: number;
  readonly baselinePerHour: number;
  readonly lowPerHour: number;
  readonly highPerHour: number;
  /** Absolute swing high - low (always >= 0). */
  readonly swingPerHour: number;
  /** Percent swing vs baseline, signed (positive = higher cycle helped). */
  readonly swingPct: number;
  /**
   * VROL-1062 — replication-aware swing statistics. Stats of the
   * per-rep paired delta (high − low). When K=1 (default) halfWidth=0
   * and low/high collapse to mean. When K>=2 we get the Bessel-
   * corrected 95 % CI on the swing. swingPerHour = |stats.mean|
   * (kept for back-compat — same physical quantity).
   */
  readonly swingStats: Stats;
  /**
   * VROL-1062 — true when the swing is statistically distinguishable
   * from zero at the 95 % level. For K=1 this falls back to
   * swingPerHour > 0; for K>=2 it's true iff the 95 % CI excludes
   * zero (low95 > 0 OR high95 < 0).
   */
  readonly isSignificant: boolean;
}

/**
 * VROL-935 — non-cycle sweep entry (BOM qty or tool-pool capacity).
 * Same swing/baseline math as SensitivityRow; rendered alongside.
 */
export interface SensitivityConstraintRow {
  /**
   * VROL-1040 — adds "stationCapacity" alongside the original BOM /
   * tool-pool branches so the tornado covers all three primary TOC
   * levers (cycle, capacity, contention).
   */
  readonly kind: "bomQty" | "toolPoolCap" | "stationCapacity";
  readonly label: string;
  readonly lowPerHour: number;
  readonly highPerHour: number;
  readonly swingPerHour: number;
  readonly swingPct: number;
  /** VROL-1062 — same Stats shape as the cycle rows. */
  readonly swingStats: Stats;
  /** VROL-1062 — true when the swing's 95 % CI excludes zero. */
  readonly isSignificant: boolean;
}

export interface SensitivitySummary {
  readonly baselinePerHour: number;
  readonly rows: readonly SensitivityRow[];
  /** VROL-935 — BOM qty + tool-pool capacity sweep rows (separate axis). */
  readonly constraintRows: readonly SensitivityConstraintRow[];
  readonly lowMultiplier: number;
  readonly highMultiplier: number;
  readonly elapsedMs: number;
}

/**
 * Scale the timing parameters of a Distribution by `factor`. Each kind
 * is rebuilt with proportionally adjusted parameters so the engine's
 * sampler picks values scaled the same way (no wrapper needed).
 */
function scaleDistribution(d: Distribution, factor: number): Distribution {
  switch (d.kind) {
    case "constant":
      return { kind: "constant", value: d.value * factor };
    case "uniform":
      return { kind: "uniform", min: d.min * factor, max: d.max * factor };
    case "normal":
      return { kind: "normal", mean: d.mean * factor, stddev: d.stddev * factor };
    case "triangular":
      return {
        kind: "triangular",
        min: d.min * factor,
        mode: d.mode * factor,
        max: d.max * factor,
      };
    case "exponential":
      // Higher cycle time → lower rate → scale rate by 1/factor.
      return { kind: "exponential", rate: d.rate / factor };
    case "lognormal":
      // X ~ Lognormal(mu, sigma) → factor * X ~ Lognormal(mu + ln(factor), sigma).
      return { kind: "lognormal", mu: d.mu + Math.log(Math.max(factor, 1e-9)), sigma: d.sigma };
    case "weibull":
      // X ~ Weibull(shape, scale) → factor * X ~ Weibull(shape, scale * factor).
      return { kind: "weibull", shape: d.shape, scale: d.scale * factor };
    case "gamma":
      // X ~ Gamma(shape, scale) → factor * X ~ Gamma(shape, scale * factor).
      return { kind: "gamma", shape: d.shape, scale: d.scale * factor };
    case "empirical":
      return { kind: "empirical", values: d.values.map((v) => v * factor) };
  }
}

interface RunOptsLike {
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly seed: number;
  readonly buildBaseOptions: () => ChainOptions;
  readonly stationCycleDistributions: readonly Distribution[];
  readonly stationLabels: readonly string[];
  /**
   * VROL-1062 — paired replications per swing. Default 1 (preserves
   * existing 2N-runs cost). When K>=2, each row runs K paired
   * (low_i, high_i) trials with CRN-stepped seeds; per-rep delta_i
   * = high − low feeds computeStats() for a Bessel-corrected 95 % CI
   * on the swing magnitude. Caller decides cost vs rigor — 3 is a
   * good default at the UI layer.
   */
  readonly replicationsPerSwing?: number;
}

/**
 * Run the sensitivity sweep. Each station gets one low and one high run
 * (varying ONLY that station's cycle distribution). Roughly 2N engine
 * runs total — keep N modest in UI.
 */
export function runSensitivitySweep(opts: RunOptsLike): SensitivitySummary {
  const t0 = performance.now();
  const LOW = 0.8;
  const HIGH = 1.2;
  // VROL-1062 — K paired reps per swing. Default 1 keeps prior
  // performance + behaviour identical.
  const reps = Math.max(1, Math.floor(opts.replicationsPerSwing ?? 1));
  // CRN-stepped seed: each rep keeps low + high paired on the SAME
  // seed (variance reduction within the pair); reps differ by a
  // multiplier matching the optimization sweep convention.
  const REP_STEP = 31;
  // Baseline: build options as-is.
  const baseline = runChain({
    ...opts.buildBaseOptions(),
    horizonMs: opts.horizonMs,
    warmupMs: opts.warmupMs,
    prng: new SeededPrng(opts.seed),
  });
  const baselinePerHour = baseline.throughputLambda * 3_600_000;
  /**
   * Run K paired (low, high) trials returning per-rep deltas + the
   * mean low/high. `runLow(seed)` and `runHigh(seed)` are caller-
   * provided closures so the cycle/BOM/tool-pool/capacity sweeps
   * can share this logic without duplicating their per-swing wiring.
   */
  function runPairedSwing(
    runLow: (seed: number) => number,
    runHigh: (seed: number) => number,
  ): { deltas: number[]; meanLow: number; meanHigh: number } {
    const deltas: number[] = [];
    let sumLow = 0;
    let sumHigh = 0;
    for (let r = 0; r < reps; r++) {
      const s = opts.seed + r * REP_STEP;
      const low = runLow(s);
      const high = runHigh(s);
      sumLow += low;
      sumHigh += high;
      deltas.push(high - low);
    }
    return { deltas, meanLow: sumLow / reps, meanHigh: sumHigh / reps };
  }
  function isSignificantFrom(s: Stats): boolean {
    // K=1 → halfWidth=0 → fall back to "did the mean move at all?"
    if (s.halfWidth95 <= 0) return Math.abs(s.mean) > 0;
    // K>=2 → 95 % CI excludes zero on either side.
    return s.low95 > 0 || s.high95 < 0;
  }

  const rows: SensitivityRow[] = [];
  for (let i = 0; i < opts.stationCycleDistributions.length; i++) {
    const label = opts.stationLabels[i] ?? `Station ${String(i + 1)}`;
    const base = opts.stationCycleDistributions[i];
    if (!base) continue;
    // Build perturbed cycle arrays — clone original, swap index i.
    const lowDist = scaleDistribution(base, LOW);
    const highDist = scaleDistribution(base, HIGH);
    const lowArr = [...opts.stationCycleDistributions];
    lowArr[i] = lowDist;
    const highArr = [...opts.stationCycleDistributions];
    highArr[i] = highDist;
    // Topology may be present — when it is, the stationCycleTimes path
    // isn't taken; we have to also patch the topology nodes' cycleTime.
    const runOnce =
      (perturbedDist: Distribution, perturbedArr: Distribution[]) =>
      (seed: number): number => {
        const baseOpts = opts.buildBaseOptions();
        const r = runChain({
          ...baseOpts,
          ...(baseOpts.topology
            ? {
                topology: {
                  ...baseOpts.topology,
                  nodes: baseOpts.topology.nodes.map((n, idx) =>
                    // Latent bug fix: engine field is cycleTimeMs not
                    // cycleTime; the pre-1062 code wrote `cycleTime`
                    // so the patch was a silent no-op for topology
                    // mode (cycle sweeps returned delta=0). Restored
                    // correctness as part of the K-rep refactor.
                    idx === i ? { ...n, cycleTimeMs: perturbedDist } : n,
                  ),
                },
              }
            : { stationCycleTimes: perturbedArr, stationLabels: [...opts.stationLabels] }),
          horizonMs: opts.horizonMs,
          warmupMs: opts.warmupMs,
          prng: new SeededPrng(seed),
        });
        return r.throughputLambda * 3_600_000;
      };
    const { deltas, meanLow, meanHigh } = runPairedSwing(
      runOnce(lowDist, lowArr),
      runOnce(highDist, highArr),
    );
    const swingStats = computeStats(deltas);
    const swing = Math.abs(swingStats.mean);
    const swingPct = baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0;
    rows.push({
      stationLabel: label,
      stationIdx: i,
      baselinePerHour,
      lowPerHour: meanLow,
      highPerHour: meanHigh,
      swingPerHour: swing,
      swingPct,
      swingStats,
      isSignificant: isSignificantFrom(swingStats),
    });
  }
  rows.sort((a, b) => b.swingPerHour - a.swingPerHour);

  // VROL-935 — BOM qty + tool-pool capacity sweep.
  const constraintRows: SensitivityConstraintRow[] = [];
  const baseOpts = opts.buildBaseOptions();
  if (baseOpts.topology) {
    const topology = baseOpts.topology;
    // BOM qty: for each (station, feeder) pair, vary qtyPerCycle ±50 %.
    topology.nodes.forEach((node, nIdx) => {
      const feeders = node.bomFeeders;
      if (!Array.isArray(feeders)) return;
      feeders.forEach((f, fIdx) => {
        if (!f || typeof f.qtyPerCycle !== "number") return;
        const lowQty = Math.max(1, Math.round(f.qtyPerCycle * 0.5));
        const highQty = Math.max(1, Math.round(f.qtyPerCycle * 1.5));
        const patch = (qty: number): typeof topology => ({
          ...topology,
          nodes: topology.nodes.map((n, idx) =>
            idx !== nIdx
              ? n
              : {
                  ...n,
                  bomFeeders: (n.bomFeeders ?? []).map((row, j) =>
                    j === fIdx ? { ...row, qtyPerCycle: qty } : row,
                  ),
                },
          ),
        });
        const runQty =
          (qty: number) =>
          (seed: number): number => {
            const r = runChain({
              ...baseOpts,
              topology: patch(qty),
              horizonMs: opts.horizonMs,
              warmupMs: opts.warmupMs,
              prng: new SeededPrng(seed),
            });
            return r.throughputLambda * 3_600_000;
          };
        const { deltas, meanLow, meanHigh } = runPairedSwing(runQty(lowQty), runQty(highQty));
        const swingStats = computeStats(deltas);
        const swing = Math.abs(swingStats.mean);
        constraintRows.push({
          kind: "bomQty",
          label: `BOM ${node.label ?? node.id} ← ${f.feederStationId} qty`,
          lowPerHour: meanLow,
          highPerHour: meanHigh,
          swingPerHour: swing,
          swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
          swingStats,
          isSignificant: isSignificantFrom(swingStats),
        });
      });
    });
  }
  // Tool-pool capacity: vary each named pool's capacity ±50 %.
  if (baseOpts.toolPools && baseOpts.toolPools.length > 0) {
    for (let p = 0; p < baseOpts.toolPools.length; p++) {
      const pool = baseOpts.toolPools[p];
      if (!pool || pool.capacity <= 0) continue;
      const lowCap = Math.max(1, Math.round(pool.capacity * 0.5));
      const highCap = Math.max(1, Math.round(pool.capacity * 1.5));
      const patch = (cap: number): typeof baseOpts.toolPools => {
        const pools = [...(baseOpts.toolPools ?? [])];
        pools[p] = { ...(pools[p] ?? pool), capacity: cap };
        return pools;
      };
      const runPool =
        (cap: number) =>
        (seed: number): number => {
          const r = runChain({
            ...baseOpts,
            toolPools: patch(cap),
            horizonMs: opts.horizonMs,
            warmupMs: opts.warmupMs,
            prng: new SeededPrng(seed),
          });
          return r.throughputLambda * 3_600_000;
        };
      const { deltas, meanLow, meanHigh } = runPairedSwing(runPool(lowCap), runPool(highCap));
      const swingStats = computeStats(deltas);
      const swing = Math.abs(swingStats.mean);
      constraintRows.push({
        kind: "toolPoolCap",
        label: `Tool pool "${pool.name}" capacity`,
        lowPerHour: meanLow,
        highPerHour: meanHigh,
        swingPerHour: swing,
        swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
        swingStats,
        isSignificant: isSignificantFrom(swingStats),
      });
    }
  }

  // VROL-1040 — station parallel-capacity sweep. For each topology
  // node with capacity ≥ 1, vary cap by ±1 (integer values; min
  // floor at 1). Skips nodes without a declared capacity field — the
  // engine's default of 1 isn't worth testing both sides of (low
  // collapses to 1 vs 1).
  if (baseOpts.topology) {
    const topology = baseOpts.topology;
    topology.nodes.forEach((node, nIdx) => {
      const cap = typeof node.capacity === "number" && node.capacity >= 1 ? node.capacity : 0;
      if (cap < 1) return;
      const lowCap = Math.max(1, cap - 1);
      const highCap = cap + 1;
      // Skip when low + high collapse onto the same value (capacity=1
      // and we'd be comparing 1 vs 1 against 1 vs 2).
      if (lowCap === highCap) return;
      const patch = (newCap: number): typeof topology => ({
        ...topology,
        nodes: topology.nodes.map((n, i) => (i === nIdx ? { ...n, capacity: newCap } : n)),
      });
      const runCap =
        (newCap: number) =>
        (seed: number): number => {
          const r = runChain({
            ...baseOpts,
            topology: patch(newCap),
            horizonMs: opts.horizonMs,
            warmupMs: opts.warmupMs,
            prng: new SeededPrng(seed),
          });
          return r.throughputLambda * 3_600_000;
        };
      const { deltas, meanLow, meanHigh } = runPairedSwing(runCap(lowCap), runCap(highCap));
      const swingStats = computeStats(deltas);
      const swing = Math.abs(swingStats.mean);
      const stationLabel = node.label ?? `Station ${String(nIdx + 1)}`;
      constraintRows.push({
        kind: "stationCapacity",
        label: `${stationLabel} capacity (${String(lowCap)} ↔ ${String(highCap)})`,
        lowPerHour: meanLow,
        highPerHour: meanHigh,
        swingPerHour: swing,
        swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
        swingStats,
        isSignificant: isSignificantFrom(swingStats),
      });
    });
  }
  constraintRows.sort((a, b) => b.swingPerHour - a.swingPerHour);

  const elapsedMs = performance.now() - t0;
  return {
    baselinePerHour,
    rows,
    constraintRows,
    lowMultiplier: LOW,
    highMultiplier: HIGH,
    elapsedMs,
  };
}
