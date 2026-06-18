/**
 * Benchmark — Scheduler insert + drain throughput.
 *
 * Run: pnpm bench:scheduler
 *
 * Reports wall-clock for inserting N events with pseudo-random times,
 * then draining the heap in order. Repeats 5 times and reports the best
 * to discount JIT warm-up / GC noise.
 */
import { performance } from "node:perf_hooks";

import { Scheduler } from "../src/engine/scheduler";

const N = 1_000_000;
const REPEATS = 5;
const HORIZON_MS = 30 * 24 * 60 * 60 * 1_000; // 30 simulated days

function singleRun(): { insertMs: number; drainMs: number; totalMs: number } {
  const s = new Scheduler<number>();

  // Pseudo-random time generator — Mulberry32 for stable, deterministic output.
  let state = 0xdeadbeef;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Insert
  const insertStart = performance.now();
  for (let i = 0; i < N; i++) {
    s.schedule(Math.floor(rand() * HORIZON_MS), i);
  }
  const insertMs = performance.now() - insertStart;

  // Drain
  const drainStart = performance.now();
  let drained = 0;
  while (s.size > 0) {
    s.popMin();
    drained++;
  }
  const drainMs = performance.now() - drainStart;

  if (drained !== N) {
    throw new Error(`Drained ${String(drained)} events, expected ${String(N)}`);
  }

  return { insertMs, drainMs, totalMs: insertMs + drainMs };
}

function format(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

console.log(
  `Scheduler benchmark — ${N.toLocaleString("en-US")} events, ${String(REPEATS)} runs (best reported)\n`,
);

const results: ReturnType<typeof singleRun>[] = [];
for (let i = 0; i < REPEATS; i++) {
  process.stdout.write(`  run ${String(i + 1)}/${String(REPEATS)}: `);
  const r = singleRun();
  results.push(r);
  console.log(
    `insert=${format(r.insertMs)}  drain=${format(r.drainMs)}  total=${format(r.totalMs)}`,
  );
}

const best = results.reduce((acc, r) => (r.totalMs < acc.totalMs ? r : acc));
const eventsPerSec = (N * 2) / (best.totalMs / 1000); // insert+drain = 2 ops per event

console.log(`\nBest run:`);
console.log(
  `  Insert: ${format(best.insertMs)} (${(N / (best.insertMs / 1000) / 1_000_000).toFixed(2)}M ops/sec)`,
);
console.log(
  `  Drain:  ${format(best.drainMs)} (${(N / (best.drainMs / 1000) / 1_000_000).toFixed(2)}M ops/sec)`,
);
console.log(
  `  Total:  ${format(best.totalMs)} (${(eventsPerSec / 1_000_000).toFixed(2)}M ops/sec end-to-end)`,
);
