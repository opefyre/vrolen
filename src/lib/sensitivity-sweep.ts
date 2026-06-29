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
  // Baseline: build options as-is.
  const baseline = runChain({
    ...opts.buildBaseOptions(),
    horizonMs: opts.horizonMs,
    warmupMs: opts.warmupMs,
    prng: new SeededPrng(opts.seed),
  });
  const baselinePerHour = baseline.throughputLambda * 3_600_000;

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
    const lowOpts = opts.buildBaseOptions();
    const highOpts = opts.buildBaseOptions();
    // Topology may be present — when it is, the stationCycleTimes path
    // isn't taken; we have to also patch the topology nodes' cycleTime.
    const lowRun = runChain({
      ...lowOpts,
      ...(lowOpts.topology
        ? {
            topology: {
              ...lowOpts.topology,
              nodes: lowOpts.topology.nodes.map((n, idx) =>
                idx === i ? { ...n, cycleTime: lowDist } : n,
              ),
            },
          }
        : { stationCycleTimes: lowArr, stationLabels: [...opts.stationLabels] }),
      horizonMs: opts.horizonMs,
      warmupMs: opts.warmupMs,
      // CRN — share the seed across low and high so the parameter change is
      // the only thing that moves the result. Sampling noise cancels.
      prng: new SeededPrng(opts.seed),
    });
    const highRun = runChain({
      ...highOpts,
      ...(highOpts.topology
        ? {
            topology: {
              ...highOpts.topology,
              nodes: highOpts.topology.nodes.map((n, idx) =>
                idx === i ? { ...n, cycleTime: highDist } : n,
              ),
            },
          }
        : { stationCycleTimes: highArr, stationLabels: [...opts.stationLabels] }),
      horizonMs: opts.horizonMs,
      warmupMs: opts.warmupMs,
      prng: new SeededPrng(opts.seed),
    });
    const lowPerHour = lowRun.throughputLambda * 3_600_000;
    const highPerHour = highRun.throughputLambda * 3_600_000;
    const swing = Math.abs(highPerHour - lowPerHour);
    const swingPct = baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0;
    rows.push({
      stationLabel: label,
      stationIdx: i,
      baselinePerHour,
      lowPerHour,
      highPerHour,
      swingPerHour: swing,
      swingPct,
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
        const lowRun = runChain({
          ...baseOpts,
          topology: patch(lowQty),
          horizonMs: opts.horizonMs,
          warmupMs: opts.warmupMs,
          prng: new SeededPrng(opts.seed),
        });
        const highRun = runChain({
          ...baseOpts,
          topology: patch(highQty),
          horizonMs: opts.horizonMs,
          warmupMs: opts.warmupMs,
          prng: new SeededPrng(opts.seed),
        });
        const lp = lowRun.throughputLambda * 3_600_000;
        const hp = highRun.throughputLambda * 3_600_000;
        const swing = Math.abs(hp - lp);
        constraintRows.push({
          kind: "bomQty",
          label: `BOM ${node.label ?? node.id} ← ${f.feederStationId} qty`,
          lowPerHour: lp,
          highPerHour: hp,
          swingPerHour: swing,
          swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
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
      const lowRun = runChain({
        ...baseOpts,
        toolPools: patch(lowCap),
        horizonMs: opts.horizonMs,
        warmupMs: opts.warmupMs,
        prng: new SeededPrng(opts.seed),
      });
      const highRun = runChain({
        ...baseOpts,
        toolPools: patch(highCap),
        horizonMs: opts.horizonMs,
        warmupMs: opts.warmupMs,
        prng: new SeededPrng(opts.seed),
      });
      const lp = lowRun.throughputLambda * 3_600_000;
      const hp = highRun.throughputLambda * 3_600_000;
      const swing = Math.abs(hp - lp);
      constraintRows.push({
        kind: "toolPoolCap",
        label: `Tool pool "${pool.name}" capacity`,
        lowPerHour: lp,
        highPerHour: hp,
        swingPerHour: swing,
        swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
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
      const lowRun = runChain({
        ...baseOpts,
        topology: patch(lowCap),
        horizonMs: opts.horizonMs,
        warmupMs: opts.warmupMs,
        prng: new SeededPrng(opts.seed),
      });
      const highRun = runChain({
        ...baseOpts,
        topology: patch(highCap),
        horizonMs: opts.horizonMs,
        warmupMs: opts.warmupMs,
        prng: new SeededPrng(opts.seed),
      });
      const lp = lowRun.throughputLambda * 3_600_000;
      const hp = highRun.throughputLambda * 3_600_000;
      const swing = Math.abs(hp - lp);
      const stationLabel = node.label ?? `Station ${String(nIdx + 1)}`;
      constraintRows.push({
        kind: "stationCapacity",
        label: `${stationLabel} capacity (${String(lowCap)} ↔ ${String(highCap)})`,
        lowPerHour: lp,
        highPerHour: hp,
        swingPerHour: swing,
        swingPct: baselinePerHour > 0 ? (swing / baselinePerHour) * 100 : 0,
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
