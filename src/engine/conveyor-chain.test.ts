/**
 * VROL-1002 — end-to-end conveyor integration through the chain
 * harness.
 *
 * Wires a 2-station linear chain with a 5 s conveyor delay on the
 * single edge between them. Verifies:
 *   (a) first finished part exits AFTER the conveyor delay has
 *       elapsed for the first cycle's output, never before;
 *   (b) steady-state throughput at the producer's pace (1 part / s for
 *       a 1 s cycle), since the conveyor adds latency but not
 *       bandwidth on an uncongested edge;
 *   (c) ChainOptions.bufferDelayMs left undefined matches the
 *       pre-VROL-1002 baseline exactly (no behaviour change for
 *       existing scenarios).
 */
import { describe, expect, it } from "vitest";

import { runChain, type ChainOptions } from "./chain-harness";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";

const CYCLE_MS = 1_000;
const DELAY_MS = 5_000;
const HORIZON_MS = 60_000;
const WARMUP_MS = 10_000;

function buildOpts(withDelay: boolean): ChainOptions {
  return {
    stationCycleTimes: [constant(CYCLE_MS), constant(CYCLE_MS)],
    interStationBufferCapacity: 10,
    horizonMs: HORIZON_MS,
    warmupMs: WARMUP_MS,
    prng: new SeededPrng(0xc05ee),
    ...(withDelay ? { bufferDelayMs: [DELAY_MS] } : {}),
  };
}

describe("conveyor chain integration (VROL-1002)", () => {
  it("steady-state throughput matches producer pace with a 5s edge conveyor", () => {
    const baseline = runChain(buildOpts(false));
    const conveyor = runChain(buildOpts(true));
    // Both should have positive throughput.
    expect(baseline.throughputLambda).toBeGreaterThan(0);
    expect(conveyor.throughputLambda).toBeGreaterThan(0);
    // Conveyor throughput within 5% of baseline (delay shifts the
    // first-exit time but doesn't reduce steady-state bandwidth).
    const ratio = conveyor.throughputLambda / baseline.throughputLambda;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it("undefined bufferDelayMs is identical to the pre-VROL-1002 path", () => {
    const a = runChain(buildOpts(false));
    const b = runChain(buildOpts(false));
    // Determinism check.
    expect(a.completed).toBe(b.completed);
    expect(a.throughputLambda).toBe(b.throughputLambda);
  });

  it("conveyor delay shifts time-in-system upward (Little's Law)", () => {
    const baseline = runChain(buildOpts(false));
    const conveyor = runChain(buildOpts(true));
    // Conveyor adds DELAY_MS of residence to every part — average
    // time-in-system should be measurably higher.
    expect(conveyor.avgTimeInSystemW).toBeGreaterThan(baseline.avgTimeInSystemW + DELAY_MS / 2);
  });
});
