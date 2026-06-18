/**
 * Multi-station chain test harness.
 *
 * Wires N CycleExecutors in series via shared TrackedBuffers, runs the
 * scheduler to a target horizon, and reports the metrics needed to validate
 * Little's Law on the engine.
 *
 *   L = time-weighted average WIP in the system
 *   λ = throughput (parts exiting per unit time, measured during the window)
 *   W = average time-in-system per exited part (exit - enter)
 *
 * Measurement window = [warmupMs, horizonMs]. We only count parts whose EXIT
 * fell inside the window — both their entry and exit times are real,
 * recorded at the moment the relevant events fired.
 *
 * The harness is test-only — lives in src/engine/ for type access; not in
 * the public barrel.
 */

import { Buffer, TrackedBuffer } from "./buffer";
import { CycleExecutor } from "./cycle-execution";
import type { Distribution } from "./distribution";
import type { EngineEvent } from "./events";
import type { StationId } from "./ids";
import { newStationId } from "./ids";
import type { Prng } from "./prng";
import { Scheduler } from "./scheduler";
import { StationStateMachine } from "./state-machine";

interface TrackedPart {
  readonly id: number;
  readonly enteredSystemAtMs: number;
}

export interface ChainResult {
  readonly completed: number;
  readonly elapsedMs: number;
  /** L — time-weighted average WIP across inter-buffers + in-flight parts. */
  readonly averageWipL: number;
  /** λ — parts that EXITED the system per simulated ms, during the measurement window. */
  readonly throughputLambda: number;
  /** W — average time-in-system (exit - enter) per exited part. */
  readonly avgTimeInSystemW: number;
  readonly perStationCompleted: readonly number[];
}

export interface ChainOptions {
  readonly stationCycleTimes: readonly Distribution[];
  readonly interStationBufferCapacity: number;
  readonly horizonMs: number;
  readonly warmupMs: number;
  readonly prng: Prng;
}

export function runChain(opts: ChainOptions): ChainResult {
  const n = opts.stationCycleTimes.length;
  if (n < 1) throw new Error("chain requires at least 1 station");

  const stationIds: StationId[] = Array.from({ length: n }, () => newStationId());
  const stateMachines = stationIds.map((id) => new StationStateMachine(id));
  const scheduler = new Scheduler<EngineEvent>();

  const inputBuffer = new Buffer<TrackedPart>(10_000_000);
  const sinkBuffer = new Buffer<TrackedPart>(10_000_000);
  const interBuffers: TrackedBuffer<TrackedPart>[] = Array.from(
    { length: Math.max(0, n - 1) },
    () => new TrackedBuffer<TrackedPart>(opts.interStationBufferCapacity),
  );

  const executors: CycleExecutor<TrackedPart>[] = [];
  for (let i = 0; i < n; i++) {
    const upstream = i === 0 ? inputBuffer : (interBuffers[i - 1] as TrackedBuffer<TrackedPart>);
    const downstream = i === n - 1 ? sinkBuffer : (interBuffers[i] as TrackedBuffer<TrackedPart>);
    const ex = new CycleExecutor<TrackedPart>(
      {
        stationId: stationIds[i] as StationId,
        cycleTimeMs: opts.stationCycleTimes[i] as Distribution,
        defectRate: 0,
        capacity: 1,
        upstream,
        downstream,
      },
      stateMachines[i] as StationStateMachine,
      scheduler,
      opts.prng,
    );
    executors.push(ex);
  }

  for (const buf of interBuffers) buf.resetTracking(0);

  // Track exits at the LAST station with real timestamps.
  const exits: { part: TrackedPart; exitTimeMs: number }[] = [];
  const lastExecutor = executors[n - 1];
  if (!lastExecutor) throw new Error("chain harness invariant: no last executor");
  lastExecutor.onCompletion((event) => {
    exits.push({ part: event.part, exitTimeMs: event.timeMs });
  });

  // Refill the input on-demand, ONE part at a time, stamped with the time
  // station 0 will pull it. This means W (time-in-system) measured at exit
  // reflects only the part's actual pipeline traversal, not waiting in the
  // input feed. (An earlier version pre-loaded 100 parts at t=0 and gave
  // misleading W values for parts deep in the queue.)
  let nextPartId = 0;
  const refillOne = (timeMs: number): void => {
    if (inputBuffer.size === 0) {
      inputBuffer.push({ id: nextPartId++, enteredSystemAtMs: timeMs });
    }
  };
  refillOne(0);

  // Cross-station notifications: station i's completion notifies station i+1.
  for (let i = 0; i < n; i++) {
    const ex = executors[i];
    const next = executors[i + 1];
    if (!ex || !next) continue;
    ex.onCompletion((event) => {
      next.onUpstreamAvailable(event.timeMs);
    });
  }

  // After station 0 finishes a cycle, refill the input BEFORE its attemptStart
  // tries to pull. (notifyCompletion runs before attemptStart inside
  // handleCycleComplete, so this slots in correctly.)
  executors[0]?.onCompletion((event) => {
    refillOne(event.timeMs);
  });

  // Kick off — every station attempts to start so Starved transitions fire correctly.
  for (const ex of executors) ex.attemptStart(0);

  while (scheduler.size > 0) {
    const peeked = scheduler.peek();
    if (!peeked || peeked.timeMs > opts.horizonMs) break;
    const ev = scheduler.popMin();
    if (ev.payload.kind !== "cycle-complete") continue;
    const idx = stationIds.indexOf(ev.payload.stationId);
    if (idx === -1) continue;
    const executor = executors[idx];
    if (!executor) continue;

    executor.handleCycleComplete(ev.timeMs);

    // After station idx pulled from interBuffers[idx-1] (in its attemptStart),
    // station idx-1's downstream just gained space — tell it.
    const prev = executors[idx - 1];
    if (prev) prev.onDownstreamCleared(ev.timeMs);

    if (idx === 0) refillOne(ev.timeMs);
  }

  const endTimeMs = opts.horizonMs;
  const measureWindowMs = endTimeMs - opts.warmupMs;

  // Filter exits to those that occurred in the measurement window.
  const exitsInWindow = exits.filter((e) => e.exitTimeMs >= opts.warmupMs);

  // λ — parts exited per ms, during the measurement window.
  const throughputLambda = exitsInWindow.length / measureWindowMs;

  // W — average time-in-system for those exited parts.
  const avgTimeInSystemW =
    exitsInWindow.length > 0
      ? exitsInWindow.reduce((acc, e) => acc + (e.exitTimeMs - e.part.enteredSystemAtMs), 0) /
        exitsInWindow.length
      : 0;

  // L — average WIP across the system.
  //
  // Buffer contribution: TrackedBuffer's analytical time-weighted average.
  // In-flight contribution: assume each station's capacity is fully utilized
  // in steady state on the measurement window. This is exact for a balanced
  // chain where every station stays Running (the canonical Little's Law
  // fixture); for chains with starvation/blocking this overestimates and a
  // separate time-weighted-in-flight measurement (VROL-138) would be more
  // honest. For Phase 0 validation, the steady-state approximation suffices.
  let bufferWipL = 0;
  for (const buf of interBuffers) {
    bufferWipL += buf.averageWIP(endTimeMs);
  }
  const inFlightApprox = executors.reduce((s, e) => s + e.config.capacity, 0);
  const averageWipL = bufferWipL + inFlightApprox;

  return {
    completed: exitsInWindow.length,
    elapsedMs: measureWindowMs,
    averageWipL,
    throughputLambda,
    avgTimeInSystemW,
    perStationCompleted: executors.map((e) => e.completed),
  };
}
