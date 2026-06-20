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

export interface SensitivitySummary {
  readonly baselinePerHour: number;
  readonly rows: readonly SensitivityRow[];
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
  const elapsedMs = performance.now() - t0;
  return {
    baselinePerHour,
    rows,
    lowMultiplier: LOW,
    highMultiplier: HIGH,
    elapsedMs,
  };
}
