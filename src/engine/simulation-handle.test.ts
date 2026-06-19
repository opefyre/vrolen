import { describe, expect, it } from "vitest";

import { createSimulation, runChain, SeededPrng } from "@/engine";
import { constant } from "./distribution";

describe("createSimulation (VROL-148)", () => {
  it("step() advances exactly one event at a time", () => {
    const sim = createSimulation({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 1_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const ev1 = sim.step();
    expect(ev1).not.toBeNull();
    expect(typeof ev1!.timeMs).toBe("number");
    expect(sim.done).toBe(false);
    // Each step strictly increases currentTimeMs (or holds, for same-instant
    // events). Just ensure done flips eventually.
    let steps = 1;
    while (!sim.done) {
      const ev = sim.step();
      if (ev === null) break;
      steps += 1;
    }
    expect(sim.done).toBe(true);
    expect(steps).toBeGreaterThan(1);
  });

  it("advanceUntil(simMs) bounds the run + returns event count", () => {
    const sim = createSimulation({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const n = sim.advanceUntil(500);
    expect(n).toBeGreaterThan(0);
    // The last event processed is at or past 500ms (one event past is OK
    // per the advanceUntil semantics: "advance at least until simMs").
    expect(sim.currentTimeMs).toBeGreaterThanOrEqual(500);
    expect(sim.done).toBe(false);
  });

  it("finalize() drains to completion + returns the same ChainResult as runChain", () => {
    const opts = {
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(42),
    };
    const direct = runChain({ ...opts, prng: new SeededPrng(42) });
    const sim = createSimulation({ ...opts, prng: new SeededPrng(42) });
    const stepped = sim.finalize();
    expect(stepped.completed).toBe(direct.completed);
    expect(stepped.lineOee).toBeCloseTo(direct.lineOee, 6);
    expect(stepped.bottleneckStationIdx).toBe(direct.bottleneckStationIdx);
  });

  it("finalize() works correctly after some step()/advanceUntil() calls", () => {
    const opts = {
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 1_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
    };
    const direct = runChain({ ...opts, prng: new SeededPrng(7) });
    const sim = createSimulation({ ...opts, prng: new SeededPrng(7) });
    sim.advanceUntil(200);
    sim.step();
    sim.step();
    const final = sim.finalize();
    expect(final.completed).toBe(direct.completed);
  });

  it("step() returns null + done flips when scheduler is drained", () => {
    const sim = createSimulation({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 300,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    while (sim.step() !== null) {
      // drain
    }
    expect(sim.done).toBe(true);
    expect(sim.step()).toBeNull();
  });
});
