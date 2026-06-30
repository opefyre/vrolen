/**
 * VROL-1061 — per-edge buffer capacity. Engine-level tests:
 *  1. Tight per-edge cap on one mid-chain edge creates upstream
 *     back-pressure (the producer station spends time in BlockedOut).
 *  2. Loose per-edge cap matches the global default behaviour
 *     (no extra back-pressure introduced).
 *  3. Validation rejects 0 / negative / non-integer values.
 *  4. tankCapacityL still wins when both are set (precedence).
 *  5. Per-edge cap wins over kanbanCap on the sink-feeding edge
 *     when both are set (more-specific override).
 */
import { describe, expect, it } from "vitest";

import { constant } from "./distribution";
import { runChain, SeededPrng, type ChainTopology } from "./index";

function fourStageTopology(perEdgeCap?: number): ChainTopology {
  return {
    nodes: [
      { id: "A", label: "A", cycleTimeMs: constant(100) },
      { id: "B", label: "B", cycleTimeMs: constant(100) },
      { id: "C", label: "C", cycleTimeMs: constant(100) },
      { id: "D", label: "D", cycleTimeMs: constant(100) },
    ],
    edges: [
      { source: "A", target: "B" },
      {
        source: "B",
        target: "C",
        ...(perEdgeCap !== undefined ? { bufferCapacity: perEdgeCap } : {}),
      },
      { source: "C", target: "D" },
    ],
  };
}

describe("per-edge bufferCapacity (VROL-1061)", () => {
  it("tight per-edge cap (=1) on B→C with B fast and C slow creates BlockedOut on B", () => {
    // Unbalanced chain: B fast (50 ms), C slow (200 ms). With a loose
    // buffer (=50) B fills the queue and never blocks; with tight
    // (=1) B pushes one part, blocks until C drains. Per-state time
    // sits on the SAMPLER timeseries; we grab the final sample.
    const topology = (cap: number): ChainTopology => ({
      nodes: [
        { id: "A", label: "A", cycleTimeMs: constant(50) },
        { id: "B", label: "B", cycleTimeMs: constant(50) },
        { id: "C", label: "C", cycleTimeMs: constant(200) },
        { id: "D", label: "D", cycleTimeMs: constant(50) },
      ],
      edges: [
        { source: "A", target: "B" },
        { source: "B", target: "C", bufferCapacity: cap },
        { source: "C", target: "D" },
      ],
    });
    const tight = runChain({
      topology: topology(1),
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      sampler: { intervalMs: 1_000 },
    });
    const loose = runChain({
      topology: topology(50),
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      sampler: { intervalMs: 1_000 },
    });
    const lastTight = tight.samples[tight.samples.length - 1]!;
    const lastLoose = loose.samples[loose.samples.length - 1]!;
    const bTightBlocked = lastTight.perStationStateMs[1]?.["BlockedOut"] ?? 0;
    const bLooseBlocked = lastLoose.perStationStateMs[1]?.["BlockedOut"] ?? 0;
    expect(bTightBlocked).toBeGreaterThan(bLooseBlocked);
    expect(bTightBlocked).toBeGreaterThan(0);
  });

  it("undefined per-edge cap (omitted field) matches global behaviour exactly", () => {
    const withOmitted = runChain({
      topology: fourStageTopology(undefined),
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
    });
    const withExplicitGlobal = runChain({
      topology: fourStageTopology(50),
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
    });
    // Same effective cap → same throughput → same completed.
    expect(withOmitted.completed).toBe(withExplicitGlobal.completed);
  });

  it("validation rejects bufferCapacity=0", () => {
    expect(() =>
      runChain({
        topology: fourStageTopology(0),
        interStationBufferCapacity: 50,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/bufferCapacity/);
  });

  it("validation rejects non-integer bufferCapacity", () => {
    expect(() =>
      runChain({
        topology: fourStageTopology(2.5),
        interStationBufferCapacity: 50,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/bufferCapacity/);
  });

  it("tankCapacityL takes precedence over bufferCapacity (tanks use litres, not parts)", () => {
    const tankWins: ChainTopology = {
      nodes: [
        { id: "A", label: "A", cycleTimeMs: constant(100) },
        { id: "B", label: "B", cycleTimeMs: constant(100) },
      ],
      // Tank cap 100 L → buffer holds 100 parts. Per-edge cap 1 would
      // normally throttle, but tankCapacityL wins → no throttling.
      edges: [{ source: "A", target: "B", bufferCapacity: 1, tankCapacityL: 100 }],
    };
    const r = runChain({
      topology: tankWins,
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      sampler: { intervalMs: 1_000 },
    });
    // A should never BlockOut because the tank's 100-part capacity
    // beats the per-edge 1-part cap.
    const last = r.samples[r.samples.length - 1]!;
    const aBlockedOut = last.perStationStateMs[0]?.["BlockedOut"] ?? 0;
    expect(aBlockedOut).toBe(0);
  });

  it("per-edge bufferCapacity wins over sink kanbanCap when both apply", () => {
    // kanbanCap is intended for the sink-feeding edge. When the user
    // ALSO sets a per-edge cap on that edge, per-edge wins (more
    // specific). To verify: set kanbanCap = 1 (would create blocking)
    // but per-edge bufferCapacity = 50 on that edge (relaxes it).
    const topology: ChainTopology = {
      nodes: [
        { id: "A", label: "A", cycleTimeMs: constant(100) },
        { id: "B", label: "B", cycleTimeMs: constant(100) },
      ],
      edges: [{ source: "A", target: "B", bufferCapacity: 50 }],
    };
    const r = runChain({
      topology,
      interStationBufferCapacity: 50,
      kanbanCap: 1, // would throttle without the per-edge override
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      sampler: { intervalMs: 1_000 },
    });
    // With the per-edge override winning, A doesn't BlockOut.
    const last = r.samples[r.samples.length - 1]!;
    const aBlockedOut = last.perStationStateMs[0]?.["BlockedOut"] ?? 0;
    expect(aBlockedOut).toBe(0);
  });
});
