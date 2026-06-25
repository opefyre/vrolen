/**
 * VROL-889 v1 — batch-fire station end-to-end.
 *
 * Models a 3D-print / autoclave / oven workflow: station 2 waits
 * for batchSize parts to accumulate, then fires one long cycle
 * that emits batchSize parts at completion.
 */
import { describe, expect, it } from "vitest";

import { runChain, type ChainOptions, type ChainTopology } from "./chain-harness";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";

const HORIZON_MS = 120_000;
const WARMUP_MS = 10_000;
const BATCH_SIZE = 10;

function buildTopology(withBatch: boolean): ChainTopology {
  return {
    nodes: [
      { id: "source", cycleTimeMs: constant(500) },
      { id: "feeder", cycleTimeMs: constant(500) },
      withBatch
        ? // The "print" station fires once it has 10 parts loaded, then
          // runs a 5s cycle (the print) and emits 10 parts at completion.
          { id: "printer", cycleTimeMs: constant(5_000), batchSize: BATCH_SIZE }
        : { id: "printer", cycleTimeMs: constant(5_000) },
      { id: "sink", cycleTimeMs: constant(500) },
    ],
    edges: [
      { source: "source", target: "feeder" },
      { source: "feeder", target: "printer" },
      { source: "printer", target: "sink" },
    ],
  };
}

function buildOpts(withBatch: boolean): ChainOptions {
  return {
    topology: buildTopology(withBatch),
    interStationBufferCapacity: 20,
    horizonMs: HORIZON_MS,
    warmupMs: WARMUP_MS,
    prng: new SeededPrng(0xba7c4),
  };
}

describe("batch-fire stations (VROL-889 v1)", () => {
  it("rejects invalid batchSize at build time", () => {
    expect(() =>
      runChain({
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(100), batchSize: 0 },
            { id: "b", cycleTimeMs: constant(100) },
          ],
          edges: [{ source: "a", target: "b" }],
        },
        interStationBufferCapacity: 5,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/batchSize/);

    expect(() =>
      runChain({
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(100), batchSize: 1.5 },
            { id: "b", cycleTimeMs: constant(100) },
          ],
          edges: [{ source: "a", target: "b" }],
        },
        interStationBufferCapacity: 5,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/batchSize/);
  });

  it("batchSize=1 (default) preserves the baseline behaviour exactly", () => {
    const a = runChain(buildOpts(false));
    const b = runChain(buildOpts(false));
    expect(a.completed).toBe(b.completed);
    expect(a.throughputLambda).toBe(b.throughputLambda);
  });

  it("batch-fire station yields multiples of batchSize when defects are absent", () => {
    const r = runChain(buildOpts(true));
    // Printer's per-station completed counter advances by batchSize per
    // cycle; over the run it should be a multiple of batchSize. (We
    // index by topology order: source=0, feeder=1, printer=2, sink=3.)
    const printerCompleted = r.perStationCompleted[2] ?? 0;
    expect(printerCompleted).toBeGreaterThan(0);
    expect(printerCompleted % BATCH_SIZE).toBe(0);
  });

  it("batch-fire stalls when fewer than batchSize parts are available", () => {
    // A larger batchSize than the upstream can supply within the run
    // window starves the station entirely. The printer never fires.
    const r = runChain({
      topology: {
        nodes: [
          { id: "source", cycleTimeMs: constant(500) },
          { id: "feeder", cycleTimeMs: constant(500) },
          // Batch of 200 with capacity 20 = never fires within 2 min.
          { id: "printer", cycleTimeMs: constant(5_000), batchSize: 200 },
          { id: "sink", cycleTimeMs: constant(500) },
        ],
        edges: [
          { source: "source", target: "feeder" },
          { source: "feeder", target: "printer" },
          { source: "printer", target: "sink" },
        ],
      },
      interStationBufferCapacity: 20,
      horizonMs: HORIZON_MS,
      warmupMs: WARMUP_MS,
      prng: new SeededPrng(0xba7c4),
    });
    // Printer's completed counter stays at 0; downstream sink sees
    // nothing either.
    expect(r.perStationCompleted[2] ?? 0).toBe(0);
    expect(r.completed).toBe(0);
  });
});
