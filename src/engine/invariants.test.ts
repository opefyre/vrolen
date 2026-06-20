/**
 * VROL-476 — property-based engine invariant tests via fast-check.
 *
 * Each invariant is asserted over ≥100 generated scenarios. The shrinker
 * reduces a failure to its minimal counterexample so debugging starts
 * from the simplest case that exhibits the bug.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ChainOptions } from "./chain-harness";
import { runChain } from "./chain-harness";
import { constant } from "./distribution";
import { SeededPrng } from "./prng";

/** Arbitrary that generates valid ChainOptions. */
function chainOptsArb(overrides: { horizonMs?: number } = {}) {
  return fc
    .record({
      cycleTimes: fc.array(fc.integer({ min: 10, max: 500 }), {
        minLength: 2,
        maxLength: 5,
      }),
      bufferCap: fc.integer({ min: 1, max: 20 }),
      seed: fc.integer({ min: 1, max: 1_000_000 }),
    })
    .map(
      ({ cycleTimes, bufferCap, seed }): ChainOptions => ({
        stationCycleTimes: cycleTimes.map((ms) => constant(ms)),
        interStationBufferCapacity: bufferCap,
        horizonMs: overrides.horizonMs ?? 30_000,
        warmupMs: 0,
        prng: new SeededPrng(seed),
      }),
    );
}

describe("property-based engine invariants (VROL-476)", () => {
  it("determinism: same opts + seed produces identical KPIs", () => {
    fc.assert(
      fc.property(chainOptsArb(), (optsTemplate) => {
        // Re-seed each run so the PRNG starts fresh; same seed = same draws.
        const opts1 = { ...optsTemplate, prng: new SeededPrng(0xc0ffee) };
        const opts2 = { ...optsTemplate, prng: new SeededPrng(0xc0ffee) };
        const r1 = runChain(opts1);
        const r2 = runChain(opts2);
        expect(r1.completed).toBe(r2.completed);
        expect(r1.throughputLambda).toBe(r2.throughputLambda);
        expect(r1.lineOee).toBe(r2.lineOee);
        expect(r1.avgTimeInSystemW).toBe(r2.avgTimeInSystemW);
      }),
      { numRuns: 100 },
    );
  });

  it("monotonicity: longer horizon never decreases completed parts", () => {
    fc.assert(
      fc.property(chainOptsArb({ horizonMs: 10_000 }), (opts) => {
        const short = runChain({ ...opts, prng: new SeededPrng(0xbeef) });
        const long = runChain({
          ...opts,
          horizonMs: opts.horizonMs * 2,
          prng: new SeededPrng(0xbeef),
        });
        expect(long.completed).toBeGreaterThanOrEqual(short.completed);
      }),
      { numRuns: 100 },
    );
  });

  it("throughput bound: λ ≤ 1 / min(cycleTime)", () => {
    fc.assert(
      fc.property(chainOptsArb(), (opts) => {
        const result = runChain(opts);
        const cycles = opts.stationCycleTimes ?? [];
        const minCycleMs = cycles.reduce(
          (m, d) => Math.min(m, d.kind === "constant" ? d.value : Infinity),
          Infinity,
        );
        // Physically: a station can produce at most 1 part per cycle time.
        // Chain throughput bounded by the fastest station's rate.
        const upperBound = 1 / minCycleMs;
        // Allow a tiny slack for warmup edge effects.
        expect(result.throughputLambda).toBeLessThanOrEqual(upperBound + 1e-9);
        expect(result.throughputLambda).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  it("rates are valid: scrap rate, rework rate, OEE all in [0, 1]", () => {
    fc.assert(
      fc.property(chainOptsArb(), (opts) => {
        const result = runChain(opts);
        expect(result.lineScrapRate).toBeGreaterThanOrEqual(0);
        expect(result.lineScrapRate).toBeLessThanOrEqual(1);
        expect(result.lineReworkRate).toBeGreaterThanOrEqual(0);
        expect(result.lineReworkRate).toBeLessThanOrEqual(1);
        expect(result.lineOee).toBeGreaterThanOrEqual(0);
        expect(result.lineOee).toBeLessThanOrEqual(1);
        expect(result.completed).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});
