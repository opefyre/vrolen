/**
 * VROL-1004 — fan-out station with mixed delayed + undelayed outputs.
 *
 * Topology:
 *     source → fanout ┬→ mid_A → sink     (edge 1: 5s conveyor delay)
 *                     └→ mid_B → sink     (edge 2: direct, no delay)
 *
 * Single-source / single-sink topology required by the harness, so
 * both branches merge at `sink`. Verifies the ConveyorPushWrapper
 * now slots into MultiOutputBuffer destinations correctly when the
 * upstream station has out-degree > 1.
 */
import { describe, expect, it } from "vitest";

import { runChain, type ChainOptions, type ChainTopology } from "./chain-harness";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";

const HORIZON_MS = 60_000;
const WARMUP_MS = 10_000;

function topology(): ChainTopology {
  return {
    nodes: [
      { id: "source", cycleTimeMs: constant(1_000) },
      { id: "fanout", cycleTimeMs: constant(500) },
      { id: "mid_a", cycleTimeMs: constant(500) },
      { id: "mid_b", cycleTimeMs: constant(500) },
      { id: "sink", cycleTimeMs: constant(500) },
    ],
    edges: [
      { source: "source", target: "fanout" },
      { source: "fanout", target: "mid_a" },
      { source: "fanout", target: "mid_b" },
      { source: "mid_a", target: "sink" },
      { source: "mid_b", target: "sink" },
    ],
  };
}

function buildOpts(delayed: boolean): ChainOptions {
  return {
    topology: topology(),
    interStationBufferCapacity: 10,
    horizonMs: HORIZON_MS,
    warmupMs: WARMUP_MS,
    prng: new SeededPrng(0xfa70),
    // Edge order matches topology.edges above:
    //   0: source → fanout
    //   1: fanout → mid_a   <- delay here when `delayed`
    //   2: fanout → mid_b
    //   3: mid_a → sink
    //   4: mid_b → sink
    ...(delayed ? { bufferDelayMs: [0, 5_000, 0, 0, 0] } : {}),
  };
}

describe("conveyor fan-out (VROL-1004)", () => {
  it("runs to completion when one of two fan-out edges has a conveyor delay", () => {
    const r = runChain(buildOpts(true));
    expect(r.completed).toBeGreaterThan(0);
    expect(r.throughputLambda).toBeGreaterThan(0);
  });

  it("delayed-branch parts shift avgTimeInSystem upward vs the undelayed baseline", () => {
    const baseline = runChain(buildOpts(false));
    const delayed = runChain(buildOpts(true));
    // At least SOME parts took the delayed branch — overall average
    // should be measurably higher than the undelayed case.
    expect(delayed.avgTimeInSystemW).toBeGreaterThan(baseline.avgTimeInSystemW);
  });

  it("steady-state throughput remains close to the undelayed baseline", () => {
    const baseline = runChain(buildOpts(false));
    const delayed = runChain(buildOpts(true));
    const ratio = delayed.throughputLambda / baseline.throughputLambda;
    // Delay shifts latency, not bandwidth — throughput should be in
    // the same ballpark (within ~10%).
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});
