import { describe, expect, it } from "vitest";

import { Buffer } from "./buffer";
import { constant } from "./distribution";
import { CycleExecutor } from "./cycle-execution";
import type { EngineEvent } from "./events";
import { newStationId } from "./ids";
import { SeededPrng } from "./prng";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";
import type { CycleConfig, CompletionEvent } from "./cycle-execution";

/**
 * Test harness — runs a single CycleExecutor against an infinite upstream
 * (refilled on every cycle-complete) for the given horizon. Returns metrics.
 *
 * Buffers are typed as Buffer<number> with parts as monotonic integers — we
 * don't care about part identity, only counts.
 */
interface SingleStationResult {
  completed: number;
  scrapped: number;
  finalTimeMs: number;
  blockedOutTransitions: number;
  starvedTransitions: number;
}

function makeSingleStation(opts: {
  cycleTimeMs: number;
  defectRate?: number;
  capacity?: number;
  upstreamCapacity?: number;
  downstreamCapacity?: number;
  seed?: number;
}): {
  executor: CycleExecutor<number>;
  scheduler: Scheduler<EngineEvent>;
  upstream: Buffer<number>;
  downstream: Buffer<number>;
  sm: StationStateMachine;
} {
  const stationId = newStationId();
  const scheduler = new Scheduler<EngineEvent>();
  const prng = new SeededPrng(opts.seed ?? 0xc0ffee);
  const upstream = new Buffer<number>(opts.upstreamCapacity ?? 1_000_000);
  const downstream = new Buffer<number>(opts.downstreamCapacity ?? 1_000_000);
  const sm = new StationStateMachine(stationId);
  const config: CycleConfig<number> = {
    stationId,
    cycleTimeMs: constant(opts.cycleTimeMs),
    defectRate: opts.defectRate ?? 0,
    capacity: opts.capacity ?? 1,
    upstream,
    downstream,
  };
  const executor = new CycleExecutor(config, sm, scheduler, prng);
  return { executor, scheduler, upstream, downstream, sm };
}

/** Drive the scheduler for `horizonMs` simulated milliseconds. */
function runSim(
  scheduler: Scheduler<EngineEvent>,
  executor: CycleExecutor<number>,
  upstream: Buffer<number>,
  horizonMs: number,
  refillUpstream: boolean,
): SingleStationResult {
  let partIdCounter = 0;
  let blockedOutTransitions = 0;
  let starvedTransitions = 0;
  executor.stateMachine.onStateChange((e) => {
    if (e.toState === "BlockedOut") blockedOutTransitions++;
    if (e.toState === "Starved") starvedTransitions++;
  });

  // Initial fill — push some parts into upstream
  if (refillUpstream) {
    for (let i = 0; i < 100; i++) upstream.push(partIdCounter++);
  } else {
    upstream.push(partIdCounter++);
  }

  executor.attemptStart(0);

  while (scheduler.size > 0 && scheduler.peek()!.timeMs <= horizonMs) {
    const event = scheduler.popMin();
    if (event.payload.kind === "cycle-complete") {
      if (refillUpstream && upstream.size < 50) {
        for (let i = 0; i < 50; i++) upstream.push(partIdCounter++);
        executor.onUpstreamAvailable(event.timeMs);
      }
      executor.handleCycleComplete(event.timeMs);
    } else if (event.payload.kind === "setup-complete") {
      executor.handleSetupComplete(event.timeMs);
    }
  }

  return {
    completed: executor.completed,
    scrapped: executor.scrapped,
    finalTimeMs: scheduler.currentTime,
    blockedOutTransitions,
    starvedTransitions,
  };
}

describe("CycleExecutor — single station, constant cycle time", () => {
  it("throughput ≈ 1 / cycleTime over a 1-hour sim with infinite supply + infinite downstream", () => {
    const cycleMs = 60_000; // 1 minute per part → 60 parts/hour
    const { executor, scheduler, upstream } = makeSingleStation({
      cycleTimeMs: cycleMs,
    });
    const result = runSim(scheduler, executor, upstream, 60 * 60_000, true);
    // 60 parts in 60 minutes (one starts at t=0, finishes at t=60s; next at 120s; ...)
    // 60 cycles starting at 0,60,120,... fit in [0, 3600); the 60th finishes at t=3600s
    // depending on edge handling, expect 60 ± 1
    expect(result.completed).toBeGreaterThanOrEqual(59);
    expect(result.completed).toBeLessThanOrEqual(61);
    expect(result.scrapped).toBe(0);
  });

  it("throughput within 1% of theoretical for a 100-minute sim", () => {
    const cycleMs = 1000; // 1 sec → 60 parts/min → 6000 parts/100min
    const { executor, scheduler, upstream } = makeSingleStation({
      cycleTimeMs: cycleMs,
    });
    const result = runSim(scheduler, executor, upstream, 100 * 60_000, true);
    const theoretical = (100 * 60_000) / cycleMs;
    expect(result.completed).toBeGreaterThan(theoretical * 0.99);
    expect(result.completed).toBeLessThanOrEqual(theoretical + 1);
  });
});

describe("CycleExecutor — capacity > 1 (parallel parts)", () => {
  it("capacity = 3 produces ~3x throughput vs capacity = 1 for the same cycle time", () => {
    const cycleMs = 1000;
    const horizon = 60 * 60_000;

    const a = makeSingleStation({ cycleTimeMs: cycleMs, capacity: 1 });
    const b = makeSingleStation({ cycleTimeMs: cycleMs, capacity: 3 });

    const r1 = runSim(a.scheduler, a.executor, a.upstream, horizon, true);
    const r3 = runSim(b.scheduler, b.executor, b.upstream, horizon, true);

    // Capacity-3 should complete ~3x the parts (give or take edge effects)
    expect(r3.completed).toBeGreaterThan(r1.completed * 2.95);
    expect(r3.completed).toBeLessThan(r1.completed * 3.05);
  });

  it("capacity = 3 keeps up to 3 parts in progress simultaneously", () => {
    const cycleMs = 1000;
    const { executor, upstream } = makeSingleStation({
      cycleTimeMs: cycleMs,
      capacity: 3,
    });

    for (let i = 0; i < 10; i++) upstream.push(i);
    executor.attemptStart(0);

    // After attemptStart drains, inProgress should equal capacity (3)
    expect(executor.inProgress).toBe(3);
  });
});

describe("CycleExecutor — defect handling", () => {
  it("defect rate ≈ 10% over 10k parts (within ±1%)", () => {
    const { executor, scheduler, upstream } = makeSingleStation({
      cycleTimeMs: 100, // fast cycle
      defectRate: 0.1,
      seed: 1234,
    });
    const result = runSim(scheduler, executor, upstream, 1_000_000, true);
    const total = result.completed + result.scrapped;
    expect(total).toBeGreaterThanOrEqual(10_000);
    const actualDefectRate = result.scrapped / total;
    expect(Math.abs(actualDefectRate - 0.1)).toBeLessThan(0.01);
  });

  it("defect rate = 0 produces zero scrap", () => {
    const { executor, scheduler, upstream } = makeSingleStation({
      cycleTimeMs: 100,
      defectRate: 0,
    });
    const result = runSim(scheduler, executor, upstream, 100_000, true);
    expect(result.scrapped).toBe(0);
    expect(result.completed).toBeGreaterThan(0);
  });
});

describe("CycleExecutor — BlockedOut transitions", () => {
  it("transitions to BlockedOut when downstream buffer fills", () => {
    const cycleMs = 100;
    const { executor, scheduler, upstream, downstream, sm } = makeSingleStation({
      cycleTimeMs: cycleMs,
      downstreamCapacity: 5, // small — fills quickly
    });

    for (let i = 0; i < 20; i++) upstream.push(i);
    executor.attemptStart(0);

    // Drive a few cycles
    let blockedSeen = false;
    sm.onStateChange((e) => {
      if (e.toState === "BlockedOut") blockedSeen = true;
    });

    while (scheduler.size > 0 && scheduler.peek()!.timeMs < 10_000) {
      const ev = scheduler.popMin();
      if (ev.payload.kind === "cycle-complete") executor.handleCycleComplete(ev.timeMs);
    }

    expect(blockedSeen).toBe(true);
    expect(downstream.isFull).toBe(true);
  });

  it("clears BlockedOut when downstream is drained externally", () => {
    const { executor, scheduler, upstream, downstream, sm } = makeSingleStation({
      cycleTimeMs: 100,
      downstreamCapacity: 2,
    });

    for (let i = 0; i < 10; i++) upstream.push(i);
    executor.attemptStart(0);

    // Run until BlockedOut
    while (scheduler.size > 0 && sm.state !== "BlockedOut") {
      const ev = scheduler.popMin();
      if (ev.payload.kind === "cycle-complete") executor.handleCycleComplete(ev.timeMs);
    }
    expect(sm.state).toBe("BlockedOut");

    // Drain downstream and notify
    downstream.pull();
    downstream.pull();
    executor.onDownstreamCleared(5000);
    expect(sm.state).toBe("Running");
  });
});

describe("CycleExecutor — Starved transitions", () => {
  it("transitions to Starved when upstream is empty and a cycle attempts", () => {
    const { executor, sm } = makeSingleStation({
      cycleTimeMs: 100,
    });
    // Don't push anything to upstream — just attempt
    executor.attemptStart(0);
    expect(sm.state).toBe("Starved");
    expect(executor.inProgress).toBe(0);
  });

  it("transitions Starved → Running when upstream gains a part", () => {
    const { executor, upstream, sm } = makeSingleStation({
      cycleTimeMs: 100,
    });

    executor.attemptStart(0);
    expect(sm.state).toBe("Starved");

    upstream.push(42);
    executor.onUpstreamAvailable(500);
    expect(sm.state).toBe("Running");
    expect(executor.inProgress).toBe(1);
  });
});

describe("CycleExecutor — setup time", () => {
  it("throughput = 1 / (setupTime + cycleTime) over 1-hour sim", () => {
    // setupTime = 50ms, cycleTime = 50ms → 100ms per part total → 36,000 parts/hr
    const stationId = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const prng = new SeededPrng(42);
    const upstream = new Buffer<number>(1_000_000);
    const downstream = new Buffer<number>(1_000_000);
    const sm = new StationStateMachine(stationId);
    const executor = new CycleExecutor<number>(
      {
        stationId,
        cycleTimeMs: constant(50),
        defectRate: 0,
        capacity: 1,
        upstream,
        downstream,
        setupTimeMs: constant(50),
      },
      sm,
      scheduler,
      prng,
    );

    for (let i = 0; i < 500_000; i++) upstream.push(i);
    executor.attemptStart(0);

    const horizon = 60 * 60_000;
    while (scheduler.size > 0 && (scheduler.peek()?.timeMs ?? Infinity) <= horizon) {
      const ev = scheduler.popMin();
      if (ev.payload.kind === "cycle-complete") executor.handleCycleComplete(ev.timeMs);
      else if (ev.payload.kind === "setup-complete") executor.handleSetupComplete(ev.timeMs);
    }

    const theoretical = horizon / 100; // 36,000
    expect(executor.completed).toBeGreaterThan(theoretical * 0.99);
    expect(executor.completed).toBeLessThanOrEqual(theoretical + 1);
  });

  it("station enters Setup state before Running on first cycle", () => {
    const stationId = newStationId();
    const scheduler = new Scheduler<EngineEvent>();
    const prng = new SeededPrng(42);
    const upstream = new Buffer<number>(10);
    const downstream = new Buffer<number>(10);
    const sm = new StationStateMachine(stationId);
    const executor = new CycleExecutor<number>(
      {
        stationId,
        cycleTimeMs: constant(100),
        defectRate: 0,
        capacity: 1,
        upstream,
        downstream,
        setupTimeMs: constant(50),
      },
      sm,
      scheduler,
      prng,
    );

    const states: string[] = [];
    sm.onStateChange((e) => states.push(`${e.fromState}→${e.toState}`));

    upstream.push(1);
    executor.attemptStart(0);

    // Should have transitioned Idle → Setup
    expect(states).toEqual(["Idle→Setup"]);
    expect(sm.state).toBe("Setup");

    // Pop setup-complete
    const setupEvent = scheduler.popMin();
    expect(setupEvent.payload.kind).toBe("setup-complete");
    expect(setupEvent.timeMs).toBe(50);
    executor.handleSetupComplete(setupEvent.timeMs);

    expect(sm.state).toBe("Running");
    expect(states[states.length - 1]).toBe("Setup→Running");
  });
});

describe("CycleExecutor — completion events", () => {
  it("notifies onCompletion subscribers with (stationId, part, timeMs, defective)", () => {
    const { executor, scheduler, upstream } = makeSingleStation({
      cycleTimeMs: 100,
      defectRate: 1, // every part is a defect
      seed: 99,
    });

    const events: CompletionEvent<number>[] = [];
    executor.onCompletion((e) => events.push(e));

    for (let i = 0; i < 3; i++) upstream.push(i);
    executor.attemptStart(0);

    while (scheduler.size > 0) {
      const ev = scheduler.popMin();
      if (ev.payload.kind === "cycle-complete") executor.handleCycleComplete(ev.timeMs);
    }

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.defective)).toBe(true);
    expect(events[0]?.stationId).toBe(executor.config.stationId);
  });
});

describe("CycleExecutor — validation", () => {
  it("rejects defectRate < 0 or > 1 at construction", () => {
    expect(
      () =>
        new CycleExecutor(
          {
            stationId: newStationId(),
            cycleTimeMs: constant(100),
            defectRate: 1.5,
            capacity: 1,
            upstream: new Buffer<number>(10),
            downstream: new Buffer<number>(10),
          },
          new StationStateMachine(newStationId()),
          new Scheduler<EngineEvent>(),
          new SeededPrng(),
        ),
    ).toThrow();
  });

  it("rejects capacity = 0 or non-integer", () => {
    const make = (capacity: number): CycleExecutor<number> =>
      new CycleExecutor(
        {
          stationId: newStationId(),
          cycleTimeMs: constant(100),
          defectRate: 0,
          capacity,
          upstream: new Buffer<number>(10),
          downstream: new Buffer<number>(10),
        },
        new StationStateMachine(newStationId()),
        new Scheduler<EngineEvent>(),
        new SeededPrng(),
      );

    expect(() => make(0)).toThrow();
    expect(() => make(1.5)).toThrow();
    expect(() => make(-1)).toThrow();
  });
});
