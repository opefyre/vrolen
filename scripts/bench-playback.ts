/**
 * Benchmark — playback derivation (VROL-1000).
 *
 * The post-VROL-965 playback overlay calls derivePlayback once per tick
 * (~60Hz when scrubbing). This bench builds a 10-station scenario, runs
 * it to a finished ChainResult, then sweeps playbackMs across the full
 * horizon at 240 ticks and measures total time spent in derivePlayback.
 *
 * Run: npm run bench:playback
 *
 * Reports best-of-5 to discount JIT warm-up / GC noise. The number
 * captured here is the baseline against which future memoization /
 * sampling-rate changes can be compared.
 */
import { performance } from "node:perf_hooks";

import { runChain, type ChainOptions } from "../src/engine/chain-harness";
import { constant } from "../src/engine/distribution";
import { SeededPrng } from "../src/engine/prng";
import { derivePlayback } from "../src/lib/derive-playback";

const STATIONS = 10;
const HORIZON_MS = 60 * 60 * 1000; // 1 simulated hour
const WARMUP_MS = 5 * 60 * 1000;
const TICKS = 240;
const REPEATS = 5;

function buildOptions(): ChainOptions {
  const cycleTimes = Array.from({ length: STATIONS }, (_, i) => constant(2_000 + i * 250));
  return {
    stationCycleTimes: cycleTimes,
    interStationBufferCapacity: 5,
    horizonMs: HORIZON_MS,
    warmupMs: WARMUP_MS,
    prng: new SeededPrng(0xc0ffee),
    sampler: { intervalMs: 60_000 },
  };
}

function singleRun(): { runMs: number; sweepMs: number; samples: number } {
  const runStart = performance.now();
  const result = runChain(buildOptions());
  const runMs = performance.now() - runStart;

  // Sweep playback across the full horizon at TICKS evenly-spaced points.
  const step = HORIZON_MS / TICKS;
  const sweepStart = performance.now();
  let sink = 0;
  for (let i = 0; i < TICKS; i++) {
    const tMs = step * i;
    const snap = derivePlayback(result, tMs);
    sink ^= snap.sampleIdxAtT;
  }
  const sweepMs = performance.now() - sweepStart;
  // Touch sink to prevent dead-code elimination.
  if (sink === Number.MAX_SAFE_INTEGER) console.log("");
  return { runMs, sweepMs, samples: result.samples.length };
}

const results: ReturnType<typeof singleRun>[] = [];
for (let r = 0; r < REPEATS; r++) {
  results.push(singleRun());
}

const bestSweep = Math.min(...results.map((r) => r.sweepMs));
const bestRun = Math.min(...results.map((r) => r.runMs));
const samples = results[0]?.samples ?? 0;

console.log(`bench-playback (VROL-1000)`);
console.log(`  scenario: ${String(STATIONS)} stations, horizon ${String(HORIZON_MS / 1000)}s`);
console.log(`  result.samples: ${String(samples)}`);
console.log(`  runChain best:        ${bestRun.toFixed(2)} ms`);
console.log(`  derivePlayback × ${String(TICKS)}:`);
console.log(`    best:   ${bestSweep.toFixed(2)} ms`);
console.log(`    per-tick: ${(bestSweep / TICKS).toFixed(3)} ms`);
console.log(`  budget: <16ms / tick (60 fps target)`);
